import { describe, it, expect } from 'vitest';
import { detectLineFormat } from '../analyzers/lineFormat';
import { detectTimestamp } from '../analyzers/timestamp';
import { detectTruncate } from '../analyzers/truncate';
import { normalizeSourcetype, detectSourcetypeHygiene } from '../analyzers/sourcetype';
import { renderStanza, appendStanza } from '../serialize';
import { scaffoldConfig } from '../scaffoldConfig';
import type { ScaffoldSuggestion } from '../types';

const splitLines = (s: string) => s.split(/\r?\n/);
const byKey = (sugs: ScaffoldSuggestion[], key: string) => sugs.find((s) => s.key === key);

describe('detectLineFormat', () => {
  it('detects JSON-per-line (incl. explicit LINE_BREAKER)', () => {
    const raw = '{"a":1}\n{"a":2}\n{"a":3}';
    const out = detectLineFormat(raw, splitLines(raw));
    expect(byKey(out, 'KV_MODE')?.value).toBe('json');
    expect(byKey(out, 'SHOULD_LINEMERGE')?.value).toBe('false');
    expect(byKey(out, 'LINE_BREAKER')?.value).toBe('([\\r\\n]+)');
  });

  it('detects XML', () => {
    const raw = '<?xml version="1.0"?><Event><Data>x</Data></Event>';
    const out = detectLineFormat(raw, splitLines(raw));
    expect(byKey(out, 'KV_MODE')?.value).toBe('xml');
  });

  it('detects CSV via consistent delimiters', () => {
    const raw = 'ts,user,action\n2024,alice,login\n2025,bob,logout';
    const out = detectLineFormat(raw, splitLines(raw));
    expect(byKey(out, 'INDEXED_EXTRACTIONS')?.value).toBe('csv');
  });

  it('detects multiple newline-separated multi-line JSON objects', () => {
    const raw = '{\n  "a": 1\n}\n{\n  "a": 2\n}';
    const out = detectLineFormat(raw, splitLines(raw));
    expect(byKey(out, 'LINE_BREAKER')?.value).toBe('([\\r\\n]+)(?=\\{)');
    expect(byKey(out, 'SHOULD_LINEMERGE')?.value).toBe('false');
    expect(byKey(out, 'KV_MODE')?.value).toBe('json');
  });

  it('a single multi-line JSON object gets KV_MODE=json but no LINE_BREAKER', () => {
    const raw = '{\n  "a": 1,\n  "b": 2\n}';
    const out = detectLineFormat(raw, splitLines(raw));
    expect(byKey(out, 'KV_MODE')?.value).toBe('json');
    expect(byKey(out, 'LINE_BREAKER')).toBeUndefined();
  });

  it('does not mistake a single comma-containing line for CSV', () => {
    const raw = 'this is a sentence, with commas, but not csv';
    expect(byKey(detectLineFormat(raw, splitLines(raw)), 'INDEXED_EXTRACTIONS')).toBeUndefined();
  });

  it('detects whitespace continuation lines → line merge', () => {
    const raw = 'ERROR something failed\n    at foo()\n    at bar()\nERROR next';
    const out = detectLineFormat(raw, splitLines(raw));
    expect(byKey(out, 'SHOULD_LINEMERGE')?.value).toBe('true');
    expect(byKey(out, 'BREAK_ONLY_BEFORE')?.value).toBe('^\\S');
  });

  it('returns nothing for unstructured single-line text', () => {
    const raw = 'just some plain log message here\nanother plain message';
    expect(detectLineFormat(raw, splitLines(raw))).toEqual([]);
  });
});

describe('detectTimestamp', () => {
  it('recognises ISO 8601 with high confidence', () => {
    const raw = '2024-01-15T10:00:00 a\n2024-01-15T10:00:01 b\n2024-01-15T10:00:02 c';
    const out = detectTimestamp(splitLines(raw));
    const tf = byKey(out, 'TIME_FORMAT');
    expect(tf?.value).toBe('%Y-%m-%dT%H:%M:%S');
    expect(tf?.confidence).toBe('high');
  });

  it('derives TIME_PREFIX from the preceding token', () => {
    const raw = 'id=1 ts=2024-01-15T10:00:00 x\nid=2 ts=2024-01-15T10:00:01 y';
    const out = detectTimestamp(splitLines(raw));
    expect(byKey(out, 'TIME_PREFIX')?.value).toBe('ts=');
  });

  it('recognises Apache-style timestamps with a bracket prefix', () => {
    const raw = '10.0.0.1 - - [15/Jan/2024:10:00:00 +0000] "GET /"';
    const out = detectTimestamp(splitLines(raw));
    expect(byKey(out, 'TIME_FORMAT')?.value).toBe('%d/%b/%Y:%H:%M:%S %z');
    expect(byKey(out, 'TIME_PREFIX')?.value).toBe('\\[');
  });

  it('derives a STABLE key-boundary prefix for JSON (not per-event values)', () => {
    const raw =
      '{"eventVersion":"1.08","userIdentity":{"userName":"Alice"},"eventTime":"2024-01-15T10:00:00Z"}\n' +
      '{"eventVersion":"1.08","userIdentity":{"userName":"Bob"},"eventTime":"2024-01-15T10:00:01Z"}';
    const out = detectTimestamp(splitLines(raw));
    expect(byKey(out, 'TIME_FORMAT')?.value).toBe('%Y-%m-%dT%H:%M:%S');
    // The prefix is the eventTime key boundary — not the (per-event) Alice/Bob values.
    expect(byKey(out, 'TIME_PREFIX')?.value).toBe('"eventTime":"');
    expect(byKey(out, 'TIME_PREFIX')?.value).not.toContain('Alice');
    // Lookahead is capped to the timestamp length (19) + 1, measured after the prefix.
    expect(byKey(out, 'MAX_TIMESTAMP_LOOKAHEAD')?.value).toBe('20');
  });

  it('recognises leading epoch as %s', () => {
    const raw = '1705312800 event one\n1705312801 event two';
    const out = detectTimestamp(splitLines(raw));
    expect(byKey(out, 'TIME_FORMAT')?.value).toBe('%s');
  });

  it('returns nothing when no timestamp is present', () => {
    expect(detectTimestamp(splitLines('no time here\nstill none'))).toEqual([]);
  });
});

describe('detectTruncate', () => {
  it('suggests raising TRUNCATE only for long events', () => {
    const longLine = 'x'.repeat(12000);
    const out = detectTruncate([longLine, longLine]);
    const t = byKey(out, 'TRUNCATE');
    expect(t).toBeDefined();
    expect(Number(t!.value)).toBeGreaterThan(10000);
  });

  it('stays silent for short events (default is fine)', () => {
    expect(detectTruncate(['short line', 'another short one'])).toEqual([]);
  });
});

describe('normalizeSourcetype', () => {
  it('normalises a messy sourcetype', () => {
    expect(normalizeSourcetype('MyApp Logs')).toBe('myapp:logs');
  });

  it('leaves an already-hygienic sourcetype alone', () => {
    expect(normalizeSourcetype('cisco:asa')).toBeNull();
    expect(normalizeSourcetype('access_combined')).toBeNull();
  });

  it('detectSourcetypeHygiene emits an opt-in suggestion', () => {
    const s = detectSourcetypeHygiene('MyApp Logs');
    expect(s?.value).toBe('myapp:logs');
    expect(s?.enabledByDefault).toBe(false);
  });
});

describe('serialize', () => {
  it('renders a stanza', () => {
    const stanza = renderStanza('my:st', [
      { key: 'TIME_FORMAT', value: '%Y-%m-%d', confidence: 'high', evidence: '', enabledByDefault: true },
      { key: 'KV_MODE', value: 'json', confidence: 'high', evidence: '', enabledByDefault: true },
    ]);
    expect(stanza).toBe('[my:st]\nTIME_FORMAT = %Y-%m-%d\nKV_MODE = json');
  });

  it('appends to existing config with a blank-line separator', () => {
    expect(appendStanza('[old]\nKV_MODE = none', '[new]\nKV_MODE = json')).toBe('[old]\nKV_MODE = none\n\n[new]\nKV_MODE = json\n');
  });

  it('sets directly when config is empty', () => {
    expect(appendStanza('   ', '[new]\nX = 1')).toBe('[new]\nX = 1\n');
  });
});

describe('scaffoldConfig (integration)', () => {
  it('proposes JSON + timestamp directives and drops KV_MODE when indexed extraction wins', () => {
    const raw = 'ts,msg\n2024-01-15T10:00:00,hello\n2024-01-15T10:00:01,world';
    const result = scaffoldConfig(raw, { index: 'main', host: '', source: '', sourcetype: 'My CSV' });
    // CSV → INDEXED_EXTRACTIONS, and KV_MODE must not coexist with it.
    expect(byKey(result.suggestions, 'INDEXED_EXTRACTIONS')?.value).toBe('csv');
    expect(byKey(result.suggestions, 'KV_MODE')).toBeUndefined();
    // sourcetype hygiene suggestion drives the stanza name.
    expect(result.sourcetype).toBe('my:csv');
    expect(result.sourcetypeSuggestion?.value).toBe('my:csv');
  });

  it('falls back to a placeholder sourcetype when none is set', () => {
    const result = scaffoldConfig('{"a":1}', { index: 'main', host: '', source: '', sourcetype: '' });
    expect(result.sourcetype).toBe('my:sourcetype');
    expect(byKey(result.suggestions, 'KV_MODE')?.value).toBe('json');
  });
});
