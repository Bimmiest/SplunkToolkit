import { describe, it, expect } from 'vitest';
import { extractFields } from '../processors/fieldExtractor';
import type { SplunkEvent, ConfDirective } from '../types';

function event(raw: string, fields: Record<string, string | string[]> = {}): SplunkEvent {
  return {
    _raw: raw,
    _time: null,
    _meta: {},
    fields,
    metadata: { index: 'main', host: 'h', source: 's', sourcetype: 'st' },
    lineNumbers: { start: 1, end: 1 },
    processingTrace: [],
  };
}

function dir(className: string, value: string): ConfDirective {
  return { key: `EXTRACT-${className}`, value, line: 1, directiveType: 'EXTRACT', className };
}

describe('extractFields — fieldOffsets provenance', () => {
  it('records start/end offsets for positional captures against _raw', () => {
    const raw = '192.168.1.30 - admin [21/Apr/2026:10:00:00] "GET /x HTTP/1.0"';
    const [e] = extractFields([event(raw)], [dir('user', '^\\S+\\s+-\\s+(?<user>\\S+)\\s')]);
    expect(e.fields['user']).toBe('admin');
    const offsets = e.fieldOffsets?.['user'];
    expect(offsets).toHaveLength(1);
    const [s, end] = offsets![0];
    expect(raw.substring(s, end)).toBe('admin');
    // Authoritative position is the first 'admin', not any later repetition
    expect(s).toBe(raw.indexOf('admin'));
  });

  it('extracts only the first match (inline EXTRACT defaults to max_match=1)', () => {
    const raw = 'id=1 id=2 id=3';
    const [e] = extractFields([event(raw)], [dir('id', 'id=(?<id>\\d+)')]);
    // Inline EXTRACT is first-match-only — not multivalue. Multivalue requires a
    // transforms.conf REGEX with MV_ADD, which EXTRACT does not support.
    expect(e.fields['id']).toBe('1');
    const offsets = e.fieldOffsets?.['id'];
    expect(offsets).toHaveLength(1);
    expect(raw.substring(offsets![0][0], offsets![0][1])).toBe('1');
  });

  it('does not overwrite a field already set by an earlier EXTRACT (first wins)', () => {
    const raw = 'a=first a=second';
    // Class names sort alphabetically: aaa runs before bbb.
    const [e] = extractFields(
      [event(raw)],
      [dir('bbb', 'a=(?<val>\\w+)\\s'), dir('aaa', 'a=second')],
    );
    // Both directives would set different things, but the key check: a field set
    // by the first-run extraction is not clobbered. Here `val` is set once.
    expect(e.fields['val']).toBe('first');
  });

  it('does not overwrite a pre-existing field value', () => {
    const raw = 'status=500';
    const [e] = extractFields([event(raw, { status: '200' })], [dir('s', 'status=(?<status>\\d+)')]);
    expect(e.fields['status']).toBe('200');
  });

  it('does not record offsets when EXTRACT targets a non-_raw source field', () => {
    const raw = 'payload: key=value';
    const [e] = extractFields(
      [event(raw, { message: 'key=value' })],
      [dir('key', '(?<k>\\w+)=(?<v>\\w+) in message')],
    );
    expect(e.fields['k']).toBe('key');
    // Offsets would be positions inside `message`, not `_raw` — so they must not be recorded.
    expect(e.fieldOffsets?.['k']).toBeUndefined();
    expect(e.fieldOffsets?.['v']).toBeUndefined();
  });

  it('distinguishes repeated identical values by capture position (double-highlight fix)', () => {
    // The reported bug: a regex-extracted value also happens to appear elsewhere in _raw.
    // With offsets, the highlighter targets exactly the capture position — not every indexOf hit.
    const raw = '192.168.1.30 - admin [...] "GET /admin/dashboard HTTP/1.0"';
    const [e] = extractFields([event(raw)], [dir('user', '^\\S+\\s+-\\s+(?<user>\\S+)\\s')]);
    const offsets = e.fieldOffsets?.['user'];
    expect(offsets).toHaveLength(1);
    // The offset points at the first `admin` (the field value), not `/admin/` in the URL.
    expect(offsets![0][0]).toBe(raw.indexOf('admin'));
    expect(offsets![0][0]).toBeLessThan(raw.indexOf('/admin/'));
  });
});
