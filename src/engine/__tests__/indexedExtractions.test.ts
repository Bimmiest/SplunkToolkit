import { describe, it, expect } from 'vitest';
import { applyIndexedExtractions } from '../processors/indexedExtractions';
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

function dir(value: string): ConfDirective {
  return { key: 'INDEXED_EXTRACTIONS', value, line: 1, directiveType: 'INDEXED_EXTRACTIONS' };
}

describe('applyIndexedExtractions — JSON', () => {
  it('extracts top-level JSON fields', () => {
    const events = applyIndexedExtractions(
      [event('{"action":"login","user":"alice","status":200}')],
      [dir('json')]
    );
    expect(events[0].fields['action']).toBe('login');
    expect(events[0].fields['user']).toBe('alice');
    // Numeric JSON values are stringified when stored in SplunkEvent.fields
    expect(events[0].fields['status']).toBe('200');
  });

  it('flattens nested JSON with dot notation', () => {
    const events = applyIndexedExtractions(
      [event('{"request":{"method":"GET","path":"/api"}}')],
      [dir('json')]
    );
    expect(events[0].fields['request.method']).toBe('GET');
    expect(events[0].fields['request.path']).toBe('/api');
  });

  it('returns event unchanged for invalid JSON', () => {
    const events = applyIndexedExtractions([event('not json')], [dir('json')]);
    expect(events[0].fields).toEqual({});
  });
});

describe('applyIndexedExtractions — CSV', () => {
  it('header row (first event) maps to data rows (subsequent events)', () => {
    // Simulates LINE_BREAKER having already split the CSV into one event per line
    const header = event('timestamp,action,user');
    const row1 = event('2024-01-15,login,alice');
    const row2 = event('2024-01-16,logout,bob');

    const events = applyIndexedExtractions([header, row1, row2], [dir('csv')]);

    // Header event itself should have no extracted fields
    expect(events[0].fields).toEqual({});

    // Data rows should have fields from header
    expect(events[1].fields['timestamp']).toBe('2024-01-15');
    expect(events[1].fields['action']).toBe('login');
    expect(events[1].fields['user']).toBe('alice');

    expect(events[2].fields['user']).toBe('bob');
  });

  it('handles quoted CSV fields', () => {
    const header = event('name,description');
    const row = event('"Smith, John","A ""quoted"" value"');
    const events = applyIndexedExtractions([header, row], [dir('csv')]);
    expect(events[1].fields['name']).toBe('Smith, John');
    expect(events[1].fields['description']).toBe('A "quoted" value');
  });
});

describe('applyIndexedExtractions — TSV', () => {
  it('splits on tabs', () => {
    const header = event('ts\thost\tsource');
    const row = event('2024-01-15\tmyhost\t/var/log/app');
    const events = applyIndexedExtractions([header, row], [dir('tsv')]);
    expect(events[1].fields['host']).toBe('myhost');
    expect(events[1].fields['source']).toBe('/var/log/app');
  });
});

describe('applyIndexedExtractions — no directive', () => {
  it('returns events unchanged when no INDEXED_EXTRACTIONS directive', () => {
    const ev = event('some raw data');
    const events = applyIndexedExtractions([ev], []);
    expect(events[0].fields).toEqual({});
  });
});
