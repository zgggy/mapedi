import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { generateRivers } from '../src/core/rivers';
import { computeClimate, heightToMeters } from '../src/core/climate';
import { classifyBiome, generateBiomes } from '../src/core/biomes';
import { generateFauna, generateRaces, generateVegetation } from '../src/core/nature';

function fullWorld(seed = 12) {
  const w = createWorld({ seed, count: 900 });
  generateDemoContinents(w, seed);
  generateRivers(w, 5);
  computeClimate(w);
  generateBiomes(w);
  generateVegetation(w, seed);
  generateFauna(w, seed);
  generateRaces(w, seed, 4);
  return w;
}

describe('climate + biomes', () => {
  it('classifies extremes', () => {
    expect(classifyBiome(-15, 0.2, 0.1, 5)).toBe('ice');
    expect(classifyBiome(-5, 0.2, 0.1, 5)).toBe('tundra');
    expect(classifyBiome(12, 0.7, 0.2, 8)).toBe('temperate_forest');
    expect(classifyBiome(12, 0.35, 0.2, 8)).toBe('grassland');
    expect(classifyBiome(28, 0.15, 0.1, 20)).toBe('desert');
    expect(classifyBiome(28, 0.8, 0.2, 10)).toBe('rainforest');
    expect(classifyBiome(5, 0.4, 0.9, 3)).toBe('mountain');
  });

  it('cold pole is colder than equator', () => {
    const w = fullWorld();
    computeClimate(w);
    const nearEq = w.cells
      .filter((c) => Math.abs(c.center.lat) < 15 && c.height > 0)
      .slice(0, 20);
    const nearPole = w.cells
      .filter((c) => Math.abs(c.center.lat) > 70)
      .slice(0, 20);
    const avg = (arr: typeof nearEq) =>
      arr.reduce((s, c) => s + w.cellClimate!.get(c.id)!.temperatureC, 0) / (arr.length || 1);
    expect(avg(nearPole)).toBeLessThan(avg(nearEq));
  });

  it('tilt / oxygen affect generation outputs', () => {
    const a = fullWorld(20);
    a.climate.oxygenLevel = 0.55;
    computeClimate(a);
    generateBiomes(a);
    generateFauna(a, 20);
    const faunaLow = a.regions.filter((r) => r.layerId === 'fauna').length;

    const b = fullWorld(20);
    b.climate.oxygenLevel = 1.4;
    computeClimate(b);
    generateBiomes(b);
    generateFauna(b, 20);
    const faunaHigh = b.regions.filter((r) => r.layerId === 'fauna').length;
    expect(faunaHigh).toBeGreaterThanOrEqual(faunaLow);
  });

  it('produces environment vegetation race regions', () => {
    const w = fullWorld();
    expect(w.regions.filter((r) => r.layerId === 'environment').length).toBeGreaterThan(1);
    expect(w.regions.filter((r) => r.layerId === 'vegetation').length).toBeGreaterThan(0);
    expect(w.regions.filter((r) => r.layerId === 'race').length).toBeGreaterThan(0);
    expect(w.biome!.size).toBe(w.cells.length);
  });

  it('height meters mapping', () => {
    expect(heightToMeters(0)).toBe(0);
    expect(heightToMeters(64)).toBe(8848);
    expect(heightToMeters(-63)).toBe(-11000);
  });
});
