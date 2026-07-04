import { describe, it, expect } from 'vitest';
import { applyKvMode } from '../processors/kvMode';
import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';

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

  it('extracts keys named after Object.prototype members without corruption', () => {
    // `fields` is a plain object that inherits Object.prototype, so a naive
    // `fields[name] === undefined` check would read back the inherited function
    // for keys like `toString`/`valueOf`, mangle the value into a multivalue,
    // and silently drop the field from the extracted list.
    const [r] = applyKvMode(
      [event('{"toString":"x","valueOf":"y","hasOwnProperty":"z"}')],
      [dir('json')],
    );
    expect(r.fields['toString']).toBe('x');
    expect(r.fields['valueOf']).toBe('y');
    expect(r.fields['hasOwnProperty']).toBe('z');
  });

  it('still promotes genuinely repeated prototype-named keys to multivalue', () => {
    const [r] = applyKvMode([event('{"items":[{"toString":"a"},{"toString":"b"}]}')], [dir('json')]);
    expect(r.fields['items{}.toString']).toEqual(['a', 'b']);
  });

  it('extracts constructor/prototype keys as real fields (Splunk does)', () => {
    const [r] = applyKvMode([event('{"constructor":"a","prototype":"b"}')], [dir('json')]);
    expect(Object.prototype.hasOwnProperty.call(r.fields, 'constructor')).toBe(true);
    expect(r.fields['constructor']).toBe('a');
    expect(r.fields['prototype']).toBe('b');
  });

  it('extracts a __proto__ key as a field without polluting Object.prototype', () => {
    const [r] = applyKvMode([event('{"__proto__":"pwned","keep":"ok"}')], [dir('json')]);
    expect(Object.prototype.hasOwnProperty.call(r.fields, '__proto__')).toBe(true);
    expect(r.fields['__proto__']).toBe('pwned');
    expect(r.fields['keep']).toBe('ok');
    // Object.prototype and the bag's own prototype must be untouched.
    expect(Object.getPrototypeOf(r.fields)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['keep']).toBeUndefined();
  });

  it('does NOT scavenge bare leaf fields from a nested object when the outer JSON is malformed', () => {
    // The whole event fails JSON.parse (`<ID>` is not a valid token), but the nested
    // `alert` object is locally well-formed. The old behaviour flattened that inner
    // object without its path prefix, inventing bare `action`/`category` fields that
    // Splunk never produces. It must now extract nothing and report the parse error.
    const malformed =
      '{"firewall_name":"fw","event":{"app_proto":"ntp",' +
      '"alert":{"action":"blocked","signature_id":3,"rev":0,"signature":"s","category":"","severity":3},' +
      '"flow_id":<ID>}}';
    const diagnostics: ValidationDiagnostic[] = [];
    const [r] = applyKvMode([event(malformed)], [dir('json')], diagnostics);

    expect(r.fields['action']).toBeUndefined();
    expect(r.fields['category']).toBeUndefined();
    expect(r.fields['event.alert.action']).toBeUndefined();
    expect(Object.keys(r.fields)).toHaveLength(0);

    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].level).toBe('warning');
    expect(diagnostics[0].message).toMatch(/not valid JSON/);
    // The warning is a data problem: it targets the Raw Log panel, not props.conf,
    // and points at the offending input line.
    expect(diagnostics[0].file).toBe('raw');
    expect(diagnostics[0].line).toBe(1);
  });

  it('extracts the full dotted field set once the malformed JSON is valid', () => {
    const valid =
      '{"firewall_name":"fw","event":{"app_proto":"ntp",' +
      '"alert":{"action":"blocked","signature_id":3},"flow_id":123}}';
    const diagnostics: ValidationDiagnostic[] = [];
    const [r] = applyKvMode([event(valid)], [dir('json')], diagnostics);

    expect(r.fields['firewall_name']).toBe('fw');
    expect(r.fields['event.app_proto']).toBe('ntp');
    expect(r.fields['event.alert.action']).toBe('blocked');
    expect(r.fields['event.flow_id']).toBe('123');
    expect(diagnostics).toHaveLength(0);
  });

  it('warns (without scavenging) when malformed JSON is seen in default auto mode', () => {
    const diagnostics: ValidationDiagnostic[] = [];
    const [r] = applyKvMode([event('{"a":1,"b":<ID>}')], [], diagnostics);
    expect(Object.keys(r.fields)).toHaveLength(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/KV_MODE = auto/);
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

  // #22: a key=value substring inside a quoted value must NOT become a field.
  it('does not extract phantom fields from inside a quoted value', () => {
    const [r] = applyKvMode([event('msg="error code=42 occurred"')], [dir('auto')]);
    expect(r.fields['msg']).toBe('error code=42 occurred');
    expect(r.fields['code']).toBeUndefined();
  });

  it('still extracts real bare pairs that follow a quoted value', () => {
    const [r] = applyKvMode([event('msg="x=1 y=2" status=ok')], [dir('auto')]);
    expect(r.fields['msg']).toBe('x=1 y=2');
    expect(r.fields['status']).toBe('ok');
    expect(r.fields['x']).toBeUndefined();
    expect(r.fields['y']).toBeUndefined();
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
