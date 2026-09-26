import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { generateRivers } from '../src/core/rivers';
import { computeClimate } from '../src/core/climate';
import { generateBiomes } from '../src/core/biomes';
import {
  generateCountriesCost,
  generateCultures,
  generateReligions,
} from '../src/core/generate/culture';
import { generateRoads, generateRoutes } from '../src/core/generate/networks';
import { cascadeEnabled, defaultProfiles } from '../src/core/generate/profile';

function worldWithLands(seed = 31) {
  const w = createWorld({ seed, count: 1200 });
  generateDemoContinents(w, seed);
  generateRivers(w, 6);
  computeClimate(w);
  generateBiomes(w);
  generateCountriesCost(w, seed, 6);
  generateCultures(w, seed, 7, 2.5, 1.8);
  generateReligions(w, seed, 4);
  generateRoads(w, seed, 2, 2, 1.2);
  generateRoutes(w, seed, 4);
  return w;
}

describe('P6 generation', () => {
  it('cultures religions countries roads exist', () => {
    const w = worldWithLands();
    expect(w.regions.filter((r) => r.layerId === 'country').length).toBeGreaterThanOrEqual(2);
    expect(w.regions.filter((r) => r.layerId === 'culture').length).toBeGreaterThanOrEqual(2);
    expect(w.regions.filter((r) => r.layerId === 'religion').length).toBeGreaterThanOrEqual(1);
    expect(w.regions.filter((r) => r.layerId === 'road').length).toBeGreaterThanOrEqual(1);
    const road = w.regions.find((r) => r.layerId === 'road')!;
    expect(road.cells.length).toBeGreaterThanOrEqual(2);
    // 路径连续
    for (let i = 1; i < road.cells.length; i++) {
      const prev = w.cells[road.cells[i - 1]];
      expect(prev.neighbors).toContain(road.cells[i]);
    }
  });

  it('provinces nested under countries', () => {
    const w = worldWithLands();
    const countries = w.regions.filter((r) => r.layerId === 'country');
    const provinces = w.regions.filter((r) => r.layerId === 'province');
    expect(provinces.length).toBeGreaterThan(0);
    const parentIds = new Set(countries.map((c) => c.id));
    for (const p of provinces) expect(parentIds.has(p.parentId!)).toBe(true);
  });

  it('profile cascade lists natural then political', () => {
    const order = cascadeEnabled(defaultProfiles());
    expect(order.indexOf('height')).toBeLessThan(order.indexOf('country'));
    expect(order.indexOf('environment')).toBeLessThan(order.indexOf('culture'));
  });
});
