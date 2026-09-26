import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { generatePolitical, childrenOf } from '../src/core/political';
import {
  annexRegion,
  deleteRegionKeepChildren,
  restoreRegions,
  snapshotRegions,
} from '../src/core/regionOps';

function makeWorld() {
  const w = createWorld({ seed: 33, count: 900 });
  generateDemoContinents(w, 33);
  generatePolitical(w, 33, 5);
  return w;
}

describe('region ops', () => {
  it('delete keeps children as unassigned', () => {
    const w = makeWorld();
    const country = w.regions.find((r) => r.layerId === 'country')!;
    const kids = childrenOf(w, country.id);
    expect(kids.length).toBeGreaterThan(0);
    expect(deleteRegionKeepChildren(w, country.id)).toBe(true);
    expect(w.regions.find((r) => r.id === country.id)).toBeUndefined();
    for (const k of kids) {
      const still = w.regions.find((r) => r.id === k.id);
      expect(still).toBeTruthy();
      expect(still!.parentId).toBeUndefined();
    }
  });

  it('annex merges cells and reparents', () => {
    const w = makeWorld();
    const countries = w.regions.filter((r) => r.layerId === 'country');
    expect(countries.length).toBeGreaterThanOrEqual(2);
    const a = countries[0];
    const b = countries[1];
    const bKids = childrenOf(w, b.id);
    const aCount = a.cells.length;
    const bCount = b.cells.length;
    expect(annexRegion(w, a.id, b.id)).toBe(true);
    expect(w.regions.find((r) => r.id === b.id)).toBeUndefined();
    expect(a.cells.length).toBeGreaterThanOrEqual(aCount + bCount - 2);
    for (const k of bKids) {
      const still = w.regions.find((r) => r.id === k.id)!;
      expect(still.parentId).toBe(a.id);
    }
  });

  it('annex is undoable via snapshot', () => {
    const w = makeWorld();
    const countries = w.regions.filter((r) => r.layerId === 'country');
    const snap = snapshotRegions(w);
    annexRegion(w, countries[0].id, countries[1].id);
    restoreRegions(w, snap);
    expect(w.regions.find((r) => r.id === countries[1].id)).toBeTruthy();
  });
});
