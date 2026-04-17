import { describe, it, expect } from 'vitest';
import { breakLines } from '../processors/lineBreaker';
import type { ConfDirective, EventMetadata } from '../types';

const META: EventMetadata = { index: 'main', host: 'host1', source: '/var/log/app.log', sourcetype: 'myapp' };

function dir(key: string, value: string): ConfDirective {
  return { key, value, line: 1, directiveType: key };
}

describe('breakLines — basic LINE_BREAKER', () => {
  it('splits on newlines by default', () => {
    const events = breakLines('line1\nline2\nline3', [], META);
    // SHOULD_LINEMERGE=true + BREAK_ONLY_BEFORE_DATE=true (default)
    // None of the lines look like dates, so they all merge into one event
    expect(events).toHaveLength(1);
    expect(events[0]._raw).toContain('line1');
  });

  it('preserves events when SHOULD_LINEMERGE=false', () => {
    const events = breakLines('line1\nline2\nline3', [dir('SHOULD_LINEMERGE', 'false')], META);
    expect(events).toHaveLength(3);
    expect(events[0]._raw).toBe('line1');
    expect(events[1]._raw).toBe('line2');
    expect(events[2]._raw).toBe('line3');
  });
});

describe('breakLines — SHOULD_LINEMERGE defaults', () => {
  it('BREAK_ONLY_BEFORE_DATE defaults to true — breaks before ISO timestamp lines', () => {
    const raw = '2024-01-15 first event\ncontinuation of first\n2024-01-16 second event\n';
    const events = breakLines(raw, [], META);
    expect(events).toHaveLength(2);
    expect(events[0]._raw).toContain('first event');
    expect(events[0]._raw).toContain('continuation');
    expect(events[1]._raw).toContain('second event');
  });

  it('does NOT merge everything into one event by default', () => {
    const raw = '2024-01-15 event1\n2024-01-16 event2\n2024-01-17 event3\n';
    const events = breakLines(raw, [], META);
    expect(events.length).toBeGreaterThan(1);
  });

  it('BREAK_ONLY_BEFORE_DATE=false merges non-timestamp lines into one event', () => {
    const raw = 'line1\nline2\nline3\n';
    const events = breakLines(raw, [dir('BREAK_ONLY_BEFORE_DATE', 'false')], META);
    expect(events).toHaveLength(1);
  });
});

describe('breakLines — BREAK_ONLY_BEFORE', () => {
  it('breaks only when the next segment matches the pattern', () => {
    const raw = 'START event1\ncontinuation\nSTART event2\ncontinuation2\n';
    const events = breakLines(raw, [dir('BREAK_ONLY_BEFORE', '^START')], META);
    expect(events).toHaveLength(2);
    expect(events[0]._raw).toContain('continuation');
    expect(events[1]._raw).toContain('continuation2');
  });
});

describe('breakLines — custom LINE_BREAKER', () => {
  it('splits on a custom separator pattern', () => {
    // Separator pattern with a capturing group
    const raw = 'event1---event2---event3';
    const events = breakLines(raw, [
      dir('LINE_BREAKER', '(---)'),
      dir('SHOULD_LINEMERGE', 'false'),
    ], META);
    expect(events).toHaveLength(3);
    expect(events[0]._raw).toBe('event1');
    expect(events[1]._raw).toBe('event2');
    expect(events[2]._raw).toBe('event3');
  });

  it('uses d-flag indices correctly when separator repeats within the match', () => {
    // Pattern where m[1] repeats: separator is a run of dashes, but the full
    // match includes surrounding context. Use a pattern where the captured
    // group content appears earlier in m[0] to expose the indexOf bug.
    const raw = 'aXXbXXc';
    const events = breakLines(raw, [
      dir('LINE_BREAKER', 'a(XX)'),
      dir('SHOULD_LINEMERGE', 'false'),
    ], META);
    // "a" before the capture group belongs to the first (empty) segment,
    // "bXXc" is the rest. We care that the split is not off by the repeated "XX".
    expect(events.some((e) => e._raw === 'bXXc')).toBe(true);
  });
});
