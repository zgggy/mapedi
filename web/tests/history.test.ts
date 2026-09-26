import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import {
  AnnexCommand,
  DeleteRegionCommand,
  History,
  PaintCellsCommand,
} from '../src/core/history';
import { listWindow, syntheticRowRects } from '../src/ui/shell/virtualList';
import type { Region } from '../src/core/types';

function w2() {
  const w = createWorld({ seed: 60, count: 300 });
  generateDemoContinents(w, 60);
  return w;
}

describe('History commands', () => {
  it('paint undo/redo', () => {
    const w = w2();
    const r: Region = {
      id: 'r1',
      layerId: 'country',
      name: 'R',
      cells: [0],
      color: '#fff',
      attributes: {},
    };
    w.regions.push(r);
    const h = new History();
    h.run(w, new PaintCellsCommand('r1', [1, 2], []));
    expect(r.cells.sort()).toEqual([0, 1, 2]);
    h.undo(w);
    expect(r.cells).toEqual([0]);
    h.redo(w);
    expect(r.cells.sort()).toEqual([0, 1, 2]);
  });

  it('delete keeps children and undo restores', () => {
    const w = w2();
    const c: Region = {
      id: 'c1',
      layerId: 'country',
      name: 'C',
      cells: [1],
      color: '#fff',
      attributes: {},
    };
    const p: Region = {
      id: 'p1',
      layerId: 'province',
      name: 'P',
      cells: [1],
      parentId: 'c1',
      color: '#fff',
      attributes: {},
    };
    w.regions.push(c, p);
    const h = new History();
    h.run(w, new DeleteRegionCommand('c1'));
    expect(w.regions.find((r) => r.id === 'c1')).toBeUndefined();
    expect(w.regions.find((r) => r.id === 'p1')!.parentId).toBeUndefined();
    h.undo(w);
    expect(w.regions.find((r) => r.id === 'c1')).toBeTruthy();
    expect(w.regions.find((r) => r.id === 'p1')!.parentId).toBe('c1');
  });

  it('annex undo', () => {
    const w = w2();
    w.regions.push(
      {
        id: 'a',
        layerId: 'country',
        name: 'A',
        cells: [0, 1],
        color: '#f00',
        attributes: {},
      },
      {
        id: 'b',
        layerId: 'country',
        name: 'B',
        cells: [1, 2],
        color: '#0f0',
        attributes: {},
      },
    );
    const h = new History();
    h.run(w, new AnnexCommand('a', 'b'));
    expect(w.regions.find((r) => r.id === 'b')).toBeUndefined();
    expect(w.regions.find((r) => r.id === 'a')!.cells).toContain(2);
    h.undo(w);
    expect(w.regions.find((r) => r.id === 'b')!.cells).toEqual([1, 2]);
    expect(w.regions.find((r) => r.id === 'a')!.cells).toEqual([0, 1]);
  });

  it('paint keeps multi-step undo (no silent coalesce)', () => {
    const w = w2();
    const r: Region = {
      id: 'pc',
      layerId: 'country',
      name: 'PC',
      cells: [0],
      color: '#fff',
      attributes: {},
    };
    w.regions.push(r);
    const h = new History();
    h.run(w, new PaintCellsCommand('pc', [1], []));
    h.run(w, new PaintCellsCommand('pc', [2], [0]));
    expect(h.depth).toBe(2);
    h.undo(w);
    expect([...r.cells].sort()).toEqual([0, 1]);
    h.undo(w);
    expect([...r.cells].sort()).toEqual([0]);
  });

  it('delete COW undo restores cells identity after paint replace', () => {
    const w = w2();
    const r: Region = {
      id: 'cow',
      layerId: 'country',
      name: 'Cow',
      cells: [1, 2],
      color: '#fff',
      attributes: {},
    };
    w.regions.push(r);
    const h = new History();
    h.run(w, new DeleteRegionCommand('cow'));
    h.undo(w);
    const back = w.regions.find((x) => x.id === 'cow')!;
    expect(back.cells).toEqual([1, 2]);
    // 再绘制替换 cells 引用，不应破坏 history
    h.run(w, new PaintCellsCommand('cow', [3], []));
    expect(back.cells.sort()).toEqual([1, 2, 3]);
  });
});

describe('virtual list window', () => {
  it('computes overscan window and synthetic rects', () => {
    const win = listWindow(200, 400, 400, 40, 4);
    expect(win.start).toBeGreaterThanOrEqual(0);
    expect(win.end).toBeLessThanOrEqual(200);
    expect(win.padTop + (win.end - win.start) * 40 + win.padBottom).toBe(200 * 40);
    const rects = syntheticRowRects(['a', 'b', 'c'], 100, 40, 'b');
    expect(rects.map((r) => r.id)).toEqual(['a', 'c']);
    expect(rects[0].top).toBe(100);
  });
});
