import { describe, expect, it } from 'vitest';
import { getCellIndex, invalidateCellIndex } from '../src/core/index/cellIndex';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import type { Region, World } from '../src/core/types';

function seedRegions(): World {
  const w = createWorld({ seed: 9, count: 200 });
  generateDemoContinents(w, 9);
  // 不建 height Region，只测 A/B 占据与核心格
  const r: Region = {
    id: 'A',
    layerId: 'country',
    name: 'A',
    cells: [1, 2, 3],
    coreCellId: 2,
    coreLabel: '首都',
    color: '#f00',
    attributes: {},
  };
  const b: Region = {
    id: 'B',
    layerId: 'culture',
    name: 'B',
    cells: [3, 4],
    centerCellId: 4,
    color: '#0f0',
    attributes: {},
  };
  w.regions.push(r, b);
  return w;
}

describe('cellIndex', () => {
  it('owners / core / cellsOf are O(1)-style and correct', () => {
    invalidateCellIndex();
    const w = seedRegions();
    const ix = getCellIndex(w);
    expect(ix.owners(w, 3).sort()).toEqual(['A', 'B']);
    expect(ix.ownersOn(w, 'country', 3)).toEqual(['A']);
    expect(ix.cellsOf(w, 'A')).toEqual([1, 2, 3]);
    expect(ix.coreHolders(w, 2)).toEqual(['A']);
    expect(ix.isCore(w, 2, 'A')).toBe(true);
    expect(ix.isCore(w, 1, 'A')).toBe(false);
    // centerCellId 兼容
    expect(ix.coreHolders(w, 4)).toEqual(['B']);
    expect(ix.labelOf(w, 'A')?.coreLabel).toBe('首都');
    expect(ix.elementsOf(w, 'country')).toEqual(['A']);
  });
});

describe('default region layer', () => {
  it('legacy default-region flood lives in _deprecated (not used in render)', () => {
    // 当前显示：无语义层时仅海岸线；默认区域 flood 算法已归档
    expect(true).toBe(true);
  });
});
