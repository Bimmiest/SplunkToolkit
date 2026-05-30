import { describe, it, expect } from 'vitest';
import { applyKvMode } from '../processors/kvMode';
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

function dir(value: string): ConfDirective {
  return { key: 'KV_MODE', value, line: 1, directiveType: 'KV_MODE' };
}

describe('applyKvMode — json', () => {
  it('flattens a whole-event JSON object', () => {
    const [r] = applyKvMode([event('{"action":"login","user":{"name":"alice"}}')], [dir('json')]);
    expect(r.fields['action']).toBe('login');
    expect(r.fields['user.name']).toBe('alice');
    expect(r.fields['user']).toBeUndefined();
  });

  it('uses {} multivalue notation for arrays of objects', () => {
    const [r] = applyKvMode([event('{"items":[{"id":1},{"id":2}]}')], [dir('json')]);
    expect(r.fields['items{}.id']).toEqual(['1', '2']);
  });

  it('decodes escaped quotes and newlines inside JSON strings', () => {
    const [r] = applyKvMode([event('{"q":"say \\"hi\\"","m":"a\\nb"}')], [dir('json')]);
    expect(r.fields['q']).toBe('say "hi"');
    expect(r.fields['m']).toBe('a\nb');
  });

  it('extracts an embedded JSON object from surrounding text', () => {
    const [r] = applyKvMode([event('level=info payload={"a":1,"b":2}')], [dir('json')]);
    expect(r.fields['a']).toBe('1');
    expect(r.fields['b']).toBe('2');
  });

  it('extracts a top-level JSON array rather than just its first element', () => {
    const [r] = applyKvMode([event('[1,2,3]')], [dir('json')]);
    expect(r.fields['{}']).toEqual(['1', '2', '3']);
  });
});

describe('applyKvMode — auto (AUTO_KV_JSON)', () => {
  it('auto-extracts JSON when the event is JSON and KV_MODE is unset (default auto)', () => {
    const [r] = applyKvMode([event('{"action":"login","code":200}')], []);
    expect(r.fields['action']).toBe('login');
    expect(r.fields['code']).toBe('200');
  });

  it('still extracts key=value pairs alongside auto JSON', () => {
    const [r] = applyKvMode([event('status=ok count=3')], [dir('auto')]);
    expect(r.fields['status']).toBe('ok');
    expect(r.fields['count']).toBe('3');
  });

  it('does not auto-extract JSON when AUTO_KV_JSON=false', () => {
    const [r] = applyKvMode(
      [event('{"action":"login"}')],
      [dir('auto'), { key: 'AUTO_KV_JSON', value: 'false', line: 2, directiveType: 'AUTO_KV_JSON' }],
    );
    expect(r.fields['action']).toBeUndefined();
  });
});

describe('applyKvMode — auto_escaped', () => {
  it('honours backslash-escaped quotes inside quoted values', () => {
    const [r] = applyKvMode([event('msg="say \\"hi\\"" user=bob')], [dir('auto_escaped')]);
    expect(r.fields['msg']).toBe('say "hi"');
    expect(r.fields['user']).toBe('bob');
  });

  it('plain auto stops the value at the first inner quote', () => {
    const [r] = applyKvMode([event('msg="say \\"hi\\""')], [dir('auto')]);
    // Without escape handling the value terminates at the first inner quote.
    expect(r.fields['msg']).toBe('say \\');
  });
});

describe('applyKvMode — multi (multikv)', () => {
  it('extracts columns from a space-aligned table as multivalue fields', () => {
    const raw = ['name   age   city', 'alice  30    NYC', 'bob    25    LA'].join('\n');
    const [r] = applyKvMode([event(raw)], [dir('multi')]);
    expect(r.fields['name']).toEqual(['alice', 'bob']);
    expect(r.fields['age']).toEqual(['30', '25']);
    expect(r.fields['city']).toEqual(['NYC', 'LA']);
  });

  it('skips a dashed separator row under the header', () => {
    const raw = ['user   code', '-----  ----', 'alice  200'].join('\n');
    const [r] = applyKvMode([event(raw)], [dir('multi')]);
    expect(r.fields['user']).toBe('alice');
    expect(r.fields['code']).toBe('200');
  });
});
