// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// kvModeXml.test.ts
// `KV_MODE = xml` in its own file because it needs `DOMParser`, which Node does
// not provide -- kvMode.test.ts runs under the engine default of `node` and so
// cannot reach this path at all. Until this file existed, XML extraction had no
// automated coverage in any environment.
// ---------------------------------------------------------------------------

import { describe, it, expect } from 'vitest';
import { runPipeline } from '../pipeline';
import type { EventMetadata } from '../types';

const metadata: EventMetadata = {
  index: 'main',
  host: 'test-host',
  source: 'test-source',
  sourcetype: 'xmltest',
};

function fieldsOf(raw: string, props = 'SHOULD_LINEMERGE = false\nKV_MODE = xml\n') {
  const { result } = runPipeline(raw, metadata, `[xmltest]\n${props}`, '', {
    perEventPipeline: false,
    captureOffsets: false,
  });
  return result.events[0]?.fields ?? {};
}

describe('KV_MODE = xml', () => {
  it('names a field by its dotted path from the document root (#171)', () => {
    const fields = fieldsOf(
      '<event><ts>2026-01-15T10:00:00Z</ts><user>alice</user><status>200</status></event>',
    );
    // The wrapper element is part of the name -- `event.user`, not `user`. This
    // is what the Splunk 10.4.0 capture records.
    expect(fields).toMatchObject({
      'event.ts': '2026-01-15T10:00:00Z',
      'event.user': 'alice',
      'event.status': '200',
    });
  });

  it('carries the whole ancestor chain, not just the parent', () => {
    const fields = fieldsOf('<a><b><c>deep</c></b></a>');
    expect(fields['a.b.c']).toBe('deep');
  });

  it('extracts nothing from text that is not XML', () => {
    // `punct` is generated for every event by the annotation processor (#185),
    // so "nothing" means "nothing beyond it".
    const { punct: _punct, ...rest } = fieldsOf('plain text, no markup here');
    expect(rest).toEqual({});
  });

  it('keeps the WinEventLog Name-attribute convention unprefixed', () => {
    // <Data Name="x">v</Data> is named by its Name attribute rather than by its
    // path, which is how Windows event XML is read.
    const fields = fieldsOf('<Event><EventData><Data Name="TargetUser">bob</Data></EventData></Event>');
    expect(fields['TargetUser']).toBe('bob');
  });

  it('accumulates a repeated element into a multivalue field', () => {
    const fields = fieldsOf('<r><item>one</item><item>two</item></r>');
    expect(fields['r.item']).toEqual(['one', 'two']);
  });

  it('does not leak the synthetic wrapper into a fragment field name', () => {
    // Two sibling roots make the input a fragment rather than a document, which
    // is the case the internal `<_root_>` wrapper exists for.
    const fields = fieldsOf('<one>1</one><two>2</two>');
    expect(fields).toMatchObject({ one: '1', two: '2' });
    expect(Object.keys(fields).some((k) => k.includes('_root_'))).toBe(false);
  });
});
