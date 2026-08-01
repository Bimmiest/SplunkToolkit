import { describe, it, expect } from 'vitest';
import { runPipeline } from '../pipeline';
import { breakLines } from '../processors/lineBreaker';
import type { ConfDirective, EventMetadata } from '../types';

const META: EventMetadata = { index: 'main', host: '', source: '', sourcetype: 'st' };
const dir = (key: string, value: string): ConfDirective =>
  ({ key, value, line: 1, directiveType: key });

// #119: `getDirective` compared keys case-insensitively while confParser warned
// that a mis-cased attribute "is ignored". The simulator honoured the directive
// it had just declared dead, so the warning made a wrong result look checked.
describe('lineBreaker — directive keys are case-sensitive (#119)', () => {
  it('ignores a mis-cased line_breaker, matching the parser warning', () => {
    const { result, diagnostics } = runPipeline(
      'aXbXc',
      META,
      '[st]\nline_breaker = (X)\nSHOULD_LINEMERGE = false\n',
      '',
    );

    expect(diagnostics.some((d) => d.message.includes('"line_breaker" is ignored'))).toBe(true);
    // Splunk ignores the attribute entirely, so the default breaker applies and
    // the whole input stays one event.
    expect(result.events.map((e) => e._raw)).toEqual(['aXbXc']);
  });

  it('honours the correctly-cased LINE_BREAKER', () => {
    const { result } = runPipeline(
      'aXbXc',
      META,
      '[st]\nLINE_BREAKER = (X)\nSHOULD_LINEMERGE = false\n',
      '',
    );
    expect(result.events.map((e) => e._raw)).toEqual(['a', 'b', 'c']);
  });

  it.each(['should_linemerge', 'break_only_before', 'must_break_after', 'max_events'])(
    'ignores mis-cased %s',
    (key) => {
      const events = breakLines('a\nb\nc', [dir(key, 'false')], META);
      // With every merge directive mis-cased, defaults apply: SHOULD_LINEMERGE
      // is on and no date-like line breaks, so all three lines merge.
      expect(events).toHaveLength(1);
    },
  );
});
