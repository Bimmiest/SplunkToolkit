import { describe, it, expect } from 'vitest';
import { applyRegexTransform } from '../transforms/regexTransform';
import type { SplunkEvent, ConfStanza } from '../types';

function event(raw: string, fields: Record<string, string> = {}): SplunkEvent {
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

function stanza(name: string, directives: Record<string, string>): ConfStanza {
  return {
    name,
    type: 'sourcetype',
    lineRange: { start: 1, end: 1 },
    directives: Object.entries(directives).map(([key, value]) => ({
      key,
      value,
      line: 1,
      directiveType: key,
    })),
  };
}

describe('applyRegexTransform — zero-length match guard', () => {
  it('terminates on a DEST_KEY=<field> regex that can match the empty string', () => {
    // `(.*)` matches the whole line then an empty string at the end — without a
    // lastIndex guard the global match loop would spin forever and hang the worker.
    const s = stanza('grab', { REGEX: '(.*)', FORMAT: '$1', DEST_KEY: 'myfield' });
    const result = applyRegexTransform(event('hello world'), s);
    expect(result.matched).toBe(true);
    expect(result.destKey).toBe('myfield');
    expect(result.destValue).toContain('hello world');
  });
});

describe('applyRegexTransform — named capture groups', () => {
  it('extracts named groups into fields when no FORMAT', () => {
    const s = stanza('test', { REGEX: '(?<user>\\w+) (?<action>\\w+)' });
    const result = applyRegexTransform(event('alice login'), s);
    expect(result.matched).toBe(true);
    expect(result.fields['user']).toBe('alice');
    expect(result.fields['action']).toBe('login');
  });

  it('expands named ${name} back-references in FORMAT', () => {
    const s = stanza('test', {
      REGEX: '(?<user>\\w+) (?<action>\\w+)',
      FORMAT: 'user::$1 action::$2',
    });
    const result = applyRegexTransform(event('alice login'), s);
    expect(result.matched).toBe(true);
    expect(result.fields['user']).toBe('alice');
    expect(result.fields['action']).toBe('login');
  });
});

describe('applyRegexTransform — REPEAT_MATCH / MV_ADD', () => {
  it('defaults to the first match only (single value)', () => {
    const s = stanza('nums', { REGEX: '(?<num>\\d+)' });
    const result = applyRegexTransform(event('1 2 3'), s);
    expect(result.fields['num']).toBe('1');
  });

  it('REPEAT_MATCH + MV_ADD collects every match into a multivalue field', () => {
    const s = stanza('nums', { REGEX: '(?<num>\\d+)', REPEAT_MATCH: 'true', MV_ADD: 'true' });
    const result = applyRegexTransform(event('1 2 3'), s);
    expect(result.fields['num']).toEqual(['1', '2', '3']);
  });

  it('REPEAT_MATCH without MV_ADD keeps the first value and discards the rest', () => {
    const s = stanza('nums', { REGEX: '(?<num>\\d+)', REPEAT_MATCH: 'true' });
    const result = applyRegexTransform(event('1 2 3'), s);
    expect(result.fields['num']).toBe('1');
  });

  it('MV_ADD without REPEAT_MATCH still only sees the first match', () => {
    const s = stanza('nums', { REGEX: '(?<num>\\d+)', MV_ADD: 'true' });
    const result = applyRegexTransform(event('1 2 3'), s);
    expect(result.fields['num']).toBe('1');
  });

  it('REPEAT_MATCH + MV_ADD builds multivalue across multiple named groups', () => {
    const s = stanza('kv', { REGEX: '(?<k>\\w+)=(?<v>\\d+)', REPEAT_MATCH: 'true', MV_ADD: 'true' });
    const result = applyRegexTransform(event('a=1 b=2 c=3'), s);
    expect(result.fields['k']).toEqual(['a', 'b', 'c']);
    expect(result.fields['v']).toEqual(['1', '2', '3']);
  });
});

describe('applyRegexTransform — DEST_KEY = _raw replaces the whole event', () => {
  it('replaces the ENTIRE _raw with the FORMAT expansion (uncaptured text is lost)', () => {
    // The classic footgun: the regex matches only the IP, so everything else
    // ("connect from", "port 443") is discarded. To keep it you must capture and
    // reproduce it in FORMAT, or use SEDCMD instead.
    const s = stanza('mask', {
      REGEX: '(?<ip>\\d+\\.\\d+\\.\\d+\\.\\d+)',
      FORMAT: '$1 masked',
      DEST_KEY: '_raw',
    });
    const result = applyRegexTransform(event('connect from 10.0.0.1 port 443'), s);
    expect(result.matched).toBe(true);
    expect(result.destValue).toBe('10.0.0.1 masked');
  });

  it('expands ${name} in FORMAT and discards the rest of the event', () => {
    const s = stanza('mask', {
      REGEX: '(?<ip>\\d+\\.\\d+\\.\\d+\\.\\d+)',
      FORMAT: '${ip} masked',
      DEST_KEY: '_raw',
    });
    const result = applyRegexTransform(event('connect from 10.0.0.1 port 443'), s);
    expect(result.destValue).toBe('10.0.0.1 masked');
  });

  it('uses the FIRST match only — the whole event becomes the FORMAT output', () => {
    const s = stanza('redact', {
      REGEX: '(\\d{3}-\\d{4})',
      FORMAT: 'XXXX',
      DEST_KEY: '_raw',
    });
    const result = applyRegexTransform(event('call 555-1234 or 555-5678'), s);
    // Not "call XXXX or XXXX" — DEST_KEY=_raw replaces the entire event.
    expect(result.destValue).toBe('XXXX');
  });

  it('preserves surrounding text only when the regex captures the whole line', () => {
    // The correct masking idiom: capture everything, reproduce it in FORMAT.
    const s = stanza('mask', {
      REGEX: '(.*?)(\\d+\\.\\d+\\.\\d+\\.\\d+)(.*)',
      FORMAT: '$1REDACTED$3',
      DEST_KEY: '_raw',
    });
    const result = applyRegexTransform(event('connect from 10.0.0.1 port 443'), s);
    expect(result.destValue).toBe('connect from REDACTED port 443');
  });
});

describe('applyRegexTransform — numbered groups with FORMAT', () => {
  it('substitutes $0 with the full match for DEST_KEY = _raw', () => {
    const s = stanza('wrap', {
      REGEX: '(\\w+)@(\\w+)',
      FORMAT: '[$0]',
      DEST_KEY: '_raw',
    });
    const result = applyRegexTransform(event('user@host'), s);
    expect(result.destValue).toBe('[user@host]');
  });

  it('substitutes $1 and $2 with capture groups for DEST_KEY = _raw', () => {
    const s = stanza('reformat', {
      REGEX: '(\\w+)@(\\w+)',
      FORMAT: '$2/$1',
      DEST_KEY: '_raw',
    });
    const result = applyRegexTransform(event('user@host'), s);
    expect(result.destValue).toBe('host/user');
  });

  // #26: with a single group, `$10` is group 1 followed by a literal `0`, not
  // the non-existent group 10 (which used to collapse the whole output to '').
  it('treats a digit after a single-digit group ref as a literal', () => {
    const s = stanza('grab', {
      REGEX: '(AA)',
      FORMAT: '$10',
      DEST_KEY: '_raw',
    });
    const result = applyRegexTransform(event('AA'), s);
    expect(result.destValue).toBe('AA0');
  });

  // With enough groups present, `$10` still resolves to group 10.
  it('resolves a genuine two-digit group reference when the group exists', () => {
    const s = stanza('grab', {
      // 10 single-char groups; group 10 captures "J".
      REGEX: '(A)(B)(C)(D)(E)(F)(G)(H)(I)(J)',
      FORMAT: '$10',
      DEST_KEY: '_raw',
    });
    const result = applyRegexTransform(event('ABCDEFGHIJ'), s);
    expect(result.destValue).toBe('J');
  });
});

describe('applyRegexTransform — DELIMS / FIELDS', () => {
  it('extracts field/value pairs with two delimiter sets', () => {
    const s = stanza('pipe_eq', { DELIMS: '"|", "="' });
    const result = applyRegexTransform(event('user=alice|action=login|status=200'), s);
    expect(result.matched).toBe(true);
    expect(result.fields['user']).toBe('alice');
    expect(result.fields['action']).toBe('login');
    expect(result.fields['status']).toBe('200');
  });

  it('treats each character in a set as its own delimiter', () => {
    const s = stanza('multi', { DELIMS: '"|;", "="' });
    const result = applyRegexTransform(event('a=1|b=2;c=3'), s);
    expect(result.fields['a']).toBe('1');
    expect(result.fields['b']).toBe('2');
    expect(result.fields['c']).toBe('3');
  });

  it('splits key/value on the first kv-delimiter occurrence only', () => {
    const s = stanza('kv', { DELIMS: '" ", "="' });
    const result = applyRegexTransform(event('url=/path?a=1'), s);
    expect(result.fields['url']).toBe('/path?a=1');
  });

  it('names positional values via FIELDS with a single DELIMS set', () => {
    const s = stanza('csv', { DELIMS: '","', FIELDS: '"ts", "user", "action"' });
    const result = applyRegexTransform(event('2026-01-01,alice,login'), s);
    expect(result.fields['ts']).toBe('2026-01-01');
    expect(result.fields['user']).toBe('alice');
    expect(result.fields['action']).toBe('login');
  });

  it('decodes escape sequences in DELIMS (tab/newline)', () => {
    const s = stanza('tabbed', { DELIMS: '"\\n", ":\\t" ' });
    const result = applyRegexTransform(event('key1:\tval1\nkey2:\tval2'), s);
    expect(result.fields['key1']).toBe('val1');
    expect(result.fields['key2']).toBe('val2');
  });

  it('accumulates repeated keys into a multivalue field', () => {
    const s = stanza('rep', { DELIMS: '" ", "="' });
    const result = applyRegexTransform(event('tag=a tag=b tag=c'), s);
    expect(result.fields['tag']).toEqual(['a', 'b', 'c']);
  });

  it('drops empty values and pairs without a kv delimiter', () => {
    const s = stanza('sparse', { DELIMS: '"|", "="' });
    const result = applyRegexTransform(event('a=1|justtext|b='), s);
    expect(result.fields['a']).toBe('1');
    expect(result.fields['b']).toBeUndefined();
    expect(result.fields['justtext']).toBeUndefined();
  });

  it('reads from SOURCE_KEY when set', () => {
    const s = stanza('fromfield', { DELIMS: '"&", "="', SOURCE_KEY: 'query' });
    const result = applyRegexTransform(event('ignored', { query: 'x=1&y=2' }), s);
    expect(result.fields['x']).toBe('1');
    expect(result.fields['y']).toBe('2');
  });
});

describe('applyRegexTransform — no match', () => {
  it('returns matched=false when regex does not match', () => {
    const s = stanza('test', { REGEX: 'NO_MATCH_SENTINEL_XYZ' });
    const result = applyRegexTransform(event('hello world'), s);
    expect(result.matched).toBe(false);
  });
});

describe('applyRegexTransform — DEST_KEY single-value metadata slots', () => {
  it('MetaData:Sourcetype uses first match only even when regex matches many times', () => {
    // Permissive regex like "." matches every character — without the fix this
    // produces "sourcetype::auditd\nsourcetype::auditd\n…" × N.
    const s = stanza('set_sourcetype', {
      REGEX: '.',
      FORMAT: 'sourcetype::auditd',
      DEST_KEY: 'MetaData:Sourcetype',
    });
    const result = applyRegexTransform(event('{"type":"SYSCALL","pid":"100"}'), s);
    expect(result.matched).toBe(true);
    expect(result.destKey).toBe('MetaData:Sourcetype');
    expect(result.destValue).toBe('sourcetype::auditd');
  });

  it('MetaData:Sourcetype works with _MetaData:Sourcetype alias', () => {
    const s = stanza('set_sourcetype', {
      REGEX: '.',
      FORMAT: 'sourcetype::auditd',
      DEST_KEY: '_MetaData:Sourcetype',
    });
    const result = applyRegexTransform(event('raw log line'), s);
    expect(result.destValue).toBe('sourcetype::auditd');
  });

  it('MetaData:Host uses first match only', () => {
    const s = stanza('set_host', {
      REGEX: 'host=(\\w+)',
      FORMAT: 'host::$1',
      DEST_KEY: 'MetaData:Host',
    });
    const result = applyRegexTransform(event('host=web01 host=web02'), s);
    expect(result.destValue).toBe('host::web01');
  });

  it('queue=nullQueue not broken by multi-match regex', () => {
    const s = stanza('drop', {
      REGEX: '.',
      FORMAT: 'nullQueue',
      DEST_KEY: 'queue',
    });
    const result = applyRegexTransform(event('drop me'), s);
    expect(result.destValue).toBe('nullQueue');
  });

  it('arbitrary field DEST_KEY still accumulates multi-values', () => {
    const s = stanza('extract_words', {
      REGEX: '(\\w+)',
      FORMAT: '$1',
      DEST_KEY: 'words',
    });
    const result = applyRegexTransform(event('foo bar baz'), s);
    expect(result.destKey).toBe('words');
    // Should accumulate all three matches
    expect(result.destValue).toBe('foo\nbar\nbaz');
  });
});
