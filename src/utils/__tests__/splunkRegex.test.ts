import { describe, it, expect } from 'vitest';
import { safeRegex, translatePcreToJs, hasReDoSRisk } from '../splunkRegex';

describe('translatePcreToJs', () => {
  it('hoists a leading inline flag group into the flags', () => {
    const { source, flags } = translatePcreToJs('(?i)error');
    expect(source).toBe('error');
    expect(flags).toContain('i');
  });

  it('merges multiple inline flag letters and preserves passed flags', () => {
    const { source, flags } = translatePcreToJs('(?ims)foo', 'g');
    expect(source).toBe('foo');
    expect(flags.split('').sort().join('')).toBe('gims');
  });

  it('converts Python named groups and backreferences', () => {
    const { source } = translatePcreToJs('(?P<word>\\w+)\\s(?P=word)');
    expect(source).toBe('(?<word>\\w+)\\s\\k<word>');
  });

  it('rewrites atomic groups to non-capturing groups', () => {
    expect(translatePcreToJs('(?>abc)d').source).toBe('(?:abc)d');
  });

  it('converts possessive quantifiers to greedy ones', () => {
    expect(translatePcreToJs('a++').source).toBe('a+');
    expect(translatePcreToJs('\\w*+').source).toBe('\\w*');
    expect(translatePcreToJs('x?+').source).toBe('x?');
    expect(translatePcreToJs('\\d{2,3}+').source).toBe('\\d{2,3}');
  });

  it('leaves an escaped literal quantifier char untouched', () => {
    // `\++` = one-or-more literal plus signs — valid JS, must not be stripped.
    expect(translatePcreToJs('\\++').source).toBe('\\++');
  });
});

describe('safeRegex with PCRE syntax', () => {
  it('compiles and case-insensitively matches an inline-flag pattern', () => {
    const re = safeRegex('(?i)error');
    expect(re).not.toBeNull();
    expect(re!.test('ERROR')).toBe(true);
  });

  it('compiles a possessive quantifier instead of returning null', () => {
    const re = safeRegex('a++');
    expect(re).not.toBeNull();
    expect(re!.test('aaa')).toBe(true);
  });

  it('exposes Python named groups as JS named captures', () => {
    const re = safeRegex('(?P<num>\\d+)');
    expect(re).not.toBeNull();
    expect(re!.exec('id 42')?.groups?.num).toBe('42');
  });

  it('still rejects nested-quantifier ReDoS patterns', () => {
    expect(safeRegex('(\\d+)+')).toBeNull();
  });
});

describe('hasReDoSRisk — strengthened heuristic (#11/#34)', () => {
  // Catastrophic families that previously slipped through and could freeze the
  // main-thread live regex testers.
  it.each([
    '(\\d+)+',        // nested quantified group (existing)
    '(.+)*x',         // nested group, star outer
    '(.*,){20}',      // bounded repetition of a group with an inner quantifier
    'a*a*',           // adjacent same-atom quantifiers
    '\\d+\\d+',       // adjacent same-atom quantifiers (escaped atom)
    'a*a*a*a*a*a*a*c', // long adjacent run
  ])('flags catastrophic pattern %s', (p) => {
    expect(hasReDoSRisk(p)).toBe(true);
    expect(safeRegex(p)).toBeNull();
  });

  // Benign patterns must still compile — no false positives.
  it.each([
    '(foo|bar)+',     // benign alternation (NOT flagged — needs real overlap analysis)
    'a+b+',           // different atoms
    '\\d+\\.\\d+',    // digits.digits (dot between, not adjacent same atom)
    '(ab){3}',        // bounded group with no inner quantifier
    '\\d{2,3}',       // a plain bound
    '(?<num>\\d+)',   // a single named group
  ])('does not flag benign pattern %s', (p) => {
    expect(hasReDoSRisk(p)).toBe(false);
    expect(safeRegex(p)).not.toBeNull();
  });
});
