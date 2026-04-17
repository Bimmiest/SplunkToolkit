import { describe, it, expect } from 'vitest';
import { applyDestKey } from '../transforms/destKeyRouter';
import type { SplunkEvent } from '../types';
import type { TransformResult } from '../transforms/regexTransform';

function baseEvent(): SplunkEvent {
  return {
    _raw: 'raw log line',
    _time: null,
    _meta: {},
    fields: {},
    metadata: { index: 'main', host: 'original-host', source: '/log', sourcetype: 'syslog' },
    lineNumbers: { start: 1, end: 1 },
    processingTrace: [],
  };
}

function result(destKey: string, destValue: string): TransformResult {
  return { fields: {}, destKey, destValue, matched: true };
}

describe('applyDestKey — MetaData:Host prefix enforcement', () => {
  it('updates host when FORMAT value has host:: prefix', () => {
    const event = applyDestKey(baseEvent(), result('MetaData:Host', 'host::new-host'));
    expect(event?.metadata.host).toBe('new-host');
  });

  it('does NOT update host when FORMAT value lacks host:: prefix', () => {
    const event = applyDestKey(baseEvent(), result('MetaData:Host', 'new-host'));
    expect(event?.metadata.host).toBe('original-host');
  });

  it('handles _MetaData:Host alias the same way (leading _ stripped)', () => {
    const event = applyDestKey(baseEvent(), result('_MetaData:Host', 'host::aliased-host'));
    expect(event?.metadata.host).toBe('aliased-host');
  });
});

describe('applyDestKey — MetaData:Sourcetype prefix enforcement', () => {
  it('updates sourcetype when FORMAT has sourcetype:: prefix', () => {
    const event = applyDestKey(baseEvent(), result('MetaData:Sourcetype', 'sourcetype::new_sourcetype'));
    expect(event?.metadata.sourcetype).toBe('new_sourcetype');
  });

  it('does NOT update sourcetype when prefix is absent', () => {
    const event = applyDestKey(baseEvent(), result('MetaData:Sourcetype', 'new_sourcetype'));
    expect(event?.metadata.sourcetype).toBe('syslog');
  });
});

describe('applyDestKey — MetaData:Source prefix enforcement', () => {
  it('updates source when FORMAT has source:: prefix', () => {
    const event = applyDestKey(baseEvent(), result('MetaData:Source', 'source::/new/path'));
    expect(event?.metadata.source).toBe('/new/path');
  });

  it('does NOT update source when prefix is absent', () => {
    const event = applyDestKey(baseEvent(), result('MetaData:Source', '/new/path'));
    expect(event?.metadata.source).toBe('/log');
  });
});

describe('applyDestKey — nullQueue', () => {
  it('returns null for nullQueue', () => {
    const event = applyDestKey(baseEvent(), result('queue', 'nullQueue'));
    expect(event).toBeNull();
  });

  it('keeps event for indexQueue', () => {
    const event = applyDestKey(baseEvent(), result('queue', 'indexQueue'));
    expect(event).not.toBeNull();
  });
});

describe('applyDestKey — _raw replacement', () => {
  it('replaces _raw when destKey is _raw', () => {
    const event = applyDestKey(baseEvent(), result('_raw', 'replaced content'));
    expect(event?._raw).toBe('replaced content');
  });
});
