import { describe, it, expect } from 'vitest';
import { breakLines } from '../processors/lineBreaker';
import type { ConfDirective, EventMetadata, ValidationDiagnostic } from '../types';

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
    expect(events[0]!._raw).toContain('line1');
  });

  it('preserves events when SHOULD_LINEMERGE=false', () => {
    const events = breakLines('line1\nline2\nline3', [dir('SHOULD_LINEMERGE', 'false')], META);
    expect(events).toHaveLength(3);
    expect(events[0]!._raw).toBe('line1');
    expect(events[1]!._raw).toBe('line2');
    expect(events[2]!._raw).toBe('line3');
  });
});

describe('breakLines — MAX_EVENTS line cap (SEM-5)', () => {
  it('caps a merged event at MAX_EVENTS *continuation* lines', () => {
    // Date-less lines would all merge into one event by default. MAX_EVENTS
    // bounds the continuation lines merged in, not the event's total line
    // count, so MAX_EVENTS=3 yields four-line events -- pinned by the Splunk
    // 10.4.0 capture `linebreak-max-events` (#162), which is what corrected the
    // reading this test previously encoded.
    const raw = Array.from({ length: 12 }, (_, i) => `line${i}`).join('\n');
    const events = breakLines(raw, [dir('MAX_EVENTS', '3')], META);
    expect(events).toHaveLength(3);
    expect(events[0]!._raw.split('\n')).toHaveLength(4);
  });

  it('defaults to 256 lines (no cap for small inputs)', () => {
    const raw = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n');
    const events = breakLines(raw, [], META);
    expect(events).toHaveLength(1);
  });

  it('ignores a non-numeric MAX_EVENTS (falls back to default)', () => {
    const raw = Array.from({ length: 10 }, (_, i) => `line${i}`).join('\n');
    const events = breakLines(raw, [dir('MAX_EVENTS', 'abc')], META);
    expect(events).toHaveLength(1);
  });
});

describe('breakLines — SHOULD_LINEMERGE defaults', () => {
  it('BREAK_ONLY_BEFORE_DATE defaults to true — breaks before ISO timestamp lines', () => {
    const raw = '2024-01-15 first event\ncontinuation of first\n2024-01-16 second event\n';
    const events = breakLines(raw, [], META);
    expect(events).toHaveLength(2);
    expect(events[0]!._raw).toContain('first event');
    expect(events[0]!._raw).toContain('continuation');
    expect(events[1]!._raw).toContain('second event');
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
    expect(events[0]!._raw).toContain('continuation');
    expect(events[1]!._raw).toContain('continuation2');
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
    expect(events[0]!._raw).toBe('event1');
    expect(events[1]!._raw).toBe('event2');
    expect(events[2]!._raw).toBe('event3');
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

describe('breakLines — uncompilable break patterns are reported (#75.2)', () => {
  it('warns when BREAK_ONLY_BEFORE cannot be compiled', () => {
    const diags: ValidationDiagnostic[] = [];
    breakLines('a\nb\nc', [dir('BREAK_ONLY_BEFORE', '(a+)+')], META, diags);
    const warning = diags.find((d) => d.message.includes('BREAK_ONLY_BEFORE'));
    expect(warning).toBeDefined();
    expect(warning!.message).toContain('could not be compiled safely');
  });

  it('warns when MUST_BREAK_AFTER cannot be compiled', () => {
    const diags: ValidationDiagnostic[] = [];
    breakLines('a\nb\nc', [dir('MUST_BREAK_AFTER', '[unterminated')], META, diags);
    expect(diags.some((d) => d.message.includes('MUST_BREAK_AFTER'))).toBe(true);
  });

  it('stays quiet for a pattern that compiles', () => {
    const diags: ValidationDiagnostic[] = [];
    breakLines('a\nb\nc', [dir('BREAK_ONLY_BEFORE', '^\\d{4}-')], META, diags);
    expect(diags.filter((d) => d.message.includes('BREAK_ONLY_BEFORE'))).toHaveLength(0);
  });

  it('stays quiet when the directive is absent', () => {
    const diags: ValidationDiagnostic[] = [];
    breakLines('a\nb\nc', [], META, diags);
    expect(diags.filter((d) => d.message.includes('BREAK_ONLY_BEFORE'))).toHaveLength(0);
  });
});

describe('#172 — a LINE_BREAKER with no capture group', () => {
  it('falls back to breaking on newlines, leaving the delimiter as its own event', () => {
    const raw = '2026-01-15T10:00:00Z one\n-----\n2026-01-15T10:00:01Z two\n';
    const events = breakLines(raw, [dir('SHOULD_LINEMERGE', 'false'), dir('LINE_BREAKER', '-----')], META);
    expect(events.map((e) => e._raw)).toEqual([
      '2026-01-15T10:00:00Z one',
      '-----',
      '2026-01-15T10:00:01Z two',
    ]);
  });

  it('leaves no trailing newline in _raw', () => {
    const events = breakLines('a\nb\n', [dir('SHOULD_LINEMERGE', 'false'), dir('LINE_BREAKER', 'X')], META);
    expect(events.every((e) => !e._raw.endsWith('\n'))).toBe(true);
  });

  it('says why, rather than silently ignoring the pattern', () => {
    const diags: ValidationDiagnostic[] = [];
    breakLines('a\nb\n', [dir('LINE_BREAKER', '-----')], META, diags);
    expect(diags.some((d) => d.message.includes('no capturing group'))).toBe(true);
  });

  it('still honours a pattern that does have a group', () => {
    const events = breakLines('a-----b', [dir('SHOULD_LINEMERGE', 'false'), dir('LINE_BREAKER', '(-----)')], META);
    expect(events.map((e) => e._raw)).toEqual(['a', 'b']);
  });
});

describe('#161 — MUST_BREAK_AFTER does not license merging', () => {
  it('breaks every line when it is the only rule in force', () => {
    const raw = '2026-01-15T10:00:00Z alpha\nmiddle\nEND\n2026-01-15T10:00:01Z beta\nmiddle\nEND\n';
    const events = breakLines(
      raw,
      [dir('SHOULD_LINEMERGE', 'true'), dir('BREAK_ONLY_BEFORE_DATE', 'false'), dir('MUST_BREAK_AFTER', 'END')],
      META,
    );
    expect(events).toHaveLength(6);
  });

  it('still merges when a continue rule is present alongside it', () => {
    const raw = 'START one\ncont\nEND\nSTART two\ncont\n';
    const events = breakLines(
      raw,
      [dir('BREAK_ONLY_BEFORE', '^START'), dir('BREAK_ONLY_BEFORE_DATE', 'false'), dir('MUST_BREAK_AFTER', 'END')],
      META,
    );
    expect(events).toHaveLength(2);
  });
});

describe('breakLines — MUST_NOT_BREAK_BEFORE / MUST_NOT_BREAK_AFTER (#190)', () => {
  it('MUST_NOT_BREAK_BEFORE vetoes a BREAK_ONLY_BEFORE break', () => {
    const events = breakLines(
      'EVENT one\ndetail\nEVENT protected\nEVENT two',
      [
        dir('SHOULD_LINEMERGE', 'true'),
        dir('BREAK_ONLY_BEFORE', '^EVENT'),
        dir('MUST_NOT_BREAK_BEFORE', '^EVENT protected'),
      ],
      META,
    );
    expect(events.map((e) => e._raw)).toEqual([
      'EVENT one\ndetail\nEVENT protected',
      'EVENT two',
    ]);
  });

  it('does NOT veto a BREAK_ONLY_BEFORE_DATE break — pinned by the 10.4.0 capture', () => {
    // Mirrors the fixture `linebreak-must-not-break-before`: the spec sentence
    // says the break should be suppressed, and measured Splunk breaks anyway.
    const events = breakLines(
      '2026-01-15T10:00:00Z first\n2026-01-15T10:00:01Z suppressed break\n2026-01-15T10:00:02Z second',
      [
        dir('SHOULD_LINEMERGE', 'true'),
        dir('BREAK_ONLY_BEFORE_DATE', 'true'),
        dir('MUST_NOT_BREAK_BEFORE', '^2026-01-15T10:00:01Z'),
      ],
      META,
    );
    expect(events).toHaveLength(3);
  });

  it('does not defeat the MAX_EVENTS cap', () => {
    const raw = Array.from({ length: 6 }, (_, i) => `line${i}`).join('\n');
    const events = breakLines(
      raw,
      [
        dir('SHOULD_LINEMERGE', 'true'),
        dir('MAX_EVENTS', '2'),
        dir('MUST_NOT_BREAK_BEFORE', '.*'),
      ],
      META,
    );
    expect(events).toHaveLength(2);
    expect(events[0]!._raw.split('\n')).toHaveLength(3);
  });

  it('MUST_NOT_BREAK_AFTER suppresses date breaks until MUST_BREAK_AFTER matches', () => {
    const events = breakLines(
      '2026-01-15T10:00:00Z BEGIN\n' +
        '2026-01-15T10:00:01Z inside\n' +
        '2026-01-15T10:00:02Z END\n' +
        '2026-01-15T10:00:03Z after',
      [
        dir('SHOULD_LINEMERGE', 'true'),
        dir('BREAK_ONLY_BEFORE_DATE', 'true'),
        dir('MUST_NOT_BREAK_AFTER', 'BEGIN'),
        dir('MUST_BREAK_AFTER', 'END'),
      ],
      META,
    );
    expect(events.map((e) => e._raw)).toEqual([
      '2026-01-15T10:00:00Z BEGIN\n2026-01-15T10:00:01Z inside\n2026-01-15T10:00:02Z END',
      '2026-01-15T10:00:03Z after',
    ]);
  });

  it('MUST_NOT_BREAK_AFTER with no MUST_BREAK_AFTER suppresses to the end of input', () => {
    const events = breakLines(
      '2026-01-15T10:00:00Z BEGIN\n2026-01-15T10:00:01Z a\n2026-01-15T10:00:02Z b',
      [
        dir('SHOULD_LINEMERGE', 'true'),
        dir('BREAK_ONLY_BEFORE_DATE', 'true'),
        dir('MUST_NOT_BREAK_AFTER', 'BEGIN'),
      ],
      META,
    );
    expect(events).toHaveLength(1);
  });

  it('warns when a veto pattern cannot be compiled', () => {
    const diagnostics: ValidationDiagnostic[] = [];
    breakLines(
      'a\nb',
      [dir('SHOULD_LINEMERGE', 'true'), dir('MUST_NOT_BREAK_BEFORE', '(')],
      META,
      diagnostics,
    );
    expect(diagnostics.some((d) => d.message.includes('MUST_NOT_BREAK_BEFORE'))).toBe(true);
  });
});
