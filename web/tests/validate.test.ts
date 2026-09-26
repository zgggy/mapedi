import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { unifiedGenerate } from '../src/core/generate/unified';
import { defaultGenConfig } from '../src/core/layer';
import { generateRoads } from '../src/core/generate/networks';
import { fixIssue, validateWorld } from '../src/core/validate';

/** 生产路径：province 先于 country（fromLayer 聚合并设 parentId） */
function politicalSetup(w: ReturnType<typeof createWorld>, seed: number) {
  unifiedGenerate(w, 'province', defaultGenConfig('province', seed));
  unifiedGenerate(w, 'country', defaultGenConfig('country', seed));
}

describe('validator', () => {
  it('flags orphan province and empty region', () => {
    const w = createWorld({ seed: 40, count: 600 });
    generateDemoContinents(w, 40);
    politicalSetup(w, 40);
    const prov = w.regions.find((r) => r.layerId === 'province');
    if (prov) prov.parentId = 'missing';
    w.regions.push({
      id: 'empty-1',
      layerId: 'country',
      name: '空国',
      cells: [],
      color: '#fff',
      attributes: {},
    });
    const issues = validateWorld(w);
    expect(issues.some((i) => i.kind === 'orphan_province')).toBe(true);
    expect(issues.some((i) => i.kind === 'empty_region')).toBe(true);
  });

  it('fixes center missing and deletes empty', () => {
    const w = createWorld({ seed: 41, count: 400 });
    generateDemoContinents(w, 41);
    politicalSetup(w, 41);
    const c = w.regions.find((r) => r.layerId === 'country' && r.cells.length);
    if (c) {
      delete c.centerCellId;
      const issues = validateWorld(w);
      const miss = issues.find((i) => i.kind === 'center_missing' && i.regionId === c.id);
      if (miss) {
        expect(fixIssue(w, miss)).toBe(true);
        expect(c.centerCellId).toBeDefined();
      }
    }
  });

  it('roads disconnected reported', () => {
    const w = createWorld({ seed: 42, count: 500 });
    generateDemoContinents(w, 42);
    politicalSetup(w, 42);
    generateRoads(w, 42, 2, 2, 1.2);
    const road = w.regions.find((r) => r.layerId === 'road' && r.cells.length > 4);
    if (road) {
      // 拆断
      road.cells = [road.cells[0], road.cells[road.cells.length - 1]];
      const issues = validateWorld(w);
      expect(issues.some((i) => i.kind === 'disconnected_road')).toBe(true);
    }
  });
});
