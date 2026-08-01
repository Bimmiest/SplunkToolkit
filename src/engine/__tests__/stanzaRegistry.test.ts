import { describe, it, expect } from 'vitest';
import { STANZA_KINDS, classifyStanza, getStanzaKind } from '../stanzaRegistry';

describe('classifyStanza', () => {
  it('recognises the default stanza', () => {
    expect(classifyStanza('default').kind.id).toBe('default');
    expect(classifyStanza('default').pattern).toBeNull();
  });

  it('splits the pattern off a source stanza', () => {
    const { kind, pattern } = classifyStanza('source::/var/log/app.log');
    expect(kind.id).toBe('source');
    expect(pattern).toBe('/var/log/app.log');
  });

  it('splits the pattern off a host stanza', () => {
    const { kind, pattern } = classifyStanza('host::web-01');
    expect(kind.id).toBe('host');
    expect(pattern).toBe('web-01');
  });

  it('treats anything else as a sourcetype', () => {
    const { kind, pattern } = classifyStanza('apache:access');
    expect(kind.id).toBe('sourcetype');
    expect(pattern).toBe('apache:access');
  });

  it('matches the prefixes case-sensitively, as Splunk does', () => {
    // `[HOST::web-1]` is a sourcetype literally named "HOST::web-1", not a
    // host stanza — treating it as one would silently change which events the
    // settings applied to.
    expect(classifyStanza('HOST::web-1').kind.id).toBe('sourcetype');
    expect(classifyStanza('SOURCE::/var/log').kind.id).toBe('sourcetype');
  });

  it('handles an empty pattern after the prefix', () => {
    const { kind, pattern } = classifyStanza('host::');
    expect(kind.id).toBe('host');
    expect(pattern).toBe('');
  });
});

describe('STANZA_KINDS', () => {
  it('ranks precedence source > host > sourcetype > default', () => {
    const rank = (id: string) => STANZA_KINDS.find((s) => s.id === id)?.rank ?? -1;
    expect(rank('source')).toBeGreaterThan(rank('host'));
    expect(rank('host')).toBeGreaterThan(rank('sourcetype'));
    expect(rank('sourcetype')).toBeGreaterThan(rank('default'));
  });

  it('gives every kind a description, precedence note and example', () => {
    for (const kind of STANZA_KINDS) {
      expect(kind.description.length).toBeGreaterThan(0);
      expect(kind.precedence.length).toBeGreaterThan(0);
      expect(kind.example.length).toBeGreaterThan(0);
    }
  });

  it('looks kinds up by id', () => {
    expect(getStanzaKind('source')?.label).toBe('[source::<pattern>]');
    expect(getStanzaKind('nope' as never)).toBeUndefined();
  });
});
