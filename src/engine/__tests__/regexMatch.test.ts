import { describe, it, expect } from 'vitest';
import { matchInputs } from '../regexMatch';

describe('matchInputs', () => {
  it('returns per-input match info aligned to the inputs', () => {
    const out = matchInputs('\\d+', ['abc', 'id=42', 'x']);
    expect(out).not.toBeNull();
    expect(out!.map((r) => r?.match ?? null)).toEqual([null, '42', null]);
  });

  it('captures named groups and their spans', () => {
    const [r] = matchInputs('user=(?<user>\\w+)', ['user=alice'])!;
    expect(r).not.toBeNull();
    expect(r!.groups).toEqual({ user: 'alice' });
    // "alice" starts at index 5.
    expect(r!.groupSpans.user).toEqual([5, 10]);
    expect(r!.index).toBe(0);
    expect(r!.match).toBe('user=alice');
  });

  it('supports Splunk (?P<name>...) syntax', () => {
    const [r] = matchInputs('(?P<num>\\d+)', ['id 7'])!;
    expect(r!.groups).toEqual({ num: '7' });
  });

  it('returns null overall for a ReDoS-refused pattern', () => {
    expect(matchInputs('(a+)+$', ['aaaa'])).toBeNull();
  });

  it('returns null overall for an invalid pattern', () => {
    expect(matchInputs('(', ['x'])).toBeNull();
  });

  it('omits groups that did not participate in the match', () => {
    const [r] = matchInputs('(?<a>x)|(?<b>y)', ['y'])!;
    expect(r!.groups).toEqual({ b: 'y' });
    expect(r!.groupSpans.a).toBeUndefined();
  });
});
