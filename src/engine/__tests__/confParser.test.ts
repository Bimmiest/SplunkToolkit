import { describe, it, expect } from 'vitest';
import { parseConf } from '../parser/confParser';

function directives(text: string, stanzaName: string) {
  const parsed = parseConf(text, 'props.conf');
  const stanza = parsed.stanzas.find((s) => s.name === stanzaName);
  return stanza?.directives ?? [];
}

function value(text: string, stanzaName: string, key: string) {
  return directives(text, stanzaName).find((d) => d.key === key)?.value;
}

describe('parseConf — basic structure', () => {
  it('parses stanzas and key = value directives', () => {
    const parsed = parseConf('[mysourcetype]\nSHOULD_LINEMERGE = false', 'props.conf');
    expect(parsed.stanzas).toHaveLength(1);
    expect(parsed.stanzas[0].name).toBe('mysourcetype');
    expect(parsed.stanzas[0].directives[0]).toMatchObject({ key: 'SHOULD_LINEMERGE', value: 'false' });
  });

  it('treats # as a comment but NOT ;', () => {
    const parsed = parseConf('[s]\n# a comment\n; not a comment\nA = 1', 'props.conf');
    // The ";" line is not a comment — it becomes a malformed-line error, not a directive.
    expect(parsed.errors.some((e) => e.message.includes('Malformed'))).toBe(true);
  });
});

describe('parseConf — case-sensitive attribute names', () => {
  it('warns when a known attribute is mis-cased (Splunk ignores it)', () => {
    const parsed = parseConf('[aws]\nkv_mode = json', 'props.conf');
    const warn = parsed.errors.find((e) => e.directiveKey === 'kv_mode');
    expect(warn).toBeDefined();
    expect(warn!.level).toBe('warning');
    expect(warn!.message).toMatch(/case-sensitive/);
    expect(warn!.suggestion).toBe('Change "kv_mode" to "KV_MODE".');
    expect(warn!.line).toBe(2);
  });

  it('does not warn when the attribute is cased correctly', () => {
    const parsed = parseConf('[aws]\nKV_MODE = json', 'props.conf');
    expect(parsed.errors).toHaveLength(0);
  });

  it('does not warn for unknown attributes (avoids false positives)', () => {
    const parsed = parseConf('[s]\nMY_CUSTOM_THING = 1', 'props.conf');
    expect(parsed.errors).toHaveLength(0);
  });

  it('does not warn for class directives like EXTRACT-foo regardless of class-name case', () => {
    const parsed = parseConf('[s]\nEXTRACT-myField = (?<a>\\d+)', 'props.conf');
    expect(parsed.errors).toHaveLength(0);
  });
});

describe('parseConf — line continuation (SEM-18)', () => {
  it('joins a value continued with a trailing backslash', () => {
    const text = '[s]\nLINE_BREAKER = part1\\\npart2';
    expect(value(text, 's', 'LINE_BREAKER')).toBe('part1part2');
  });

  it('preserves leading whitespace of the continuation line', () => {
    const text = '[s]\nKEY = a\\\n    b';
    expect(value(text, 's', 'KEY')).toBe('a    b');
  });

  it('does NOT treat an escaped (even-count) trailing backslash as a continuation', () => {
    // `C:\\dir\\` ends with two backslashes (an escaped literal), so the next line
    // is its own directive, not a continuation.
    const text = '[s]\nPATH = C:\\\\dir\\\\\nOTHER = x';
    expect(value(text, 's', 'PATH')).toBe('C:\\\\dir\\\\');
    expect(value(text, 's', 'OTHER')).toBe('x');
  });

  it('a blank line terminates continuation', () => {
    const text = '[s]\nKEY = a\\\n\nOTHER = b';
    // The backslash-terminated value keeps its trailing backslash (continuation reset).
    expect(value(text, 's', 'OTHER')).toBe('b');
  });
});
