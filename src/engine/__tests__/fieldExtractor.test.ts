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

  it('resolves a single-quoted "in" source field (nested JSON name with a period)', () => {
    const [e] = extractFields(
      [event('raw', { 'event.message': 'key=value' })],
      [dir('key', "(?<k>\\w+)=(?<v>\\w+) in 'event.message'")],
    );
    expect(e.fields['k']).toBe('key');
    expect(e.fields['v']).toBe('value');
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

describe('extractFields — captureOffsets (#118)', () => {
  const raw = 'user=admin id=7';
  const dirs = [dir('user', 'user=(?<user>\\w+)')];

  it('captures offsets by default, so the browser keeps its highlighting', () => {
    const [e] = extractFields([event(raw)], dirs);
    expect(e.fields['user']).toBe('admin');
    expect(e.fieldOffsets?.['user']).toHaveLength(1);
  });

  it('extracts the same fields with captureOffsets: false, but records no offsets', () => {
    const [e] = extractFields([event(raw)], dirs, undefined, false);
    // The point of the option is that ONLY the offsets go away. A caller that
    // renders no highlights must not lose extraction itself.
    expect(e.fields['user']).toBe('admin');
    expect(e.fieldOffsets?.['user']).toBeUndefined();
  });

  it('declining offsets drops the `d` flag — the whole reason the option exists', () => {
    // V8's linear-time fallback cannot compile a regex carrying `d`, `i` or `u`,
    // so a Node consumer that keeps `d` keeps the largest user-controlled regex
    // surface outside what the fallback can bound. Measured on this pattern:
    // 8 ms compiled bare against 91,696 ms compiled with `d`.
    //
    // Asserting on the compiled flags rather than on elapsed time keeps this a
    // unit test — a timing assertion here would take a minute and a half to fail.
    // Filtered by pattern source: extractFields is not the only thing running a
    // regex here, so position in the call log is not a reliable handle.
    const flagsFor = (captureOffsets: boolean): string => {
      const seen: string[] = [];
      const spy = RegExp.prototype.exec;
      RegExp.prototype.exec = function (this: RegExp, s: string) {
        if (this.source.includes('user=')) seen.push(this.flags);
        return spy.call(this, s);
      };
      try {
        extractFields([event(raw)], dirs, undefined, captureOffsets);
      } finally {
        RegExp.prototype.exec = spy;
      }
      expect(seen).toHaveLength(1);
      return seen[0];
    };

    expect(flagsFor(false)).not.toContain('d');
    expect(flagsFor(true)).toContain('d');
  });
});
