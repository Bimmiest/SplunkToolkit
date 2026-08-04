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

/**
 * A fixed stand-in for index time. The tail of the fallback chain is the time of
 * indexing, so without pinning it these assertions would drift with the clock.
 */
const NOW = new Date('2026-08-04T00:00:00.000Z');

/** The step that resolved _time, which is where the provenance lives (#85). */
const timeSource = (e: SplunkEvent) =>
  e.processingTrace.filter((s) => s.processor === 'timestampExtractor').at(-1)?.timeSource;

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
  // date), so the event falls through to the rest of the chain.
  it('does not extract a mid-line date when TIME_PREFIX does not sit before it', () => {
    const e = extractTimestamps(
      [event('ts=pending job started 2024-01-15 10:00:00')],
      [dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S'), dir('TIME_PREFIX', 'ts=')],
      undefined,
      NOW,
    )[0]!;
    // The mid-line date is not used. With nothing to inherit from, the chain
    // ends at index time (#85) — what matters is that it did not come from the text.
    expect(iso(e._time)).toBe(NOW.toISOString());
    expect(timeSource(e)).toBe('current-time');
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

  it('falls back to index time when no timestamp is recognisable', () => {
    const e = extractTimestamps([event('no timestamp anywhere here')], [], undefined, NOW)[0]!;
    expect(iso(e._time)).toBe(NOW.toISOString());
    expect(timeSource(e)).toBe('current-time');
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
    const e = extractTimestamps([event('2024-02-30 10:00:00 x')], [fmt], undefined, NOW)[0]!;
    // Feb 30 is a parse failure, so the text supplies no timestamp and the
    // chain falls through — it must never roll over into a neighbouring date.
    expect(iso(e._time)).toBe(NOW.toISOString());
    expect(timeSource(e)).toBe('current-time');
  });

  it('rejects an out-of-range month (13)', () => {
    const e = extractTimestamps([event('2024-13-01 10:00:00 x')], [fmt], undefined, NOW)[0]!;
    // month 13 is a parse failure, so the text supplies no timestamp and the
    // chain falls through — it must never roll over into a neighbouring date.
    expect(iso(e._time)).toBe(NOW.toISOString());
    expect(timeSource(e)).toBe('current-time');
  });

  it('rejects an out-of-range hour (25)', () => {
    const e = extractTimestamps([event('2024-01-15 25:00:00 x')], [fmt], undefined, NOW)[0]!;
    // hour 25 is a parse failure, so the text supplies no timestamp and the
    // chain falls through — it must never roll over into a neighbouring date.
    expect(iso(e._time)).toBe(NOW.toISOString());
    expect(timeSource(e)).toBe('current-time');
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

  it('falls back to index time when there is nothing to inherit from', () => {
    const out = extractTimestamps(
      [event('no date here'), event('2024-01-15 10:00:00 later')],
      [fmt],
      undefined,
      NOW,
    );
    // Splunk always places an event on the timeline; the trace is what says the
    // value was not read from the event (#85).
    expect(iso(out[0]!._time)).toBe(NOW.toISOString());
    expect(timeSource(out[0]!)).toBe('current-time');
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

describe('#85 — DATETIME_CONFIG', () => {
  const fmt = dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S');

  it('CURRENT stamps index time and ignores the date in the event', () => {
    const e = extractTimestamps(
      [event('2024-01-15 10:00:00 has a perfectly good date')],
      [fmt, dir('DATETIME_CONFIG', 'CURRENT')],
      undefined,
      NOW,
    )[0]!;
    expect(iso(e._time)).toBe(NOW.toISOString());
    expect(timeSource(e)).toBe('datetime-config-current');
  });

  it('NONE disables extraction and says so distinctly', () => {
    const e = extractTimestamps(
      [event('2024-01-15 10:00:00 has a perfectly good date')],
      [fmt, dir('DATETIME_CONFIG', 'NONE')],
      undefined,
      NOW,
    )[0]!;
    expect(iso(e._time)).toBe(NOW.toISOString());
    expect(timeSource(e)).toBe('datetime-config-none');
  });

  it('is case-insensitive, as conf values are', () => {
    const e = extractTimestamps([event('x')], [dir('DATETIME_CONFIG', 'current')], undefined, NOW)[0]!;
    expect(timeSource(e)).toBe('datetime-config-current');
  });

  it('leaves extraction alone when it names a datetime.xml file', () => {
    // That file is unreachable from a browser, so the normal path runs and the
    // directive keeps its declared limitation rather than silently meaning CURRENT.
    const e = extractTimestamps(
      [event('2024-01-15 10:00:00 x')],
      [fmt, dir('DATETIME_CONFIG', '/etc/apps/my_app/datetime.xml')],
      undefined,
      NOW,
    )[0]!;
    expect(iso(e._time)).toBe('2024-01-15T10:00:00.000Z');
    expect(timeSource(e)).toBe('TIME_FORMAT');
  });
});

describe('#85 — timestamp sanity bounds', () => {
  const fmt = dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S');

  it('accepts a timestamp inside the default bounds', () => {
    const e = extractTimestamps([event('2026-08-03 10:00:00 x')], [fmt], undefined, NOW)[0]!;
    expect(iso(e._time)).toBe('2026-08-03T10:00:00.000Z');
    expect(timeSource(e)).toBe('TIME_FORMAT');
  });

  it('rejects a timestamp further back than MAX_DAYS_AGO', () => {
    const e = extractTimestamps(
      [event('2026-07-01 10:00:00 x')],
      [fmt, dir('MAX_DAYS_AGO', '7')],
      undefined,
      NOW,
    )[0]!;
    expect(iso(e._time)).toBe(NOW.toISOString());
    expect(timeSource(e)).toBe('current-time');
  });

  it('rejects a timestamp further ahead than MAX_DAYS_HENCE', () => {
    // Default MAX_DAYS_HENCE is 2 days, so a date a year out is refused.
    const e = extractTimestamps([event('2027-08-04 10:00:00 x')], [fmt], undefined, NOW)[0]!;
    expect(timeSource(e)).toBe('current-time');
  });

  it('falls back to the previous event rather than the clock when there is one', () => {
    const out = extractTimestamps(
      [event('2026-08-03 10:00:00 good'), event('2027-08-04 10:00:00 way out')],
      [fmt],
      undefined,
      NOW,
    );
    expect(iso(out[1]!._time)).toBe('2026-08-03T10:00:00.000Z');
    expect(timeSource(out[1]!)).toBe('previous-event');
  });

  it('rejects a jump backwards beyond MAX_DIFF_SECS_AGO', () => {
    const out = extractTimestamps(
      [event('2026-08-03 10:00:00 first'), event('2026-08-03 08:00:00 two hours earlier')],
      [fmt, dir('MAX_DIFF_SECS_AGO', '3600')],
      undefined,
      NOW,
    );
    expect(iso(out[1]!._time)).toBe('2026-08-03T10:00:00.000Z');
    expect(timeSource(out[1]!)).toBe('previous-event');
  });

  it('allows a backwards jump within MAX_DIFF_SECS_AGO', () => {
    const out = extractTimestamps(
      [event('2026-08-03 10:00:00 first'), event('2026-08-03 09:30:00 half an hour earlier')],
      [fmt, dir('MAX_DIFF_SECS_AGO', '3600')],
      undefined,
      NOW,
    );
    expect(iso(out[1]!._time)).toBe('2026-08-03T09:30:00.000Z');
    expect(timeSource(out[1]!)).toBe('TIME_FORMAT');
  });

  it('warns once per reason rather than once per event', () => {
    const diagnostics: ValidationDiagnostic[] = [];
    extractTimestamps(
      [event('2027-08-04 10:00:00 a'), event('2027-08-05 10:00:00 b'), event('2027-08-06 10:00:00 c')],
      [fmt],
      diagnostics,
      NOW,
    );
    const bounds = diagnostics.filter((d) => d.message.includes('MAX_DAYS_HENCE'));
    expect(bounds).toHaveLength(1);
    expect(bounds[0]?.level).toBe('warning');
  });

  it('names the bound that rejected the timestamp in the trace', () => {
    const e = extractTimestamps([event('2027-08-04 10:00:00 x')], [fmt], undefined, NOW)[0]!;
    const step = e.processingTrace.at(-1);
    expect(step?.description).toContain('MAX_DAYS_HENCE');
    expect(step?.description).toContain('rejected');
  });

  it('an out-of-bounds timestamp does not become the baseline for the next event', () => {
    // If the rejected value were recorded, the following event would be
    // measured against a time Splunk never accepted.
    const out = extractTimestamps(
      [event('2026-08-03 10:00:00 good'), event('2027-08-04 10:00:00 rejected'), event('no date')],
      [fmt],
      undefined,
      NOW,
    );
    expect(iso(out[2]!._time)).toBe('2026-08-03T10:00:00.000Z');
  });
});

describe('#85 — MAX_DIFF_SECS_HENCE', () => {
  const fmt = dir('TIME_FORMAT', '%Y-%m-%d %H:%M:%S');

  it('rejects a jump forwards beyond MAX_DIFF_SECS_HENCE', () => {
    // Three days after the previous event, but still inside MAX_DAYS_HENCE — so
    // this isolates the previous-event bound from the wall-clock one.
    const out = extractTimestamps(
      [event('2026-08-01 10:00:00 first'), event('2026-08-04 09:00:00 three days later')],
      [fmt, dir('MAX_DIFF_SECS_HENCE', '3600')],
      undefined,
      NOW,
    );
    expect(iso(out[1]!._time)).toBe('2026-08-01T10:00:00.000Z');
    expect(timeSource(out[1]!)).toBe('previous-event');
  });

  it('allows a forwards jump within MAX_DIFF_SECS_HENCE', () => {
    const out = extractTimestamps(
      [event('2026-08-01 10:00:00 first'), event('2026-08-01 10:30:00 half an hour later')],
      [fmt, dir('MAX_DIFF_SECS_HENCE', '3600')],
      undefined,
      NOW,
    );
    expect(iso(out[1]!._time)).toBe('2026-08-01T10:30:00.000Z');
    expect(timeSource(out[1]!)).toBe('TIME_FORMAT');
  });
});
