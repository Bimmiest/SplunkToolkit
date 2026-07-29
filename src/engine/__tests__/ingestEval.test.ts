import { describe, it, expect } from 'vitest';
import { applyIngestEval } from '../transforms/ingestEval';
import type { SplunkEvent, ConfDirective } from '../types';

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

function ingestDir(value: string): ConfDirective[] {
  return [{ key: 'INGEST_EVAL', value, line: 1, directiveType: 'INGEST_EVAL' }];
}

describe('applyIngestEval', () => {
  it('assigns a literal value to a field', () => {
    const [e] = applyIngestEval([event('x')], ingestDir('tag="prod"'));
    expect(e.fields.tag).toBe('prod');
  });

  it('splits multiple top-level assignments on commas', () => {
    const [e] = applyIngestEval([event('x')], ingestDir('a="1", b="2"'));
    expect(e.fields.a).toBe('1');
    expect(e.fields.b).toBe('2');
  });

  // #59.2: two INGEST_EVAL lines in a stanza — Splunk applies only the last.
  it('applies only the last INGEST_EVAL when the key is repeated (last-wins)', () => {
    const dirs: ConfDirective[] = [
      { key: 'INGEST_EVAL', value: 'tag="first"', line: 1, directiveType: 'INGEST_EVAL' },
      { key: 'INGEST_EVAL', value: 'tag="second"', line: 2, directiveType: 'INGEST_EVAL' },
    ];
    const [e] = applyIngestEval([event('x')], dirs);
    expect(e.fields.tag).toBe('second');
  });

  // BUG-3: a comma inside a string literal must not split the assignment.
  it('does not split on a comma inside a quoted string', () => {
    const [e] = applyIngestEval([event('x')], ingestDir('msg="a,b"'));
    expect(e.fields.msg).toBe('a,b');
  });

  it('does not split on a comma inside parentheses', () => {
    const [e] = applyIngestEval([event('x')], ingestDir('n=if(1==1,"yes","no")'));
    expect(e.fields.n).toBe('yes');
  });

  // #25: a value ending in an escaped backslash (\\) closes the quote — the
  // following top-level comma must still split, not be swallowed.
  it('closes a literal ending in an escaped backslash and splits the next assignment', () => {
    // a = the Windows path `c:\` (written `c:\\` in the config), then b=2.
    const [e] = applyIngestEval([event('x')], ingestDir('a="c:\\\\", b=2'));
    expect(e.fields.a).toBe('c:\\');
    expect(e.fields.b).toBe('2');
  });
});

describe('applyIngestEval — queue assignment routes the event (#58)', () => {
  it('routes to nullQueue rather than writing a plain field', () => {
    const [out] = applyIngestEval(
      [event('DEBUG connection retry')],
      ingestDir('queue=if(match(_raw,"DEBUG"), "nullQueue", "indexQueue")'),
    );
    expect(out._meta._queue).toBe('nullQueue');
    expect(out.fields.queue).toBeUndefined();
  });

  it('routes a non-matching event to indexQueue', () => {
    const [out] = applyIngestEval(
      [event('INFO all good')],
      ingestDir('queue=if(match(_raw,"DEBUG"), "nullQueue", "indexQueue")'),
    );
    expect(out._meta._queue).toBe('indexQueue');
    expect(out.fields.queue).toBeUndefined();
  });

  it('does not mutate the input event', () => {
    const input = event('DEBUG x');
    applyIngestEval([input], ingestDir('queue="nullQueue"'));
    expect(input._meta._queue).toBeUndefined();
  });
});
