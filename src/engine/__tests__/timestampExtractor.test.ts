import { describe, it, expect } from 'vitest';
import { extractTimestamps } from '../processors/timestampExtractor';
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

function dir(key: string, value: string): ConfDirective {
  return { key, value, line: 1, directiveType: key };
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

describe('extractTimestamps — explicit TIME_FORMAT (regression)', () => {
  it('parses with a configured TIME_FORMAT', () => {
    const e = extractTimestamps(
      [event('2024-01-15 10:00:00 some log')],
      [dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S')],
    )[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('respects TIME_PREFIX', () => {
    const e = extractTimestamps(
      [event('id=5 ts=2024-01-15T10:00:00 rest')],
      [dir('TIME_FORMAT', '%Y-%m-%dT%H:%M:%S'), dir('TIME_PREFIX', 'ts=')],
    )[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  // #66: with TIME_PREFIX set, the format must match immediately after the
  // prefix. A date elsewhere in the line must NOT be extracted (a broken
  // TIME_PREFIX config fails in Splunk rather than silently grabbing a mid-line
  // date), so _time stays null and falls back to default handling.
  it('does not extract a mid-line date when TIME_PREFIX does not sit before it', () => {
    const e = extractTimestamps(
      [event('ts=pending job started 2024-01-15 10:00:00')],
      [dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S'), dir('TIME_PREFIX', 'ts=')],
    )[0]!;
    expect(e._time).toBeNull();
  });

  it('still parses when only whitespace separates the prefix from the date', () => {
    const e = extractTimestamps(
      [event('ts=  2024-01-15 10:00:00')],
      [dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S'), dir('TIME_PREFIX', 'ts=')],
    )[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('without TIME_PREFIX, still finds a TIME_FORMAT date later in the line', () => {
    // No prefix → unanchored scan within the lookahead window (unchanged).
    const e = extractTimestamps(
      [event('log message here 2024-01-15 10:00:00')],
      [dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S')],
    )[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  // SEM-9: %z must match a trailing ISO-8601 'Z' (and keep it UTC even when TZ is set).
  it('matches %z against a literal Z and stays UTC despite a configured TZ', () => {
    const e = extractTimestamps(
      [event('2024-01-15T10:00:00Z some log')],
      [dir('TIME_FORMAT', '%Y-%m-%dT%H:%M:%S%z'), dir('TZ', 'America/New_York')],
    )[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });
});

describe('extractTimestamps — auto recognition (no TIME_FORMAT)', () => {
  it('recognises ISO 8601', () => {
    const e = extractTimestamps([event('2024-01-15T10:00:00 hello')], [])[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('recognises ISO 8601 with Z as UTC', () => {
    const e = extractTimestamps([event('2024-01-15T10:00:00.250Z hello')], [])[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.250Z');
  });

  it('honours a numeric zone offset', () => {
    const e = extractTimestamps([event('2024-01-15T10:00:00+05:00 hello')], [])[0]!;
    expect(iso(e._time)).toBe('2024-01-15T05:00:00.000Z');
  });

  it('recognises an Apache access-log timestamp', () => {
    const e = extractTimestamps([event('10.0.0.1 - - [15/Jan/2024:10:00:00 +0000] "GET /"')], [])[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('recognises a leading epoch (seconds)', () => {
    const e = extractTimestamps([event('1705312800 event body')], [])[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('respects TIME_PREFIX during auto recognition', () => {
    const e = extractTimestamps(
      [event('garbage 9999 when=2024-01-15T10:00:00 tail')],
      [dir('TIME_PREFIX', 'when=')],
    )[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('leaves _time null when no timestamp is recognisable', () => {
    const e = extractTimestamps([event('no timestamp anywhere here')], [])[0]!;
    expect(e._time).toBeNull();
  });

  // #12: position-scored recognition — the timestamp at the front of the region
  // wins over a more-specific one embedded later in the message body.
  it('prefers the earliest timestamp over a more-specific one deeper in the text', () => {
    const e = extractTimestamps([event('01/02/2024 note 2023-06-15T08:00:00 tail')], [])[0]!;
    expect(iso(e._time)).toBe('2024-01-02T00:00:00.000Z');
  });
});

// #12: out-of-range fields are a parse failure, not a silent Date rollover.
describe('extractTimestamps — range validation (#12)', () => {
  const fmt = dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S');

  it('rejects an impossible day (Feb 30) instead of rolling into March', () => {
    const e = extractTimestamps([event('2024-02-30 10:00:00 x')], [fmt])[0]!;
    expect(e._time).toBeNull();
  });

  it('rejects an out-of-range month (13)', () => {
    const e = extractTimestamps([event('2024-13-01 10:00:00 x')], [fmt])[0]!;
    expect(e._time).toBeNull();
  });

  it('rejects an out-of-range hour (25)', () => {
    const e = extractTimestamps([event('2024-01-15 25:00:00 x')], [fmt])[0]!;
    expect(e._time).toBeNull();
  });

  it('still accepts a valid leap day', () => {
    const e = extractTimestamps([event('2024-02-29 10:00:00 x')], [fmt])[0]!;
    expect(iso(e._time)).toBe('2024-02-29T10:00:00.000Z');
  });
});

// #12: an unresolvable timezone is treated as UTC but now warns instead of
// drifting silently.
describe('extractTimestamps — timezone resolution (#12)', () => {
  const fmt = dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S');

  it('warns when the TZ cannot be resolved and falls back to UTC', () => {
    // A name no time-zone database has. Europe/London used to stand in for this
    // case, but IANA names resolve for real now (#159), so only a genuinely
    // unknown zone still exercises the fallback.
    const diags: ValidationDiagnostic[] = [];
    const e = extractTimestamps([event('2024-01-15 10:00:00 x')], [fmt, dir('TZ', 'Middle/Earth')], diags)[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
    expect(diags.some((d) => d.level === 'warning' && /Middle\/Earth/.test(d.message))).toBe(true);
  });

  it('resolves an IANA zone name against its real offset, without warning (#159)', () => {
    const diags: ValidationDiagnostic[] = [];
    // London is BST (+01:00) in July, so 10:00 local is 09:00Z.
    const e = extractTimestamps([event('2024-07-15 10:00:00 x')], [fmt, dir('TZ', 'Europe/London')], diags)[0]!;
    expect(iso(e._time)).toBe('2024-07-15T09:00:00.000Z');
    expect(diags).toHaveLength(0);
  });

  it('does not warn for a resolvable numeric TZ offset', () => {
    const diags: ValidationDiagnostic[] = [];
    const e = extractTimestamps([event('2024-01-15 10:00:00 x')], [fmt, dir('TZ', '-0500')], diags)[0]!;
    // TZ=-0500 → local 10:00 is 15:00 UTC.
    expect(iso(e._time)).toBe('2024-01-15T15:00:00.000Z');
    expect(diags).toHaveLength(0);
  });

  it('warns only once for the same unresolved TZ across many events', () => {
    const diags: ValidationDiagnostic[] = [];
    extractTimestamps(
      [event('2024-01-15 10:00:00 a'), event('2024-01-16 11:00:00 b')],
      [fmt, dir('TZ', 'Middle/Earth')],
      diags,
    );
    expect(diags.filter((d) => /Middle\/Earth/.test(d.message))).toHaveLength(1);
  });
});

describe('#163 — an event with no timestamp inherits the previous one', () => {
  const fmt = dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S');

  it('inherits from the preceding event', () => {
    const out = extractTimestamps(
      [event('2024-01-15 10:00:00 first'), event('continuation with no date')],
      [fmt],
    );
    expect(iso(out[0]!._time)).toBe('2024-01-15T10:00:00.000Z');
    expect(iso(out[1]!._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('leaves the first event null when there is nothing to inherit from', () => {
    const out = extractTimestamps([event('no date here'), event('2024-01-15 10:00:00 later')], [fmt]);
    expect(out[0]!._time).toBeNull();
    expect(iso(out[1]!._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('inherits the most recent resolved time, not the first of the batch', () => {
    const out = extractTimestamps(
      [event('2024-01-15 10:00:00 a'), event('2024-01-16 11:00:00 b'), event('no date')],
      [fmt],
    );
    expect(iso(out[2]!._time)).toBe('2024-01-16T11:00:00.000Z');
  });

  it('inherits when TIME_PREFIX does not match at all', () => {
    const out = extractTimestamps(
      [event('ts=2024-01-15 10:00:00 a'), event('no prefix on this line')],
      [fmt, dir('TIME_PREFIX', 'ts=')],
    );
    expect(iso(out[1]!._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('records the inheritance in the trace rather than implying extraction', () => {
    const out = extractTimestamps([event('2024-01-15 10:00:00 a'), event('no date')], [fmt]);
    const step = out[1]!.processingTrace.at(-1);
    expect(step?.description).toContain('inherited');
  });
});
