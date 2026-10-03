import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { landContinentsCSR } from '../src/core/index/cellGraph';

describe('heightmap mapping', () => {
  it('landContinentsCSR empty after flood to ocean', () => {
    const w = createWorld({ seed: 1, count: 200 });
    generateDemoContinents(w, 1);
    for (const c of w.cells) {
      if (c.height > 0) {
        c.height = -0.2;
        c.isOcean = true;
      }
    }
    expect(landContinentsCSR(w).length).toBe(0);
  });
});
