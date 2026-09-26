import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { generatePolitical } from '../src/core/political';
import {
  getCellSetRingsCached,
  invalidateBorderCache,
  ringBBoxHitsView,
} from '../src/render/borderCache';
import { project } from '../src/core/project/projections';
import { defaultProjParams } from '../src/core/project/projections';

const pp = defaultProjParams();
const proj = (ll: { lon: number; lat: number }) => project(ll, 'mercator', pp);

describe('border cache', () => {
  it('caches cellSet rings and reuses on second call', () => {
    const w = createWorld({ seed: 12, count: 800 });
    generateDemoContinents(w, 12);
    generatePolitical(w, 12, 4);
    const country = w.regions.find((r) => r.layerId === 'country');
    expect(country).toBeTruthy();
    const a = getCellSetRingsCached(w, country!.cells, proj, 'mercator');
    const b = getCellSetRingsCached(w, country!.cells, proj, 'mercator');
    expect(a).toBe(b);
  });

  it('invalidate forces recompute', () => {
    const w = createWorld({ seed: 13, count: 400 });
    generateDemoContinents(w, 13);
    generatePolitical(w, 13, 3);
    const country = w.regions.find((r) => r.layerId === 'country')!;
    const a = getCellSetRingsCached(w, country.cells, proj, 'mercator');
    invalidateBorderCache();
    const b = getCellSetRingsCached(w, country.cells, proj, 'mercator');
    expect(a).not.toBe(b);
  });

  it('ringBBoxHitsView culls far owners', () => {
    expect(
      ringBBoxHitsView({ minX: 1, maxX: 2, minY: 0, maxY: 1 }, 0, 0.5, 2, -2),
    ).toBe(false);
    expect(
      ringBBoxHitsView({ minX: 0, maxX: 1, minY: 0, maxY: 1 }, -0.2, 0.2, 2, -2),
    ).toBe(true);
  });

  it('piece cellSet rings track slice, not whole region', () => {
    const w = createWorld({ seed: 21, count: 400 });
    generateDemoContinents(w, 21);
    generatePolitical(w, 21, 3);
    const country = w.regions.find((r) => r.layerId === 'country')!;
    const all = [
      ...country.cells,
      ...w.regions.filter((r) => r.parentId === country.id).flatMap((r) => r.cells),
    ];
    const unique = [...new Set(all)];
    expect(unique.length).toBeGreaterThan(1);
    const half = unique.slice(0, Math.max(1, Math.floor(unique.length / 2)));
    const whole = getCellSetRingsCached(w, unique, proj, 'mercator');
    const slice = getCellSetRingsCached(w, half, proj, 'mercator');
    expect(whole.rings.length).toBeGreaterThanOrEqual(1);
    const nWhole = whole.rings.reduce((s, r) => s + r.pts.length, 0);
    const nSlice = slice.rings.reduce((s, r) => s + r.pts.length, 0);
    expect(nSlice).toBeGreaterThan(0);
    expect(nSlice).toBeLessThan(nWhole + half.length);
    const again = getCellSetRingsCached(w, half, proj, 'mercator');
    expect(again).toBe(slice);
  });

  it('single-cell island ring is closed through edge midpoints', () => {
    const w = createWorld({ seed: 1467, count: 300 });
    generateDemoContinents(w, 1467);
    const iso =
      w.cells.find((c) => c.height > 0 && c.neighbors.every((n) => w.cells[n].height <= 0)) ??
      w.cells.find((c) => c.height > 0)!;
    const { rings } = getCellSetRingsCached(w, [iso.id], proj, 'mercator');
    expect(rings.length).toBeGreaterThanOrEqual(1);
    const ring = rings[0];
    expect(ring.closed).toBe(true);
    expect(ring.pts.length).toBeGreaterThanOrEqual(3);
    expect(ring.pts.length).toBeLessThanOrEqual(Math.max(3, iso.polygon.length + 1));
    expect(ring.verts.length).toBe(ring.pts.length);
  });
});
