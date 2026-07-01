import { describe, it, expect } from 'vitest';
import { truncateEvents } from '../processors/truncator';
import type { SplunkEvent, ConfDirective, ValidationDiagnostic } from '../types';

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

function truncateDir(value: string): ConfDirective[] {
  return [{ key: 'TRUNCATE', value, line: 1, directiveType: 'TRUNCATE' }];
}

describe('truncateEvents', () => {
  it('truncates events longer than the byte limit', () => {
    const [e] = truncateEvents([event('abcdefghij')], truncateDir('5'));
    expect(e._raw).toBe('abcde');
  });

  it('leaves shorter events untouched', () => {
    const [e] = truncateEvents([event('abc')], truncateDir('100'));
    expect(e._raw).toBe('abc');
  });

  it('TRUNCATE = 0 disables truncation', () => {
    const long = 'x'.repeat(50);
    const [e] = truncateEvents([event(long)], truncateDir('0'));
    expect(e._raw).toBe(long);
  });

  // BUG-1: a non-numeric TRUNCATE used to slice every event to '' via NaN.
  it('ignores a non-numeric TRUNCATE instead of blanking every event', () => {
    const diags: ValidationDiagnostic[] = [];
    const [e] = truncateEvents([event('keep me intact')], truncateDir('abc'), diags);
    expect(e._raw).toBe('keep me intact');
    expect(diags.some((d) => d.message.includes('not a valid byte count'))).toBe(true);
  });

  // #30.2: parseInt is too lenient — these forms must be rejected, not silently
  // truncating with a wrong length (1e3→1) or disabling truncation (0x10→0).
  it.each(['0x10', '1e3', '100abc', '1.5', '-5'])(
    'ignores a malformed TRUNCATE value %s',
    (bad) => {
      const diags: ValidationDiagnostic[] = [];
      const long = 'x'.repeat(50);
      const [e] = truncateEvents([event(long)], truncateDir(bad), diags);
      expect(e._raw).toBe(long); // unchanged
      expect(diags.some((d) => d.message.includes('not a valid byte count'))).toBe(true);
    },
  );
});
