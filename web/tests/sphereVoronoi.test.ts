import { describe, expect, it } from 'vitest';
import {
  blueNoiseSphere,
  fibonacciSphere,
  sphericalVoronoi,
  vec3ToLonLat,
} from '../src/core/voronoiSphere';
import { generateVoronoiCells } from '../src/core/voronoi';
import { createWorld } from '../src/core/world';
import { createRng } from '../src/core/rng';

describe('spherical voronoi', () => {
  it('blue noise covers sphere and differs from fibonacci lattice', () => {
    const pts = blueNoiseSphere(400, createRng(1));
    const lats = pts.map((p) => vec3ToLonLat(p).lat);
    expect(Math.min(...lats)).toBeLessThan(-60);
    expect(Math.max(...lats)).toBeGreaterThan(60);
    const fib = fibonacciSphere(400);
    const d0 = Math.hypot(
      pts[0][0] - fib[0][0],
      pts[0][1] - fib[0][1],
      pts[0][2] - fib[0][2],
    );
    expect(d0).toBeGreaterThan(0.01);
  });

  it('cells near pole have polygon vertices (not a single point)', () => {
    const { cells } = generateVoronoiCells({ seed: 5, count: 400, lloydIterations: 0 });
    const polar = cells.filter((c) => Math.abs(c.center.lat) > 80);
    expect(polar.length).toBeGreaterThan(0);
    for (const c of polar.slice(0, 5)) {
      expect(c.polygon.length).toBeGreaterThanOrEqual(3);
    }
  });

  it('neighbor graph non-empty', () => {
    const { cells } = generateVoronoiCells({ seed: 6, count: 300, lloydIterations: 0 });
    let edges = 0;
    for (const c of cells) {
      expect(c.neighbors.length).toBeGreaterThan(0);
      edges += c.neighbors.length;
    }
    expect(edges).toBeGreaterThan(cells.length);
  });

  it('north and south poles each get a cell site (not forced land)', () => {
    const w = createWorld({ seed: 11, count: 500 });
    const north = w.cells.reduce((a, b) => (b.center.lat > a.center.lat ? b : a));
    const south = w.cells.reduce((a, b) => (b.center.lat < a.center.lat ? b : a));
    expect(north.id).not.toBe(south.id);
    expect(north.center.lat).toBeGreaterThan(88);
    expect(south.center.lat).toBeLessThan(-88);
    expect(north.polygon.length).toBeGreaterThanOrEqual(3);
    expect(south.polygon.length).toBeGreaterThanOrEqual(3);
    expect(north.isOcean).toBe(true);
    expect(south.isOcean).toBe(true);
  });

  it('sphericalVoronoi returns polys for most sites', () => {
    const sites = blueNoiseSphere(80, createRng(2));
    const { polys } = sphericalVoronoi(sites, 16);
    const ok = polys.filter((p) => p && p.length >= 3).length;
    expect(ok).toBeGreaterThan(sites.length * 0.75);
  });
});
