import { describe, expect, it } from 'vitest';
import { History, PaintCellsCommand } from '../src/core/history';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';

describe('history multi-step undo', () => {
  it('undoes more than one paint stroke', () => {
    const w = createWorld({ seed: 9, count: 200 });
    generateDemoContinents(w, 9);
    const region = {
      id: 'r1',
      layerId: 'country',
      name: 'T',
      cells: [] as number[],
      color: '#fff',
      attributes: {},
    };
    w.regions.push(region);
    const h = new History();
    const land = w.cells.filter((c) => c.height > 0).map((c) => c.id);
    expect(land.length).toBeGreaterThan(3);

    h.run(w, new PaintCellsCommand('r1', [land[0]], []));
    h.run(w, new PaintCellsCommand('r1', [land[1]], []));
    h.run(w, new PaintCellsCommand('r1', [land[2]], []));
    expect(region.cells.length).toBe(3);
    expect(h.depth).toBe(3);

    // undo/redo 返回被执行的命令（1-c 纯数据契约），null = 空栈
    expect(h.undo(w)).toBeTruthy();
    expect(region.cells.length).toBe(2);
    expect(h.undo(w)).toBeTruthy();
    expect(region.cells.length).toBe(1);
    expect(h.undo(w)).toBeTruthy();
    expect(region.cells.length).toBe(0);
    expect(h.undo(w)).toBeNull();
    expect(h.depth).toBe(0);

    expect(h.redo(w)).toBeTruthy();
    expect(region.cells.length).toBe(1);
  });
});
