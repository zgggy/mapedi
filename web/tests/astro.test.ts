import { describe, expect, it } from 'vitest';
import { defaultClimate } from '../src/core/types';
import {
  auToScene,
  defaultStarSystem,
  orbitEllipsePoints,
  syncHomeFromClimate,
} from '../src/core/astro';

describe('astro star system', () => {
  const climate = defaultClimate();
  const sys = defaultStarSystem(42, climate);

  it('has star, home orbit, moons, and sibling planets', () => {
    expect(sys.star.luminosity).toBeGreaterThan(0);
    expect(sys.home.orbit.semiMajor).toBeGreaterThan(0);
    expect(sys.home.orbit.period).toBeGreaterThan(0);
    expect(sys.home.moons.length).toBeGreaterThanOrEqual(1);
    expect(sys.planets.length).toBeGreaterThanOrEqual(2);
  });

  it('syncs home rotation/tilt from climate', () => {
    const c = { ...climate, axialTiltDeg: 40, rotationHours: 18, rotationPrograde: false };
    const s = syncHomeFromClimate(sys, c);
    expect(s.home.axialTiltDeg).toBe(40);
    expect(s.home.rotationHours).toBe(18);
    expect(s.home.rotationPrograde).toBe(false);
  });

  it('compresses AU for scene display', () => {
    const a1 = auToScene(1);
    const a2 = auToScene(2);
    expect(a2).toBeGreaterThan(a1);
    expect(a1).toBeGreaterThan(0.5);
    expect(a2).toBeLessThan(a1 * 2.5);
  });

  it('orbit ellipse has finite points', () => {
    const pts = orbitEllipsePoints(sys.home.orbit, 2, 32);
    expect(pts.length).toBe(33 * 3);
    expect(pts.every((n) => Number.isFinite(n))).toBe(true);
  });
});
