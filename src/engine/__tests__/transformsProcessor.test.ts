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

function transformsConf(name: string, directives: Record<string, string>): ParsedConf {
  const stanza: ConfStanza = {
    name,
    type: 'sourcetype',
    lineRange: { start: 1, end: 1 },
    directives: Object.entries(directives).map(([key, value]) => ({ key, value, line: 1, directiveType: key })),
  };
  return { stanzas: [stanza], errors: [] };
}

function transformsDir(stanzaName: string): ConfDirective[] {
  return [{ key: 'TRANSFORMS-x', value: stanzaName, line: 1, directiveType: 'TRANSFORMS', className: 'x' }];
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
