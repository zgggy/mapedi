import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import {
  absorbLandCell,
  rebuildHeightRegions,
  heightKindOf,
} from '../src/core/heightRegions';
import { demoteRegionAsChild, promoteRegionToParentLayer } from '../src/core/regionOps';
import { generatePolitical } from '../src/core/political';

describe('height absorb + identity', () => {
  it('land cell joins neighbor continent id', () => {
    const w = createWorld({ seed: 3, count: 400 });
    generateDemoContinents(w, 3);
    rebuildHeightRegions(w);
    const cont = w.regions.filter((r) => r.layerId === 'height' && heightKindOf(r) === 'continent');
    expect(cont.length).toBeGreaterThan(0);
    // 取一个大陆边缘的海洋格，抬升后应 absorb 到邻接 continentId
    const land = new Set(cont.flatMap((r) => r.cells));
    let target = -1;
    for (const c of w.cells) {
      if (c.height > 0) continue;
      if (c.neighbors.some((n) => land.has(n))) {
        target = c.id;
        break;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    w.cells[target].height = 0.5;
    w.cells[target].isOcean = false;
    absorbLandCell(w, target);
    expect(w.cells[target].continentId).toBeGreaterThanOrEqual(0);
  });

  it('rebuild keeps overlapping continent identity', () => {
    const w = createWorld({ seed: 11, count: 600 });
    generateDemoContinents(w, 11);
    rebuildHeightRegions(w);
    const a = w.regions.find((r) => r.layerId === 'height' && heightKindOf(r) === 'continent')!;
    const id = a.id;
    rebuildHeightRegions(w);
    const still = w.regions.find((r) => r.id === id);
    expect(still).toBeTruthy();
  });
});

describe('demote / promote regions', () => {
  it('country demotes to province under another country', () => {
    const w = createWorld({ seed: 21, count: 800 });
    generateDemoContinents(w, 21);
    generatePolitical(w, 21, 4);
    const countries = w.regions.filter((r) => r.layerId === 'country');
    expect(countries.length).toBeGreaterThanOrEqual(2);
    const a = countries[0];
    const b = countries[1];
    const provincesBefore = w.regions.filter((r) => r.parentId === a.id);
    const r = demoteRegionAsChild(w, a.id, b.id);
    expect(r.ok).toBe(true);
    const after = w.regions.find((x) => x.id === a.id)!;
    expect(after.layerId).toBe('province');
    expect(after.parentId).toBe(b.id);
    // 原子元素已并入
    for (const p of provincesBefore) {
      expect(w.regions.find((x) => x.id === p.id)).toBeFalsy();
    }
  });

  it('province promotes to country with one child province', () => {
    const w = createWorld({ seed: 33, count: 800 });
    generateDemoContinents(w, 33);
    generatePolitical(w, 33, 4);
    const prov = w.regions.find((r) => r.layerId === 'province');
    expect(prov).toBeTruthy();
    const r = promoteRegionToParentLayer(w, prov!.id);
    expect(r.ok).toBe(true);
    const up = w.regions.find((x) => x.id === prov!.id)!;
    expect(up.layerId).toBe('country');
    expect(up.parentId).toBeUndefined();
    const kid = w.regions.find((x) => x.parentId === up.id && x.layerId === 'province');
    expect(kid).toBeTruthy();
    expect(new Set(kid!.cells)).toEqual(new Set(up.cells));
  });
});
