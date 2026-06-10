import { describe, it, expect } from 'vitest';
import { applyTransforms } from '../processors/transformsProcessor';
import type { SplunkEvent, ConfDirective, ConfStanza, ParsedConf, ValidationDiagnostic } from '../types';

function event(raw: string): SplunkEvent {
  return {
    _raw: raw,
    _time: null,
    _meta: {},
    fields: {},
    metadata: { index: 'main', host: 'h', source: 's', sourcetype: 'st' },
    lineNumbers: { start: 1, end: 1 },
    processingTrace: [],
  };
}

function stanza(name: string, directives: Record<string, string>): ConfStanza {
  return {
    name,
    type: 'sourcetype',
    lineRange: { start: 1, end: 1 },
    directives: Object.entries(directives).map(([key, value]) => ({ key, value, line: 1, directiveType: key })),
  };
}

function transformsConf(name: string, directives: Record<string, string>): ParsedConf {
  return { stanzas: [stanza(name, directives)], errors: [] };
}

function multiTransformsConf(...stanzas: ConfStanza[]): ParsedConf {
  return { stanzas, errors: [] };
}

function transformsDir(stanzaName: string): ConfDirective[] {
  return [{ key: 'TRANSFORMS-x', value: stanzaName, line: 1, directiveType: 'TRANSFORMS', className: 'x' }];
}

/** Build a TRANSFORMS-<class> directive for a given class name and value. */
function classDir(className: string, value: string): ConfDirective {
  return { key: `TRANSFORMS-${className}`, value, line: 1, directiveType: 'TRANSFORMS', className };
}

const lossMsg = (d: ValidationDiagnostic) => d.message.includes('replaced the event and dropped');

describe('applyTransforms — DEST_KEY=_raw data-loss warning', () => {
  it('warns when the FORMAT drops a large chunk of the event', () => {
    const diags: ValidationDiagnostic[] = [];
    const conf = transformsConf('mask', {
      REGEX: '(?<ip>\\d+\\.\\d+\\.\\d+\\.\\d+)',
      FORMAT: '$1',
      DEST_KEY: '_raw',
    });
    const [e] = applyTransforms([event('connect from 10.0.0.1 port 443 with details')], transformsDir('mask'), conf, 'index-time', diags);
    expect(e._raw).toBe('10.0.0.1'); // whole event replaced by the capture
    expect(diags.some(lossMsg)).toBe(true);
  });

  it('does not warn when the regex captures the whole line', () => {
    const diags: ValidationDiagnostic[] = [];
    const conf = transformsConf('mask', {
      REGEX: '(.*?)(\\d+\\.\\d+\\.\\d+\\.\\d+)(.*)',
      FORMAT: '$1REDACTED$3',
      DEST_KEY: '_raw',
    });
    const [e] = applyTransforms([event('connect from 10.0.0.1 port 443')], transformsDir('mask'), conf, 'index-time', diags);
    expect(e._raw).toBe('connect from REDACTED port 443');
    expect(diags.some(lossMsg)).toBe(false);
  });

  it('warns at most once per stanza across many events', () => {
    const diags: ValidationDiagnostic[] = [];
    const conf = transformsConf('mask', { REGEX: '(?<a>\\d+)', FORMAT: '$1', DEST_KEY: '_raw' });
    const events = [
      event('aaaa 1 bbbb cccc dddd'),
      event('eeee 2 ffff gggg hhhh'),
      event('iiii 3 jjjj kkkk llll'),
    ];
    applyTransforms(events, transformsDir('mask'), conf, 'index-time', diags);
    expect(diags.filter(lossMsg)).toHaveLength(1);
  });
});

describe('applyTransforms — unknown DEST_KEY warning (SEM-11)', () => {
  const unknownMsg = (d: ValidationDiagnostic) => d.message.includes('is not a recognized Splunk DEST_KEY');

  it('warns when DEST_KEY is not a documented key', () => {
    const diags: ValidationDiagnostic[] = [];
    const conf = transformsConf('route', { REGEX: '(.*)', FORMAT: '$1', DEST_KEY: 'MetaData:Bogus' });
    applyTransforms([event('hello')], transformsDir('route'), conf, 'index-time', diags);
    expect(diags.some(unknownMsg)).toBe(true);
  });

  it('does not warn for a documented key', () => {
    const diags: ValidationDiagnostic[] = [];
    const conf = transformsConf('route', { REGEX: '(.*)', FORMAT: 'host::web01', DEST_KEY: 'MetaData:Host' });
    applyTransforms([event('hello')], transformsDir('route'), conf, 'index-time', diags);
    expect(diags.some(unknownMsg)).toBe(false);
  });

  it('emits an informational note for a valid-but-unsimulated routing key', () => {
    const diags: ValidationDiagnostic[] = [];
    const conf = transformsConf('route', { REGEX: '(.*)', FORMAT: 'my_group', DEST_KEY: '_TCP_ROUTING' });
    applyTransforms([event('hello')], transformsDir('route'), conf, 'index-time', diags);
    expect(diags.some((d) => d.level === 'info' && d.message.includes('not simulated'))).toBe(true);
    expect(diags.some(unknownMsg)).toBe(false);
  });
});

describe('applyTransforms — queue routing is last-wins (SEM-1)', () => {
  const conf = multiTransformsConf(
    stanza('setnull', { REGEX: '.', DEST_KEY: 'queue', FORMAT: 'nullQueue' }),
    stanza('setparsing', { REGEX: 'KEEP-ME', DEST_KEY: 'queue', FORMAT: 'indexQueue' }),
  );
  // The canonical "drop everything except X" pattern.
  const dir = transformsDir('setnull, setparsing');

  it('a later indexQueue overrides an earlier nullQueue for matching events', () => {
    const [e] = applyTransforms([event('KEEP-ME please')], dir, conf, 'index-time');
    expect(e._meta._queue).toBe('indexQueue'); // survives — setparsing ran after setnull
  });

  it('events that do not match the later rule stay nullQueue', () => {
    const [e] = applyTransforms([event('drop this line')], dir, conf, 'index-time');
    expect(e._meta._queue).toBe('nullQueue');
  });

  it('keeps (does not remove) nullQueue events so they can be shown as dropped', () => {
    const out = applyTransforms([event('drop this line')], dir, conf, 'index-time');
    expect(out).toHaveLength(1);
  });
});

describe('applyTransforms — classes applied in ASCII order (SEM-4)', () => {
  it('sorts TRANSFORMS-<class> by class name regardless of file order', () => {
    const conf = multiTransformsConf(
      stanza('setindex', { REGEX: '.', DEST_KEY: 'queue', FORMAT: 'indexQueue' }),
      stanza('setnull', { REGEX: '.', DEST_KEY: 'queue', FORMAT: 'nullQueue' }),
    );
    // File order puts class "z" before class "a"; ASCII order runs a then z, so
    // z's nullQueue is the last write and wins.
    const dirs = [classDir('z', 'setnull'), classDir('a', 'setindex')];
    const [e] = applyTransforms([event('anything')], dirs, conf, 'index-time');
    expect(e._meta._queue).toBe('nullQueue');
  });
});

describe('applyTransforms — index-time extraction without WRITE_META (SEM-7)', () => {
  it('warns when an index-time transform extracts fields with no WRITE_META/DEST_KEY', () => {
    const diags: ValidationDiagnostic[] = [];
    const conf = transformsConf('grab', { REGEX: '(?<user>\\w+)' });
    applyTransforms([event('alice')], transformsDir('grab'), conf, 'index-time', diags);
    expect(diags.some((d) => d.message.includes('no effect'))).toBe(true);
  });

  it('does NOT warn when WRITE_META = true is set', () => {
    const diags: ValidationDiagnostic[] = [];
    const conf = transformsConf('grab', { REGEX: '(?<user>\\w+)', WRITE_META: 'true' });
    applyTransforms([event('alice')], transformsDir('grab'), conf, 'index-time', diags);
    expect(diags.some((d) => d.message.includes('no effect'))).toBe(false);
  });

  it('does NOT warn for the same extraction at search time (REPORT)', () => {
    const diags: ValidationDiagnostic[] = [];
    const conf = transformsConf('grab', { REGEX: '(?<user>\\w+)' });
    const reportDir: ConfDirective[] = [{ key: 'REPORT-x', value: 'grab', line: 1, directiveType: 'REPORT', className: 'x' }];
    applyTransforms([event('alice')], reportDir, conf, 'search-time', diags);
    expect(diags.some((d) => d.message.includes('no effect'))).toBe(false);
  });
});

describe('applyTransforms — INGEST_EVAL interleaving (SEM-2)', () => {
  it('runs an INGEST_EVAL stanza at its list position so a later regex sees the result', () => {
    const conf = multiTransformsConf(
      stanza('rewrite', { INGEST_EVAL: '_raw="HELLO"' }),
      stanza('extract', { REGEX: '(?<word>HELLO)' }),
    );
    // List order: eval rewrites _raw, then the regex extracts from the new _raw.
    const [e] = applyTransforms([event('original text')], transformsDir('rewrite, extract'), conf, 'index-time');
    expect(e._raw).toBe('HELLO');
    expect(e.fields.word).toBe('HELLO');
  });

  it('does not run INGEST_EVAL on the search-time (REPORT) pass', () => {
    const conf = multiTransformsConf(stanza('rewrite', { INGEST_EVAL: '_raw="HELLO"' }));
    const reportDir: ConfDirective[] = [{ key: 'REPORT-x', value: 'rewrite', line: 1, directiveType: 'REPORT', className: 'x' }];
    const [e] = applyTransforms([event('original text')], reportDir, conf, 'search-time');
    expect(e._raw).toBe('original text');
  });
});
