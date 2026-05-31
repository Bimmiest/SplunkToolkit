import { describe, it, expect } from 'vitest';
import { extractTimestamps } from '../processors/timestampExtractor';
import type { SplunkEvent, ConfDirective } from '../types';

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
});
