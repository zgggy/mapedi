import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { CellGrid } from '../src/core/index/cellGrid';
import { getRegionIndex, invalidateRegionIndex } from '../src/core/index/regionIndex';
import { cellsInBrush } from '../src/core/draw/brush';

describe('CellGrid', () => {
  it('queryRadius matches brute force', () => {
    const w = createWorld({ seed: 11, count: 900 });
    generateDemoContinents(w, 11);
    const g = new CellGrid();
    g.rebuild(w);
    const ref = w.cells.find((c) => c.height > 0) ?? w.cells[0];
    const lon = ref.center.lon;
    const lat = ref.center.lat;
    const r = 3;
    const a = new Set(g.queryRadius(w, lon, lat, r));
    const b = new Set(
      w.cells
        .filter((c) => (c.center.lon - lon) ** 2 + (c.center.lat - lat) ** 2 <= r * r)
        .map((c) => c.id),
    );
    expect([...a].sort()).toEqual([...b].sort());
    expect(a.size).toBeGreaterThan(0);
    const hits = cellsInBrush(w, lon, lat, r);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe('RegionIndex', () => {
  it('fillMap and owners', () => {
    const w = createWorld({ seed: 12, count: 400 });
    generateDemoContinents(w, 12);
    invalidateRegionIndex();
    w.regions.push({
      id: 'c1',
      layerId: 'country',
      name: 'A',
      cells: [0, 1, 2],
      color: '#f00',
      attributes: {},
    });
    w.regions.push({
      id: 'c2',
      layerId: 'country',
      name: 'B',
      cells: [2, 3],
      color: '#0f0',
      attributes: {},
    });
    invalidateRegionIndex();
    const idx = getRegionIndex(w);
    expect(idx.owners(w, 'country', 2).length).toBe(2);
    expect(idx.fillMap(w, 'country').get(1)).toBe('#f00');
    // 修改后 key 变化自动 rebuild
    w.regions[0].cells = [0];
    invalidateRegionIndex();
    expect(getRegionIndex(w).owners(w, 'country', 2)).toEqual(['c2']);
  });
});
