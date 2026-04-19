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

describe('applyRegexTransform — DEST_KEY = _raw with named groups', () => {
  it('replaces _raw using numbered back-references without polluting with offset', () => {
    // Pattern has one named capture group → args = [match, p1, offset, string, namedGroups]
    // The off-by-one bug would substitute $2 with the numeric offset value.
    const s = stanza('mask', {
      REGEX: '(?<ip>\\d+\\.\\d+\\.\\d+\\.\\d+)',
      FORMAT: '$1 masked',
      DEST_KEY: '_raw',
    });
    const result = applyRegexTransform(event('connect from 10.0.0.1 port 443'), s);
    expect(result.matched).toBe(true);
    // $1 should be the IP, not the offset integer
    expect(result.destValue).toBe('connect from 10.0.0.1 masked port 443');
  });

  it('expands ${name} in FORMAT for DEST_KEY = _raw', () => {
    const s = stanza('mask', {
      REGEX: '(?<ip>\\d+\\.\\d+\\.\\d+\\.\\d+)',
      FORMAT: '${ip} masked',
      DEST_KEY: '_raw',
    });
    const result = applyRegexTransform(event('connect from 10.0.0.1 port 443'), s);
    expect(result.destValue).toBe('connect from 10.0.0.1 masked port 443');
  });

  it('replaces all occurrences globally for DEST_KEY = _raw', () => {
    const s = stanza('redact', {
      REGEX: '(\\d{3}-\\d{4})',
      FORMAT: 'XXXX',
      DEST_KEY: '_raw',
    });
    const result = applyRegexTransform(event('call 555-1234 or 555-5678'), s);
    expect(result.destValue).toBe('call XXXX or XXXX');
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
