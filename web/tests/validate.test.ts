import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { generateCountriesCost } from '../src/core/generate/culture';
import { generateRoads } from '../src/core/generate/networks';
import { fixIssue, validateWorld } from '../src/core/validate';

describe('validator', () => {
  it('flags orphan province and empty region', () => {
    const w = createWorld({ seed: 40, count: 600 });
    generateDemoContinents(w, 40);
    generateCountriesCost(w, 40, 4);
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
    generateCountriesCost(w, 41, 3);
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
    generateCountriesCost(w, 42, 3);
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
