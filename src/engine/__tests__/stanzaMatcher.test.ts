import { describe, it, expect } from 'vitest';
import { matchStanzas } from '../parser/stanzaMatcher';
import type { ConfStanza, EventMetadata } from '../types';

function stanza(type: ConfStanza['type'], name: string): ConfStanza {
  return { name, type, directives: [], lineRange: { start: 1, end: 2 } };
}

const META: EventMetadata = {
  index: 'main',
  host: 'webserver01',
  source: '/var/log/apache/access.log',
  sourcetype: 'access_combined',
};

describe('matchStanzas — precedence ordering', () => {
  it('source wins over host, sourcetype, and default', () => {
    const stanzas = [
      stanza('default', 'default'),
      stanza('sourcetype', 'access_combined'),
      stanza('host', 'webserver01'),
      stanza('source', '/var/log/apache/access.log'),
    ];
    const result = matchStanzas(stanzas, META);
    expect(result[0].type).toBe('source');
  });

  it('host wins over sourcetype and default', () => {
    const stanzas = [
      stanza('default', 'default'),
      stanza('sourcetype', 'access_combined'),
      stanza('host', 'webserver01'),
    ];
    const result = matchStanzas(stanzas, META);
    expect(result[0].type).toBe('host');
  });

  it('sourcetype wins over default', () => {
    const stanzas = [
      stanza('default', 'default'),
      stanza('sourcetype', 'access_combined'),
    ];
    const result = matchStanzas(stanzas, META);
    expect(result[0].type).toBe('sourcetype');
  });

  it('returns all four types in order: source, host, sourcetype, default', () => {
    const stanzas = [
      stanza('default', 'default'),
      stanza('sourcetype', 'access_combined'),
      stanza('host', 'webserver01'),
      stanza('source', '/var/log/apache/access.log'),
    ];
    const result = matchStanzas(stanzas, META);
    expect(result.map((s) => s.type)).toEqual(['source', 'host', 'sourcetype', 'default']);
  });

  it('unmatched stanza types are excluded', () => {
    const stanzas = [
      stanza('sourcetype', 'wrong_sourcetype'),
      stanza('default', 'default'),
    ];
    const result = matchStanzas(stanzas, META);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('default');
  });
});

describe('matchStanzas — wildcard patterns', () => {
  it('source wildcard * matches single path segment', () => {
    const s: ConfStanza = {
      name: 'source::/var/log/apache/*',
      type: 'source',
      sourcePattern: '/var/log/apache/*',
      directives: [],
      lineRange: { start: 1, end: 2 },
    };
    const result = matchStanzas([s], META);
    expect(result).toHaveLength(1);
  });

  it('source wildcard does not match across path separators', () => {
    const s: ConfStanza = {
      name: 'source::/var/log/*',
      type: 'source',
      sourcePattern: '/var/log/*',
      directives: [],
      lineRange: { start: 1, end: 2 },
    };
    // /var/log/apache/access.log has more segments than * allows
    const result = matchStanzas([s], META);
    expect(result).toHaveLength(0);
  });

  it('... matches recursively across path separators', () => {
    const s: ConfStanza = {
      name: 'source::/var/log/...',
      type: 'source',
      sourcePattern: '/var/log/...',
      directives: [],
      lineRange: { start: 1, end: 2 },
    };
    const result = matchStanzas([s], META);
    expect(result).toHaveLength(1);
  });
});
