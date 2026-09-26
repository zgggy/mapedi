import { describe, expect, it } from 'vitest';
import { createRng } from '../src/core/rng';
import { gcDistanceDeg, randomLonLat } from '../src/core/sphere';
import { createWorld, pickCell, serializeWorld, deserializeWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { generateRivers } from '../src/core/rivers';
import { generatePolitical, childrenOf } from '../src/core/political';

describe('rng', () => {
  it('is deterministic', () => {
    const a = createRng(42);
    const b = createRng(42);
    expect(a()).toBe(b());
    expect(a()).toBe(b());
  });
});

describe('sphere', () => {
  it('gc distance equator quarter ~ 25 degrees lon', () => {
    const d = gcDistanceDeg({ lon: 0, lat: 0 }, { lon: 25, lat: 0 });
    expect(d).toBeGreaterThan(24.5);
    expect(d).toBeLessThan(25.5);
  });

  it('random points in range', () => {
    const rng = createRng(1);
    for (let i = 0; i < 20; i++) {
      const p = randomLonLat(rng);
      expect(p.lon).toBeGreaterThanOrEqual(-180);
      expect(p.lon).toBeLessThanOrEqual(180);
      expect(p.lat).toBeGreaterThanOrEqual(-90);
      expect(p.lat).toBeLessThanOrEqual(90);
    }
  });
});

describe('world', () => {
  it('creates reproducible topology', () => {
    const a = createWorld({ seed: 7, count: 200 });
    const b = createWorld({ seed: 7, count: 200 });
    expect(a.cells.length).toBe(b.cells.length);
    expect(a.cells[0].center.lat).toBeCloseTo(b.cells[0].center.lat, 5);
    expect(a.cells[0].neighbors).toEqual(b.cells[0].neighbors);
  });

  it('serializes roundtrip', () => {
    const w = createWorld({ seed: 3, count: 120 });
    const w2 = deserializeWorld(serializeWorld(w));
    expect(w2.cells.length).toBe(w.cells.length);
    expect(w2.meta.seed).toBe(3);
  });

  it('pickCell returns something', () => {
    const w = createWorld({ seed: 9, count: 300 });
    const c = pickCell(w, 10, 20);
    expect(c).not.toBeNull();
  });
});

describe('height + rivers', () => {
  it('demo continents produce land and rivers', () => {
    const w = createWorld({ seed: 11, count: 800 });
    generateDemoContinents(w, 11);
    generateRivers(w, 6);
    const land = w.cells.filter((c) => c.height > 0);
    expect(land.length).toBeGreaterThan(20);
    expect(w.continents.length).toBeGreaterThan(0);
    expect(w.rivers.size).toBeGreaterThan(0);
  });
});

describe('political', () => {
  it('countries and nested provinces', () => {
    const w = createWorld({ seed: 21, count: 1200 });
    generateDemoContinents(w, 21);
    generatePolitical(w, 21, 6);
    const countries = w.regions.filter((r) => r.layerId === 'country');
    const provinces = w.regions.filter((r) => r.layerId === 'province');
    expect(countries.length).toBeGreaterThan(0);
    expect(provinces.length).toBeGreaterThan(0);
    const withChildren = countries.filter((c) => childrenOf(w, c.id).length > 0);
    expect(withChildren.length).toBeGreaterThan(0);
  });
});
