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
    const [e] = extractTimestamps(
      [event('2024-01-15 10:00:00 some log')],
      [dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S')],
    );
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('respects TIME_PREFIX', () => {
    const [e] = extractTimestamps(
      [event('id=5 ts=2024-01-15T10:00:00 rest')],
      [dir('TIME_FORMAT', '%Y-%m-%dT%H:%M:%S'), dir('TIME_PREFIX', 'ts=')],
    );
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  // SEM-9: %z must match a trailing ISO-8601 'Z' (and keep it UTC even when TZ is set).
  it('matches %z against a literal Z and stays UTC despite a configured TZ', () => {
    const [e] = extractTimestamps(
      [event('2024-01-15T10:00:00Z some log')],
      [dir('TIME_FORMAT', '%Y-%m-%dT%H:%M:%S%z'), dir('TZ', 'America/New_York')],
    );
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });
});

describe('extractTimestamps — auto recognition (no TIME_FORMAT)', () => {
  it('recognises ISO 8601', () => {
    const [e] = extractTimestamps([event('2024-01-15T10:00:00 hello')], []);
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('recognises ISO 8601 with Z as UTC', () => {
    const [e] = extractTimestamps([event('2024-01-15T10:00:00.250Z hello')], []);
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.250Z');
  });

  it('honours a numeric zone offset', () => {
    const [e] = extractTimestamps([event('2024-01-15T10:00:00+05:00 hello')], []);
    expect(iso(e._time)).toBe('2024-01-15T05:00:00.000Z');
  });

  it('recognises an Apache access-log timestamp', () => {
    const [e] = extractTimestamps([event('10.0.0.1 - - [15/Jan/2024:10:00:00 +0000] "GET /"')], []);
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('recognises a leading epoch (seconds)', () => {
    const [e] = extractTimestamps([event('1705312800 event body')], []);
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('respects TIME_PREFIX during auto recognition', () => {
    const [e] = extractTimestamps(
      [event('garbage 9999 when=2024-01-15T10:00:00 tail')],
      [dir('TIME_PREFIX', 'when=')],
    );
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
  });

  it('leaves _time null when no timestamp is recognisable', () => {
    const [e] = extractTimestamps([event('no timestamp anywhere here')], []);
    expect(e._time).toBeNull();
  });

  // #12: position-scored recognition — the timestamp at the front of the region
  // wins over a more-specific one embedded later in the message body.
  it('prefers the earliest timestamp over a more-specific one deeper in the text', () => {
    const [e] = extractTimestamps([event('01/02/2024 note 2023-06-15T08:00:00 tail')], []);
    expect(iso(e._time)).toBe('2024-01-02T00:00:00.000Z');
  });
});

// #12: out-of-range fields are a parse failure, not a silent Date rollover.
describe('extractTimestamps — range validation (#12)', () => {
  const fmt = dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S');

  it('rejects an impossible day (Feb 30) instead of rolling into March', () => {
    const [e] = extractTimestamps([event('2024-02-30 10:00:00 x')], [fmt]);
    expect(e._time).toBeNull();
  });

  it('rejects an out-of-range month (13)', () => {
    const [e] = extractTimestamps([event('2024-13-01 10:00:00 x')], [fmt]);
    expect(e._time).toBeNull();
  });

  it('rejects an out-of-range hour (25)', () => {
    const [e] = extractTimestamps([event('2024-01-15 25:00:00 x')], [fmt]);
    expect(e._time).toBeNull();
  });

  it('still accepts a valid leap day', () => {
    const [e] = extractTimestamps([event('2024-02-29 10:00:00 x')], [fmt]);
    expect(iso(e._time)).toBe('2024-02-29T10:00:00.000Z');
  });
});

// #12: an unresolvable timezone is treated as UTC but now warns instead of
// drifting silently.
describe('extractTimestamps — timezone resolution (#12)', () => {
  const fmt = dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S');

  it('warns when the TZ cannot be resolved and falls back to UTC', () => {
    const diags: ValidationDiagnostic[] = [];
    const [e] = extractTimestamps([event('2024-01-15 10:00:00 x')], [fmt, dir('TZ', 'Europe/London')], diags);
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
    expect(diags.some((d) => d.level === 'warning' && /Europe\/London/.test(d.message))).toBe(true);
  });

  it('does not warn for a resolvable numeric TZ offset', () => {
    const diags: ValidationDiagnostic[] = [];
    const [e] = extractTimestamps([event('2024-01-15 10:00:00 x')], [fmt, dir('TZ', '-0500')], diags);
    // TZ=-0500 → local 10:00 is 15:00 UTC.
    expect(iso(e._time)).toBe('2024-01-15T15:00:00.000Z');
    expect(diags).toHaveLength(0);
  });

  it('warns only once for the same unresolved TZ across many events', () => {
    const diags: ValidationDiagnostic[] = [];
    extractTimestamps(
      [event('2024-01-15 10:00:00 a'), event('2024-01-16 11:00:00 b')],
      [fmt, dir('TZ', 'Europe/London')],
      diags,
    );
    expect(diags.filter((d) => /Europe\/London/.test(d.message))).toHaveLength(1);
  });
});
