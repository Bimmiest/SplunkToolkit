import { describe, it, expect } from 'vitest';
import { parseTimestamp, strftimeToRegex } from '../strftime';

/** Helper: ISO string of a parsed timestamp, or null. */
function iso(text: string, format: string, tz?: string): string | null {
  const d = parseTimestamp(text, format, tz);
  return d ? d.toISOString() : null;
}

describe('strftime — baseline directives (regression)', () => {
  it('parses a full ISO-8601 timestamp with milliseconds', () => {
    expect(iso('2024-01-15T10:00:00.123', '%Y-%m-%dT%H:%M:%S.%3N'))
      .toBe('2024-01-15T10:00:00.123Z');
  });

  it('parses month abbreviations', () => {
    expect(iso('Jan 15 2024 10:00:00', '%b %d %Y %H:%M:%S'))
      .toBe('2024-01-15T10:00:00.000Z');
  });

  it('applies a numeric %z offset', () => {
    expect(iso('2024-01-15T10:00:00+05:30', '%Y-%m-%dT%H:%M:%S%z'))
      .toBe('2024-01-15T04:30:00.000Z');
  });

  it('rejects out-of-range components', () => {
    expect(parseTimestamp('2024-13-15 10:00:00', '%Y-%m-%d %H:%M:%S')).toBeNull();
    expect(parseTimestamp('2024-01-32 10:00:00', '%Y-%m-%d %H:%M:%S')).toBeNull();
  });

  it('expands the %T and %F composites', () => {
    expect(iso('2024-01-15 10:00:00', '%F %T')).toBe('2024-01-15T10:00:00.000Z');
  });
});

describe('#69.1 — Splunk enhanced-strptime specifiers', () => {
  it('supports %:z (offset with a colon)', () => {
    expect(iso('2024-01-02T03:04:05+05:30', '%Y-%m-%dT%H:%M:%S%:z'))
      .toBe('2024-01-01T21:34:05.000Z');
  });

  it('supports %::z (offset with seconds)', () => {
    expect(iso('2024-01-02T03:04:05+05:30:00', '%Y-%m-%dT%H:%M:%S%::z'))
      .toBe('2024-01-01T21:34:05.000Z');
  });

  it('supports bare %N as %9N (nanoseconds)', () => {
    expect(iso('2024-01-15T10:00:00.123456789', '%Y-%m-%dT%H:%M:%S.%N'))
      .toBe('2024-01-15T10:00:00.123Z');
  });

  it('supports the %Q subsecond family with %s', () => {
    // 1712345678 seconds + 123 ms
    expect(parseTimestamp('1712345678123', '%s%3Q')?.getTime()).toBe(1712345678123);
    // bare %Q == %3Q
    expect(parseTimestamp('1712345678123', '%s%Q')?.getTime()).toBe(1712345678123);
  });
});

describe('#69.2 — %s must not discard captured subseconds', () => {
  it('folds %3N milliseconds into an epoch-seconds timestamp', () => {
    expect(parseTimestamp('1712345678123', '%s%3N')?.getTime()).toBe(1712345678123);
  });

  it('folds %6N microseconds (floored to ms) into %s', () => {
    // 1712345678 s + 456789 us -> +456 ms
    expect(parseTimestamp('1712345678456789', '%s%6N')?.getTime()).toBe(1712345678456);
  });
});

describe('#69.3 — numeric directives accept 1-2 unpadded digits', () => {
  it('parses US-style unpadded dates and times', () => {
    expect(iso('1/5/2024 3:04:05', '%m/%d/%Y %H:%M:%S'))
      .toBe('2024-01-05T03:04:05.000Z');
  });

  it('still parses zero-padded values', () => {
    expect(iso('01/05/2024 03:04:05', '%m/%d/%Y %H:%M:%S'))
      .toBe('2024-01-05T03:04:05.000Z');
  });
});

describe('#69.4 — %y century pivot (POSIX)', () => {
  it('maps 69 to 1969', () => {
    expect(iso('69-01-02', '%y-%m-%d')).toBe('1969-01-02T00:00:00.000Z');
  });

  it('maps 68 to 2068', () => {
    expect(iso('68-01-02', '%y-%m-%d')).toBe('2068-01-02T00:00:00.000Z');
  });

  it('maps 70 to 1970', () => {
    expect(iso('70-01-02', '%y-%m-%d')).toBe('1970-01-02T00:00:00.000Z');
  });
});

describe('#69.5 — %%T must not corrupt into %H handling', () => {
  it('treats %%T as a literal percent followed by T', () => {
    expect(strftimeToRegex('%%T').source).toBe('%T');
  });

  it('matches a literal "%T" in the text', () => {
    expect(iso('2024-01-15%T', '%Y-%m-%d%%T')).toBe('2024-01-15T00:00:00.000Z');
  });

  it('still expands a standalone %T', () => {
    expect(strftimeToRegex('%T').source).toBe('(\\d{1,2}):(\\d{1,2}):(\\d{1,2})');
  });
});
