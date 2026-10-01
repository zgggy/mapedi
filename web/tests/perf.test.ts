import { describe, expect, it } from 'vitest';
import { createWorld, serializeWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { generateRivers } from '../src/core/rivers';
import { computeClimate } from '../src/core/climate';
import { computeBiomes } from '../src/core/biomes';
import { unifiedGenerate } from '../src/core/generate/unified';
import { defaultGenConfig } from '../src/core/layer';
import { generateRoads } from '../src/core/generate/networks';
import { getProjCache } from '../src/render/projCache';
import { defaultProjParams } from '../src/core/project/projections';

function pipeline(seed: number, count: number) {
  const t0 = performance.now();
  const w = createWorld({ seed, count });
  generateDemoContinents(w, seed);
  generateRivers(w, Math.max(4, Math.floor(count / 400)));
  computeClimate(w);
  computeBiomes(w);
  // 生产路径统一生成器；province 先于 country
  unifiedGenerate(w, 'province', defaultGenConfig('province', seed));
  unifiedGenerate(w, 'country', defaultGenConfig('country', seed));
  unifiedGenerate(w, 'culture', defaultGenConfig('culture', seed));
  generateRoads(w, seed, 3, 2, 1.2);
  const ms = Math.round(performance.now() - t0);
  const jsonLen = serializeWorld(w).length;
  return { ms, cells: w.cells.length, land: w.cells.filter((c) => c.height > 0).length, jsonLen };
}

describe('perf bench', () => {
  it('6k pipeline under 30s', () => {
    const r = pipeline(99, 6000);
    console.log('6k', r);
    expect(r.cells).toBe(6000);
    expect(r.ms).toBeLessThan(30000);
  });

  it('12k pipeline under 90s', () => {
    const r = pipeline(98, 12000);
    console.log('12k', r);
    expect(r.ms).toBeLessThan(90000);
  });

  it('25k pipeline under 180s', () => {
    const r = pipeline(97, 25000);
    console.log('25k', r);
    expect(r.ms).toBeLessThan(180000);
  });

  it('proj cache builds once', () => {
    const w = createWorld({ seed: 5, count: 800 });
    generateDemoContinents(w, 5);
    const pp = defaultProjParams();
    const a = getProjCache(w, 'mercator', pp);
    const b = getProjCache(w, 'mercator', pp);
    expect(a).toBe(b);
    expect(a.polys[0].length).toBeGreaterThanOrEqual(6);
  });
});
