import { describe, it, expect } from 'vitest';
import { applyEvalExpressions } from '../processors/evalProcessor';
import type { SplunkEvent, ConfDirective } from '../types';

function event(fields: Record<string, string> = {}, raw = 'raw'): SplunkEvent {
  return {
    _raw: raw,
    _time: null,
    _meta: {},
    fields,
    metadata: { index: 'main', host: 'h', source: 's', sourcetype: 'st' },
    lineNumbers: { start: 1, end: 1 },
    processingTrace: [],
  };
}

function evalDir(className: string, value: string): ConfDirective {
  return { key: `EVAL-${className}`, value, line: 1, directiveType: 'EVAL', className };
}

describe('applyEvalExpressions — arithmetic', () => {
  it('adds two numbers', () => {
    const [result] = applyEvalExpressions([event({ a: '3', b: '4' })], [evalDir('sum', 'a + b')]);
    // Fields are always stored as strings
    expect(result.fields['sum']).toBe('7');
  });

  it('multiplies', () => {
    const [result] = applyEvalExpressions([event({ x: '6' })], [evalDir('doubled', 'x * 2')]);
    expect(result.fields['doubled']).toBe('12');
  });

  it('string concat with .', () => {
    const [result] = applyEvalExpressions([event({ a: 'hello' })], [evalDir('msg', 'a . " world"')]);
    expect(result.fields['msg']).toBe('hello world');
  });
});

describe('applyEvalExpressions — numeric predicates', () => {
  it('isnum() is false for non-numeric strings', () => {
    const [r] = applyEvalExpressions([event({ a: 'abc' })], [evalDir('n', 'isnum(a)')]);
    expect(r.fields['n']).toBe('false');
  });

  it('isnum() is true for numeric strings', () => {
    const [r] = applyEvalExpressions([event({ a: '3.14' })], [evalDir('n', 'isnum(a)')]);
    expect(r.fields['n']).toBe('true');
  });

  it('isint() is false for non-numeric and non-integer input', () => {
    const [r1] = applyEvalExpressions([event({ a: 'abc' })], [evalDir('n', 'isint(a)')]);
    expect(r1.fields['n']).toBe('false');
    const [r2] = applyEvalExpressions([event({ a: '5.5' })], [evalDir('n', 'isint(a)')]);
    expect(r2.fields['n']).toBe('false');
    const [r3] = applyEvalExpressions([event({ a: '5' })], [evalDir('n', 'isint(a)')]);
    expect(r3.fields['n']).toBe('true');
  });

  it('round() rounds halves away from zero', () => {
    const [r] = applyEvalExpressions([event({ a: '-2.5' })], [evalDir('n', 'round(a)')]);
    expect(r.fields['n']).toBe('-3');
  });
});

describe('applyEvalExpressions — function fidelity', () => {
  it('typeof returns Number / String / Bool / Invalid', () => {
    const [r] = applyEvalExpressions(
      [event({})],
      [evalDir('t', 'typeof(12) . "," . typeof("hi") . "," . typeof(1==1) . "," . typeof(missing)')],
    );
    expect(r.fields['t']).toBe('Number,String,Bool,Invalid');
  });

  it('like() is case-sensitive', () => {
    const [hit] = applyEvalExpressions([event({ a: 'Error' })], [evalDir('m', 'if(like(a, "Error"), "y", "n")')]);
    expect(hit.fields['m']).toBe('y');
    const [miss] = applyEvalExpressions([event({ a: 'error' })], [evalDir('m', 'if(like(a, "Error"), "y", "n")')]);
    expect(miss.fields['m']).toBe('n');
  });

  it('mvindex supports negative indices and NULL-on-out-of-range', () => {
    const [r] = applyEvalExpressions(
      [event({})],
      [evalDir('last', 'mvindex(split("a,b,c", ","), -1)')],
    );
    expect(r.fields['last']).toBe('c');
    const [oor] = applyEvalExpressions(
      [event({})],
      [evalDir('x', 'mvindex(split("a,b", ","), 9)')],
    );
    expect(oor.fields['x']).toBeUndefined(); // null → field deleted
  });

  it('max() treats strings as greater than numbers; min() picks the number', () => {
    const [mx] = applyEvalExpressions([event({})], [evalDir('m', 'max(5, "apple", 10)')]);
    expect(mx.fields['m']).toBe('apple');
    const [mn] = applyEvalExpressions([event({})], [evalDir('m', 'min(5, "apple", 10)')]);
    expect(mn.fields['m']).toBe('5');
  });

  it('tostring duration zero-pads hours and rolls over days', () => {
    const [r] = applyEvalExpressions([event({})], [evalDir('d', 'tostring(615, "duration")')]);
    expect(r.fields['d']).toBe('00:10:15');
    const [r2] = applyEvalExpressions([event({})], [evalDir('d', 'tostring(90061, "duration")')]);
    expect(r2.fields['d']).toBe('1+01:01:01');
  });

  it('tostring commas forces two decimals with thousands separators', () => {
    const [r] = applyEvalExpressions([event({})], [evalDir('c', 'tostring(1000000.1278, "commas")')]);
    expect(r.fields['c']).toBe('1,000,000.13');
  });

  it('random() returns an integer in [0, 2^31)', () => {
    const [r] = applyEvalExpressions([event({})], [evalDir('r', 'random()')]);
    const n = Number(r.fields['r']);
    expect(Number.isInteger(n)).toBe(true);
    expect(n).toBeGreaterThanOrEqual(0);
    expect(n).toBeLessThan(2147483648);
  });
});

describe('applyEvalExpressions — replace() ReDoS guard', () => {
  it('returns original string for a ReDoS-risky pattern', () => {
    // (a+)+ is the classic ReDoS pattern
    const [result] = applyEvalExpressions(
      [event({}, 'aaaaaab')],
      [evalDir('safe', 'replace(_raw, "(a+)+", "x")')]
    );
    // safeRegex rejects the pattern — original _raw returned unchanged
    expect(result.fields['safe']).toBe('aaaaaab');
  });

  it('performs valid replace()', () => {
    const [result] = applyEvalExpressions(
      [event({}, '2024-01-15')],
      [evalDir('redacted', 'replace(_raw, "\\\\d{4}", "YYYY")')]
    );
    expect(result.fields['redacted']).toBe('YYYY-01-15');
  });
});

describe('applyEvalExpressions — crypto stubs', () => {
  it('md5() returns not-simulated placeholder', () => {
    const [result] = applyEvalExpressions([event()], [evalDir('h', 'md5("test")')]);
    expect(result.fields['h']).toBe('[md5() not simulated]');
  });

  it('sha256() returns not-simulated placeholder', () => {
    const [result] = applyEvalExpressions([event()], [evalDir('h', 'sha256("test")')]);
    expect(result.fields['h']).toBe('[sha256() not simulated]');
  });
});

describe('applyEvalExpressions — string functions', () => {
  it('upper() uppercases', () => {
    const [result] = applyEvalExpressions([event({ s: 'hello' })], [evalDir('u', 'upper(s)')]);
    expect(result.fields['u']).toBe('HELLO');
  });

  it('lower() lowercases', () => {
    const [result] = applyEvalExpressions([event({ s: 'HELLO' })], [evalDir('l', 'lower(s)')]);
    expect(result.fields['l']).toBe('hello');
  });

  it('len() returns string length', () => {
    const [result] = applyEvalExpressions([event({ s: 'abcde' })], [evalDir('n', 'len(s)')]);
    expect(result.fields['n']).toBe('5');
  });

  it('if() selects true branch', () => {
    const [result] = applyEvalExpressions(
      [event({ x: '10' })],
      [evalDir('r', 'if(x > 5, "big", "small")')]
    );
    expect(result.fields['r']).toBe('big');
  });
});

describe('applyEvalExpressions — KV key extraction with hyphens', () => {
  it('eval expressions do not break when field names have hyphens via _raw', () => {
    // This test verifies the pipeline does not crash; eval does not rename fields
    const ev = event({}, 'x-forwarded-for=1.2.3.4');
    const [result] = applyEvalExpressions([ev], [evalDir('raw_copy', '_raw')]);
    expect(result.fields['raw_copy']).toBe('x-forwarded-for=1.2.3.4');
  });
});

describe('applyEvalExpressions — IN / NOT IN operator', () => {
  it('IN returns true when field value is in the list', () => {
    const [r] = applyEvalExpressions(
      [event({ eventName: 'DeleteUser' })],
      [evalDir('hit', 'eventName IN ("DeleteUser","UpdateUser","CreateUser")')]
    );
    expect(r.fields['hit']).toBe('true');
  });

  it('IN returns false when field value is not in the list', () => {
    const [r] = applyEvalExpressions(
      [event({ eventName: 'ListBuckets' })],
      [evalDir('hit', 'eventName IN ("DeleteUser","UpdateUser","CreateUser")')]
    );
    expect(r.fields['hit']).toBe('false');
  });

  it('NOT IN returns true when value is absent from list', () => {
    const [r] = applyEvalExpressions(
      [event({ eventName: 'ListBuckets' })],
      [evalDir('hit', 'eventName NOT IN ("DeleteUser","UpdateUser")')]
    );
    expect(r.fields['hit']).toBe('true');
  });

  it('NOT IN returns false when value is present in list', () => {
    const [r] = applyEvalExpressions(
      [event({ eventName: 'DeleteUser' })],
      [evalDir('hit', 'eventName NOT IN ("DeleteUser","UpdateUser")')]
    );
    expect(r.fields['hit']).toBe('false');
  });

  it('IN works with numeric comparison', () => {
    const [r] = applyEvalExpressions(
      [event({ code: '200' })],
      [evalDir('ok', 'code IN (200, 201, 204)')]
    );
    expect(r.fields['ok']).toBe('true');
  });

  it('IN inside case() — CloudTrail-style pattern', () => {
    const [r] = applyEvalExpressions(
      [event({ eventName: 'ListAliases', 'userIdentity.userName': 'alice' })],
      [evalDir('src_user_name', `case(eventName IN ("AssumeRoleWithSAML","AssumeRoleWithWebIdentity","ListAliases"),'userIdentity.userName',eventName="AssumeRole","assumed")`)]
    );
    expect(r.fields['src_user_name']).toBe('alice');
  });

  it('standalone NOT before non-IN expression still works', () => {
    const [r] = applyEvalExpressions(
      [event({ x: '0' })],
      [evalDir('r', 'if(NOT x, "yes", "no")')]
    );
    expect(r.fields['r']).toBe('yes');
  });
});

describe('applyEvalExpressions — complex nested case() with OR', () => {
  it('parses case() with deeply nested OR expressions and single-quoted field names', () => {
    const ev = event(
      {
        'additionalEventData.MFAUsed': 'No',
        eventName: 'ConsoleLogin',
        'userIdentity.type': 'AssumedRole',
        'userIdentity.sessionContext.attributes.mfaAuthenticated': 'false',
      },
      'test'
    );
    
    const expr = `case((('additionalEventData.MFAUsed'="Yes" AND eventName="ConsoleLogin") OR eventName="CheckMfa"), "MFA", ('additionalEventData.MFAUsed'="No" AND eventName="ConsoleLogin") OR ((eventName="AssumeRole" OR eventName="ListAliases") AND 'userIdentity.type'="AssumedRole" AND 'userIdentity.sessionContext.attributes.mfaAuthenticated'="false"), "SFA")`;
    
    const [result] = applyEvalExpressions([ev], [evalDir('auth_method', expr)]);
    expect(result.fields['auth_method']).toBe('SFA');
  });
});
