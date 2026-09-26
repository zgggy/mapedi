import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { assignContinents, generateDemoContinents } from '../src/core/height';

describe('heightmap mapping', () => {
  it('assignContinents after flood to ocean', () => {
    const w = createWorld({ seed: 1, count: 200 });
    generateDemoContinents(w, 1);
    for (const c of w.cells) {
      if (c.height > 0) {
        c.height = -0.2;
        c.isOcean = true;
      }
    }
    assignContinents(w);
    expect(w.continents.length).toBe(0);
  });
});
