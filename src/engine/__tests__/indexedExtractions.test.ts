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

  it('extracts a key named after a prototype member instead of mangling it', () => {
    const events = applyIndexedExtractions([event('{"toString":"v"}')], [dir('json')]);
    expect(events[0].fields['toString']).toBe('v');
  });

  it('extracts prototype-colliding keys as real fields after underscore stripping', () => {
    // INDEXED_EXTRACTIONS strips leading underscores, so `_constructor` becomes
    // `constructor`. Splunk's spath/KV_MODE=json extract such keys verbatim, so
    // the value must land as an *own* data property (not the inherited function).
    const events = applyIndexedExtractions(
      [event('{"_constructor":"good","keep":"ok"}')],
      [dir('json')]
    );
    expect(Object.prototype.hasOwnProperty.call(events[0].fields, 'constructor')).toBe(true);
    expect(events[0].fields['constructor']).toBe('good');
    expect(events[0].fields['keep']).toBe('ok');
  });

  it('names array-of-object fields with {} multivalue notation (not positional)', () => {
    const events = applyIndexedExtractions(
      [event('{"items":[{"id":1,"n":"a"},{"id":2,"n":"b"}]}')],
      [dir('json')]
    );
    expect(events[0].fields['items{}.id']).toEqual(['1', '2']);
    expect(events[0].fields['items{}.n']).toEqual(['a', 'b']);
    // Positional and stringified-parent forms must NOT appear.
    expect(events[0].fields['items.0.id']).toBeUndefined();
    expect(events[0].fields['items']).toBeUndefined();
  });

  it('names primitive arrays with {} as a multivalue field', () => {
    const events = applyIndexedExtractions([event('{"tags":["x","y","z"]}')], [dir('json')]);
    expect(events[0].fields['tags{}']).toEqual(['x', 'y', 'z']);
    expect(events[0].fields['tags']).toBeUndefined();
  });

  it('does not emit a stringified container field for nested objects', () => {
    const events = applyIndexedExtractions(
      [event('{"user":{"name":"alice","id":5}}')],
      [dir('json')]
    );
    expect(events[0].fields['user.name']).toBe('alice');
    expect(events[0].fields['user.id']).toBe('5');
    expect(events[0].fields['user']).toBeUndefined();
  });

  it('decodes escaped characters via JSON.parse', () => {
    const events = applyIndexedExtractions(
      [event('{"msg":"line1\\nline2","q":"say \\"hi\\"","path":"C:\\\\tmp"}')],
      [dir('json')]
    );
    expect(events[0].fields['msg']).toBe('line1\nline2');
    expect(events[0].fields['q']).toBe('say "hi"');
    expect(events[0].fields['path']).toBe('C:\\tmp');
  });

  it('extracts a top-level JSON array', () => {
    const events = applyIndexedExtractions(
      [event('[{"id":1},{"id":2}]')],
      [dir('json')]
    );
    expect(events[0].fields['{}.id']).toEqual(['1', '2']);
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
  it('header row maps to data rows and is not itself emitted as an event', () => {
    // Simulates LINE_BREAKER having already split the CSV into one event per line
    const header = event('timestamp,action,user');
    const row1 = event('2024-01-15,login,alice');
    const row2 = event('2024-01-16,logout,bob');

    const events = applyIndexedExtractions([header, row1, row2], [dir('csv')]);

    // The header line is consumed as metadata — only the two data rows remain.
    expect(events).toHaveLength(2);

    expect(events[0].fields['timestamp']).toBe('2024-01-15');
    expect(events[0].fields['action']).toBe('login');
    expect(events[0].fields['user']).toBe('alice');

    expect(events[1].fields['user']).toBe('bob');
  });

  it('handles quoted CSV fields', () => {
    const header = event('name,description');
    const row = event('"Smith, John","A ""quoted"" value"');
    const events = applyIndexedExtractions([header, row], [dir('csv')]);
    expect(events[0].fields['name']).toBe('Smith, John');
    expect(events[0].fields['description']).toBe('A "quoted" value');
  });
});

describe('applyIndexedExtractions — CSV quoting', () => {
  it('preserves interior whitespace of quoted fields but trims unquoted ones', () => {
    const header = event('name,note');
    const row = event('  bob  ,"  spaced value  "');
    const events = applyIndexedExtractions([header, row], [dir('csv')]);
    expect(events[0].fields['name']).toBe('bob');
    expect(events[0].fields['note']).toBe('  spaced value  ');
  });
});

describe('applyIndexedExtractions — W3C quoting', () => {
  it('keeps a quoted field containing spaces as a single value', () => {
    const header = event('#Fields: cs-method cs(User-Agent) sc-status');
    const row = event('GET "Mozilla/5.0 (Windows NT 10.0)" 200');
    const events = applyIndexedExtractions([header, row], [dir('w3c')]);
    // Header tokens are sanitized to the names Splunk indexes (#68): the IIS
    // user-agent column really does surface as `cs_User_Agent_`.
    expect(events[0].fields['cs_method']).toBe('GET');
    expect(events[0].fields['cs_User_Agent_']).toBe('Mozilla/5.0 (Windows NT 10.0)');
    expect(events[0].fields['sc_status']).toBe('200');
  });
});

describe('applyIndexedExtractions — TSV', () => {
  it('splits on tabs', () => {
    const header = event('ts\thost\tsource');
    const row = event('2024-01-15\tmyhost\t/var/log/app');
    const events = applyIndexedExtractions([header, row], [dir('tsv')]);
    expect(events[0].fields['host']).toBe('myhost');
    expect(events[0].fields['source']).toBe('/var/log/app');
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
    expect(events[0].fields['ts']).toBe('2024-01-15');
    expect(events[0].fields['user']).toBe('alice');
    expect(events[0].fields['action']).toBe('login');
    expect(events[0].fields['_ts']).toBeUndefined();
  });

  it('strips leading _ from W3C #Fields headers', () => {
    const header = event('#Fields: _cs-method uri status');
    const row = event('GET /api 200');
    const events = applyIndexedExtractions([header, row], [dir('w3c')]);
    expect(events[0].fields['cs_method']).toBe('GET');
    expect(events[0].fields['uri']).toBe('/api');
    expect(events[0].fields['status']).toBe('200');
    expect(events[0].fields['_cs_method']).toBeUndefined();
  });
});

describe('applyIndexedExtractions — no directive', () => {
  it('returns events unchanged when no INDEXED_EXTRACTIONS directive', () => {
    const ev = event('some raw data');
    const events = applyIndexedExtractions([ev], []);
    expect(events[0].fields).toEqual({});
  });
});

describe('applyIndexedExtractions — header is the first content line (#14)', () => {
  it('skips a leading blank line', () => {
    const events = applyIndexedExtractions(
      [event(''), event('ts,host'), event('2024-01-15,myhost')],
      [dir('csv')],
    );
    expect(events).toHaveLength(1);
    expect(events[0].fields.host).toBe('myhost');
  });

  it('skips a leading comment line', () => {
    const events = applyIndexedExtractions(
      [event('# exported 2024-01-15'), event('ts,host'), event('2024-01-15,myhost')],
      [dir('csv')],
    );
    expect(events).toHaveLength(1);
    expect(events[0].fields.host).toBe('myhost');
    expect(events[0].fields['#_exported_2024_01_15']).toBeUndefined();
  });

  it('returns events unchanged when there is no content line at all', () => {
    const events = applyIndexedExtractions([event(''), event('   ')], [dir('csv')]);
    expect(events).toHaveLength(2);
  });
});

describe('applyIndexedExtractions — header names are sanitized (#68)', () => {
  it('rewrites W3C hyphens to underscores', () => {
    const events = applyIndexedExtractions(
      [event('#Fields: date time c-ip cs-uri-stem sc-status'), event('2024-01-15 10:00:00 10.0.0.1 /index.html 200')],
      [dir('w3c')],
    );
    expect(events[0].fields.c_ip).toBe('10.0.0.1');
    expect(events[0].fields.cs_uri_stem).toBe('/index.html');
    expect(events[0].fields.sc_status).toBe('200');
    expect(events[0].fields['cs-uri-stem']).toBeUndefined();
  });

  it('rewrites delimited header names too', () => {
    const events = applyIndexedExtractions(
      [event('req-id,user.name,status'), event('abc,alice,200')],
      [dir('csv')],
    );
    expect(events[0].fields.req_id).toBe('abc');
    expect(events[0].fields.user_name).toBe('alice');
  });

  it('drops a W3C directive line that is not the first event', () => {
    const events = applyIndexedExtractions(
      [event('#Software: IIS'), event('#Fields: cs-method sc-status'), event('GET 200')],
      [dir('w3c')],
    );
    expect(events).toHaveLength(1);
    expect(events[0].fields.cs_method).toBe('GET');
  });
});
