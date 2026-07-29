import { describe, it, expect } from 'vitest';
import { CIM_MODELS } from '../cim/cimModelsData';

const byName = (name: string) => CIM_MODELS.find((m) => m.name === name)!;

// #37: a model's events need ALL of its constraint tags to populate, so a
// missing tag doesn't weaken membership — it breaks it entirely.
describe('CIM constraint tags (#37)', () => {
  it('DLP is constrained by tag=dlp tag=incident', () => {
    expect(byName('DLP').tags).toEqual(expect.arrayContaining(['dlp', 'incident']));
  });

  it('Updates is constrained by tag=update tag=status', () => {
    expect(byName('Updates').tags).toEqual(expect.arrayContaining(['update', 'status']));
  });

  it('every model declares at least one constraint tag', () => {
    for (const model of CIM_MODELS) {
      expect(model.tags.length).toBeGreaterThan(0);
    }
  });
});
