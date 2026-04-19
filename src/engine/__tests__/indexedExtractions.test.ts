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

  it('populates fieldSourceKeys for underscore-stripped JSON keys', () => {
    const events = applyIndexedExtractions(
      [event('{"_GID":"100","_UID":"1000","normalKey":"value"}')],
      [dir('json')]
    );
    const sourceKeys = events[0].fieldSourceKeys ?? {};
    expect(sourceKeys['GID']).toBe('_GID');
    expect(sourceKeys['UID']).toBe('_UID');
    // Keys that were not stripped should not appear in fieldSourceKeys
    expect(sourceKeys['normalKey']).toBeUndefined();
  });

  it('fieldSourceKeys maps all _AUDIT_FIELD_* variants correctly', () => {
    const events = applyIndexedExtractions(
      [event('{"_AUDIT_SESSION":"3","_AUDIT_FIELD_EXIT":"0","_AUDIT_TYPE_NAME":"SYSCALL"}')],
      [dir('json')]
    );
    const sourceKeys = events[0].fieldSourceKeys ?? {};
    expect(sourceKeys['AUDIT_SESSION']).toBe('_AUDIT_SESSION');
    expect(sourceKeys['AUDIT_FIELD_EXIT']).toBe('_AUDIT_FIELD_EXIT');
    expect(sourceKeys['AUDIT_TYPE_NAME']).toBe('_AUDIT_TYPE_NAME');
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

describe('applyIndexedExtractions — leading underscore stripping', () => {
  it('strips leading _ from top-level JSON keys', () => {
    const events = applyIndexedExtractions(
      [event('{"_AUDIT_TYPE_NAME":"SYSCALL","user":"alice"}')],
      [dir('json')]
    );
    expect(events[0].fields['AUDIT_TYPE_NAME']).toBe('SYSCALL');
    expect(events[0].fields['_AUDIT_TYPE_NAME']).toBeUndefined();
    expect(events[0].fields['user']).toBe('alice');
  });

  it('strips leading _ from nested JSON keys at every depth', () => {
    const events = applyIndexedExtractions(
      [event('{"outer":{"_inner":"value","normal":"v2"}}')],
      [dir('json')]
    );
    expect(events[0].fields['outer.inner']).toBe('value');
    expect(events[0].fields['outer.normal']).toBe('v2');
    expect(events[0].fields['outer._inner']).toBeUndefined();
  });

  it('strips multiple leading underscores', () => {
    const events = applyIndexedExtractions(
      [event('{"__double":"v"}')],
      [dir('json')]
    );
    expect(events[0].fields['double']).toBe('v');
  });

  it('strips leading _ from CSV headers', () => {
    const header = event('_ts,_user,action');
    const row = event('2024-01-15,alice,login');
    const events = applyIndexedExtractions([header, row], [dir('csv')]);
    expect(events[1].fields['ts']).toBe('2024-01-15');
    expect(events[1].fields['user']).toBe('alice');
    expect(events[1].fields['action']).toBe('login');
    expect(events[1].fields['_ts']).toBeUndefined();
  });

  it('strips leading _ from W3C #Fields headers', () => {
    const header = event('#Fields: _cs-method uri status');
    const row = event('GET /api 200');
    const events = applyIndexedExtractions([header, row], [dir('w3c')]);
    expect(events[1].fields['cs-method']).toBe('GET');
    expect(events[1].fields['uri']).toBe('/api');
    expect(events[1].fields['status']).toBe('200');
    expect(events[1].fields['_cs-method']).toBeUndefined();
  });
});

describe('applyIndexedExtractions — no directive', () => {
  it('returns events unchanged when no INDEXED_EXTRACTIONS directive', () => {
    const ev = event('some raw data');
    const events = applyIndexedExtractions([ev], []);
    expect(events[0].fields).toEqual({});
  });
});
