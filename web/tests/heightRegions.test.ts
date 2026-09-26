import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import {
  rebuildHeightRegions,
  heightKindOf,
  lakeMaxCells,
  heightTopologyChanged,
} from '../src/core/heightRegions';

describe('height regions', () => {
  it('creates continent / lake / ocean regions', () => {
    const w = createWorld({ seed: 42, count: 1200 });
    generateDemoContinents(w, 42);
    rebuildHeightRegions(w);

    const landsea = w.regions.filter((r) => r.layerId === 'landsea');
    expect(landsea.length).toBeGreaterThan(0);

    const kinds = landsea.map(heightKindOf);
    expect(kinds.some((k) => k === 'continent')).toBe(true);
    expect(kinds.some((k) => k === 'ocean' || k === 'lake')).toBe(true);

    // cells 不重叠覆盖陆地/海洋
    const land = w.cells.filter((c) => c.height > 0).map((c) => c.id);
    const contCells = new Set(
      landsea.filter((r) => heightKindOf(r) === 'continent').flatMap((r) => r.cells),
    );
    expect(land.every((id) => contCells.has(id))).toBe(true);

    const ocean = w.cells.filter((c) => c.height <= 0).map((c) => c.id);
    const waterCells = new Set(
      landsea.filter((r) => heightKindOf(r) !== 'continent').flatMap((r) => r.cells),
    );
    expect(ocean.every((id) => waterCells.has(id))).toBe(true);

    // 湖泊不大于阈值
    const maxL = lakeMaxCells(w.cells.length);
    for (const r of landsea) {
      if (heightKindOf(r) === 'lake') expect(r.cells.length).toBeLessThanOrEqual(maxL);
    }
  });

  it('rebuild replaces previous height regions', () => {
    const w = createWorld({ seed: 7, count: 400 });
    generateDemoContinents(w, 7);
    rebuildHeightRegions(w);
    const n1 = w.regions.filter((r) => r.layerId === 'landsea').length;
    rebuildHeightRegions(w);
    const n2 = w.regions.filter((r) => r.layerId === 'landsea').length;
    expect(n2).toBe(n1);
  });

  it('heightTopologyChanged detects land/ocean flips only', () => {
    expect(heightTopologyChanged([{ h0: 0.2, h1: 0.5 }])).toBe(false);
    expect(heightTopologyChanged([{ h0: -0.2, h1: -0.8 }])).toBe(false);
    expect(heightTopologyChanged([{ h0: 0.2, h1: 0 }])).toBe(true);
    expect(heightTopologyChanged([{ h0: -0.1, h1: 0.05 }])).toBe(true);
  });

  it('incremental rebuild never duplicates region ids (each_key_duplicate)', () => {
    const w = createWorld({ seed: 3, count: 600 });
    generateDemoContinents(w, 3);
    rebuildHeightRegions(w);
    // 造出一块独立新陆地（不与现有陆地邻接时可能新 id）
    const ocean = w.cells.find((c) => c.height <= 0 && c.neighbors.some((n) => w.cells[n].height > 0))!;
    // 把不连通的远海抬成陆：找一块与 ocean 不相邻的海
    const far = w.cells.find(
      (c) =>
        c.height <= 0 &&
        c.id !== ocean.id &&
        !c.neighbors.includes(ocean.id) &&
        !ocean.neighbors.includes(c.id),
    );
    if (far) {
      far.height = 0.4;
      far.isOcean = false;
      rebuildHeightRegions(w, [far.id, ocean.id]);
    } else {
      // 备选：只动 ocean 周边
      ocean.height = 0.3;
      ocean.isOcean = false;
      rebuildHeightRegions(w, [ocean.id]);
    }
    // 再触发一次增量，制造 keep+new 共存
    const land2 = w.cells.find((c) => c.height > 0)!;
    land2.height = 0;
    land2.isOcean = true;
    rebuildHeightRegions(w, [land2.id]);
    rebuildHeightRegions(w, [w.cells[0].id]);

    const ids = w.regions.filter((r) => r.layerId === 'landsea').map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('incremental rebuild matches full rebuild after topology flip', () => {
    const w = createWorld({ seed: 99, count: 800 });
    generateDemoContinents(w, 99);
    rebuildHeightRegions(w);

    // 选一个陆地 cell 变海，触发拓扑变化
    const landCell = w.cells.find((c) => c.height > 0)!;
    landCell.height = 0;
    landCell.isOcean = true;
    landCell.continentId = undefined;

    rebuildHeightRegions(w, [landCell.id]);
    const incremental = w.regions
      .filter((r) => r.layerId === 'landsea')
      .map((r) => ({ id: r.id, cells: [...r.cells].sort((a, b) => a - b), kind: heightKindOf(r) }))
      .sort((a, b) => a.id.localeCompare(b.id));

    // 对照全量
    const w2 = createWorld({ seed: 99, count: 800 });
    generateDemoContinents(w2, 99);
    rebuildHeightRegions(w2);
    w2.cells[landCell.id].height = 0;
    w2.cells[landCell.id].isOcean = true;
    rebuildHeightRegions(w2);
    const full = w2.regions
      .filter((r) => r.layerId === 'landsea')
      .map((r) => ({ cells: [...r.cells].sort((a, b) => a - b), kind: heightKindOf(r) }))
      .sort((a, b) => a.cells.length - b.cells.length);

    const incSorted = incremental
      .map((r) => ({ cells: r.cells, kind: r.kind }))
      .sort((a, b) => a.cells.length - b.cells.length);
    expect(incSorted).toEqual(full);
  });
});
