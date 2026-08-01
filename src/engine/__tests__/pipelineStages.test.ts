import { describe, it, expect } from 'vitest';
import { PIPELINE_STAGES, getStagesForDirective } from '../pipelineStages';
import { getAllDirectives } from '../directiveRegistry';

describe('PIPELINE_STAGES', () => {
  it('numbers its steps consecutively from 1', () => {
    expect(PIPELINE_STAGES.map((s) => s.step)).toEqual(
      PIPELINE_STAGES.map((_, i) => i + 1),
    );
  });

  it('runs every index-time stage before every search-time stage', () => {
    const lastIndex = Math.max(
      ...PIPELINE_STAGES.filter((s) => s.phase === 'index-time').map((s) => s.step),
    );
    const firstSearch = Math.min(
      ...PIPELINE_STAGES.filter((s) => s.phase === 'search-time').map((s) => s.step),
    );
    expect(lastIndex).toBeLessThan(firstSearch);
  });

  it('names only directives the registry knows about', () => {
    const known = new Set(getAllDirectives().map((d) => d.key));
    for (const stage of PIPELINE_STAGES) {
      for (const key of stage.directives) {
        expect(known.has(key), `${key} (stage ${stage.step}) is not in the registry`).toBe(true);
      }
    }
  });

  it('agrees with the registry about which phase each directive belongs to', () => {
    const byKey = new Map(getAllDirectives().map((d) => [d.key, d]));
    for (const stage of PIPELINE_STAGES) {
      for (const key of stage.directives) {
        const info = byKey.get(key);
        if (!info || info.phase === 'both') continue;
        expect(info.phase, `${key} phase`).toBe(stage.phase);
      }
    }
  });
});

describe('getStagesForDirective', () => {
  it('finds the stage a directive configures', () => {
    expect(getStagesForDirective('TIME_FORMAT').map((s) => s.name)).toEqual([
      'Timestamp Extraction',
    ]);
  });

  it('resolves class-based keys through their base prefix', () => {
    expect(getStagesForDirective('EXTRACT-client_ip')).toEqual(getStagesForDirective('EXTRACT'));
  });

  it('returns nothing for a directive no stage claims', () => {
    expect(getStagesForDirective('NOT_A_DIRECTIVE')).toEqual([]);
  });

  it('does not mistake a hyphen inside an unknown key for a class suffix', () => {
    expect(getStagesForDirective('-LEADING')).toEqual([]);
  });
});
