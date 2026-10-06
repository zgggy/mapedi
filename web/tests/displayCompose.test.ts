import { describe, expect, it } from 'vitest';
import {
  composeShownPieces,
  splitRegionForDisplay,
  visibleColorRoots,
  displayTree,
  materializeBackPropagate,
  isLayerShown,
  VIRTUAL_PARENT,
} from '../src/core/displayCompose';
import type { LayerDef, Region, World } from '../src/core/types';

function layer(id: string, parent?: string, visible?: boolean): LayerDef {
  return {
    id,
    name: id,
    kind: id === 'road' ? 'road' : 'custom',
    modeDefault: 'view',
    parentLayerId: parent,
    visible,
    allowOverlap: true,
    requireAdjacency: false,
    requireCenter: false,
    styleSetId: 'default',
  };
}

function region(id: string, layerId: string, name: string, cells: number[], parentId?: string): Region {
  return { id, layerId, name, cells, parentId, color: '#88aa88', attributes: {} };
}

function worldOf(layers: LayerDef[], regions: Region[]): World {
  return {
    meta: { seed: 1, cellCount: 10, formatVersion: 1, createdAt: 0 },
    cells: [],
    rivers: new Map(),
    layers,
    regions,
  } as World;
}

function sets(regs: Region[]): { name: string; set: Set<number> }[] {
  return regs.map((r) => ({ name: r.name, set: new Set(r.cells) }));
}

describe('displayCompose', () => {
  it('splits child region across parents with English parens and virtual parent', () => {
    const A = region('A', 'country', 'A', [1, 2, 3]);
    const B = region('B', 'country', 'B', [4, 5]);
    const c = region('c', 'culture', 'c', [2, 3, 4, 5, 9]);
    const slices = splitRegionForDisplay(c, [sets([A, B])]);
    const byLabel = Object.fromEntries(slices.map((s) => [s.label, [...s.cells].sort()]));
    expect(byLabel['c(A)']).toEqual([2, 3]);
    expect(byLabel['c(B)']).toEqual([4, 5]);
    expect(byLabel[`c(${VIRTUAL_PARENT})`]).toEqual([9]);
  });

  it('multi-level nesting labels r(c(A))', () => {
    const A = region('A', 'country', 'A', [1, 2, 3, 4]);
    const c = region('c', 'culture', 'c', [2, 3, 4, 5]);
    const r = region('r', 'religion', 'r', [2, 3, 5]);
    const slices = splitRegionForDisplay(r, [sets([c]), [ { name: 'A', set: new Set([1, 2, 3, 4]) } ]]);
    const hit = slices.find((s) => s.cells.includes(2) && s.cells.includes(3));
    expect(hit?.label).toBe('r(c(A))');
  });

  it('country with empty cells + province kids: materialize writes union into region.cells', () => {
    const A = region('A', 'country', 'A', []);
    const B = region('B', 'country', 'B', []);
    const p = region('p1', 'province', 'p', [2, 3, 4, 7], 'A');
    const q = region('q1', 'province', 'q', [5, 6], 'B');
    const w = worldOf(
      [layer('country', undefined, true), layer('province', 'country', true)],
      [A, B, p, q],
    );
    materializeBackPropagate(w);
    expect([...A.cells].sort()).toEqual([2, 3, 4, 7]);
    const pieces = composeShownPieces(w, 'province');
    const labels = pieces.map((x) => x.label);
    // 统一接口：shown 层都出元素；行省含 p(A)/q(B)
    expect(labels).toContain('p(A)');
    expect(labels).toContain('q(B)');
    expect(labels.filter((l) => l.includes(VIRTUAL_PARENT))).toEqual([]);
    expect(pieces.some((p) => p.layerId === 'province')).toBe(true);
  });

  it('parent+child counts as one quota slot (max 3 roots)', () => {
    const w = worldOf(
      [
        layer('height', undefined, true),
        layer('country', undefined, true),
        layer('culture', 'country', true),
        layer('religion', undefined, true),
        layer('fauna', undefined, true),
        layer('road', undefined, true),
      ],
      [],
    );
    const roots = visibleColorRoots(w, 3);
    expect(roots).toEqual(['height', 'country', 'religion']);
    expect(displayTree(w, 'country').map((t) => t.layerId)).toEqual(['country', 'culture']);
  });

  it('shown = visible or selected (same interface)', () => {
    const w = worldOf(
      [
        layer('environment', undefined, true),
        layer('country', undefined, true),
      ],
      [
        region('env', 'environment', 'E', [1, 2]),
        region('A', 'country', 'A', [1, 2, 3]),
      ],
    );
    // 两层都 visible → 都展示
    const both = composeShownPieces(w, '');
    expect(both.some((p) => p.layerId === 'environment')).toBe(true);
    expect(both.some((p) => p.layerId === 'country')).toBe(true);
    // 选中 country → 仍展示；country 碎片排后面
    const pieces = composeShownPieces(w, 'country', 'A');
    expect(pieces.some((p) => p.label === 'A' && p.regionSelected)).toBe(true);
    const last = pieces[pieces.length - 1];
    expect(last.regionSelected).toBe(true);
  });
});
