import { describe, it, expect } from 'vitest';
import { probeTimestamp, probeTimestamps } from '../timestampMatch';
import type { TimeConfig } from '../timestampMatch';

function config(overrides: Partial<TimeConfig> = {}): TimeConfig {
  return { timePrefix: null, timeFormat: null, maxLookahead: 128, tz: null, ...overrides };
}

describe('probeTimestamp — matching', () => {
  it('finds a timestamp with no TIME_PREFIX', () => {
    const raw = '2026-04-21 10:00:00 something happened';
    const { match } = probeTimestamp(raw, config({ timeFormat: '%Y-%m-%d %H:%M:%S' }));
    expect(match).not.toBeNull();
    expect(match!.matchedText).toBe('2026-04-21 10:00:00');
    expect(raw.substring(match!.tsStart, match!.tsEnd)).toBe('2026-04-21 10:00:00');
    expect(match!.parsedTimeMs).not.toBeNull();
  });

  it('anchors the search after a TIME_PREFIX match', () => {
    const raw = 'ignore 1999-01-01 ts=2026-04-21 10:00:00 rest';
    const { match } = probeTimestamp(
      raw,
      config({ timePrefix: 'ts=', timeFormat: '%Y-%m-%d %H:%M:%S' }),
    );
    expect(match).not.toBeNull();
    // The 1999 date precedes the prefix, so it must not win.
    expect(match!.matchedText).toBe('2026-04-21 10:00:00');
    expect(raw.substring(match!.prefixStart, match!.prefixEnd)).toBe('ts=');
  });

  it('honours MAX_TIMESTAMP_LOOKAHEAD', () => {
    const raw = 'ts=' + ' '.repeat(60) + '2026-04-21 10:00:00';
    const tight = probeTimestamp(
      raw,
      config({ timePrefix: 'ts=', timeFormat: '%Y-%m-%d %H:%M:%S', maxLookahead: 10 }),
    );
    expect(tight.match).toBeNull();

    const loose = probeTimestamp(
      raw,
      config({ timePrefix: 'ts=', timeFormat: '%Y-%m-%d %H:%M:%S', maxLookahead: 128 }),
    );
    expect(loose.match).not.toBeNull();
  });

  it('reports no match when TIME_PREFIX is absent from the event', () => {
    const probe = probeTimestamp(
      'no prefix here 2026-04-21 10:00:00',
      config({ timePrefix: 'ts=', timeFormat: '%Y-%m-%d %H:%M:%S' }),
    );
    expect(probe.match).toBeNull();
    expect(probe.prefix).toBeNull();
  });
});

describe('probeTimestamp — the prefix span the overlay renders', () => {
  // The overlay draws the lookahead window whenever TIME_PREFIX matched, even
  // when TIME_FORMAT then did not — that is what distinguishes "the prefix is
  // wrong" from "the format is wrong". It used to re-run the regex on the render
  // thread to recover this; now it comes back on the probe (#117).
  it('carries the prefix span when the prefix matched but the format did not', () => {
    const raw = 'ts=not-a-timestamp at all';
    const probe = probeTimestamp(
      raw,
      config({ timePrefix: 'ts=', timeFormat: '%Y-%m-%d %H:%M:%S', maxLookahead: 10 }),
    );
    expect(probe.match).toBeNull();
    expect(probe.prefix).not.toBeNull();
    expect(raw.substring(probe.prefix!.start, probe.prefix!.end)).toBe('ts=');
    expect(probe.prefix!.lookaheadEnd).toBe(Math.min(3 + 10, raw.length));
  });

  it('carries the prefix span when TIME_FORMAT is not set yet', () => {
    // Halfway through writing a config: prefix typed, format not.
    const probe = probeTimestamp('ts=2026-04-21', config({ timePrefix: 'ts=' }));
    expect(probe.match).toBeNull();
    expect(probe.prefix).not.toBeNull();
  });

  it('clamps the lookahead window to the end of the event', () => {
    const raw = 'ts=x';
    const probe = probeTimestamp(raw, config({ timePrefix: 'ts=', maxLookahead: 9999 }));
    expect(probe.prefix!.lookaheadEnd).toBe(raw.length);
  });
});

describe('probeTimestamp — patterns safeRegex refuses', () => {
  it('reports nothing rather than throwing when TIME_PREFIX will not compile', () => {
    const probe = probeTimestamp(
      'ts=2026-04-21 10:00:00',
      config({ timePrefix: '(?<', timeFormat: '%Y-%m-%d %H:%M:%S' }),
    );
    expect(probe.match).toBeNull();
    expect(probe.prefix).toBeNull();
  });
});

describe('probeTimestamps — batch', () => {
  it('returns one probe per input, aligned to the inputs', () => {
    const probes = probeTimestamps(
      ['2026-04-21 10:00:00 a', 'no timestamp', '2026-04-22 11:00:00 b'],
      config({ timeFormat: '%Y-%m-%d %H:%M:%S' }),
    );
    expect(probes).toHaveLength(3);
    expect(probes[0]!.match?.matchedText).toBe('2026-04-21 10:00:00');
    expect(probes[1]!.match).toBeNull();
    expect(probes[2]!.match?.matchedText).toBe('2026-04-22 11:00:00');
  });

  it('carries parsedTimeMs as a primitive, so it survives a structured clone', () => {
    // The worker boundary is why this is a number and not a Date. Asserting the
    // type keeps a future refactor from quietly putting a Date back on the wire.
    const probe = probeTimestamps(['2026-04-21 10:00:00'], config({ timeFormat: '%Y-%m-%d %H:%M:%S' }))[0]!;
    expect(typeof probe.match!.parsedTimeMs).toBe('number');
    expect(new Date(probe.match!.parsedTimeMs!).toISOString()).toContain('2026-04-21');
  });
});
