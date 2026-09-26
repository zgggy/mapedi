import { describe, expect, it } from 'vitest';
import { lonLatToVec3, vec3ToLonLat } from '../src/core/sphere';

describe('sphere orientation matches 2D map', () => {
  it('east (+lon) is +X', () => {
    const [x, , z] = lonLatToVec3({ lon: 90, lat: 0 });
    expect(x).toBeGreaterThan(0.9);
    expect(Math.abs(z)).toBeLessThan(0.01);
  });

  it('north (+lat) is -Y (canvas-like, down on screen)', () => {
    const [, y] = lonLatToVec3({ lon: 0, lat: 90 });
    expect(y).toBeLessThan(-0.9);
  });

  it('lon 0 faces +Z (camera default)', () => {
    const [x, , z] = lonLatToVec3({ lon: 0, lat: 0 });
    expect(z).toBeGreaterThan(0.9);
    expect(Math.abs(x)).toBeLessThan(0.01);
  });

  it('roundtrip lon/lat', () => {
    const ll = { lon: -123.4, lat: 37.8 };
    const back = vec3ToLonLat(lonLatToVec3(ll));
    expect(back.lon).toBeCloseTo(ll.lon, 4);
    expect(back.lat).toBeCloseTo(ll.lat, 4);
  });
});
