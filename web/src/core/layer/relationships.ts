/** 元素关系：相邻（共享边）+ 重叠（共享 cell；大重叠只记 count，防卡死） */
import type { CellId, ElementOverlap, Region, World } from '../types';

const MAX_SHARED_CELLS = 64;

export function computeRelationships(
  world: World,
  elements: Region[],
  opts?: { lite?: boolean },
): void {
  const cellToElements = new Map<CellId, Set<string>>();
  for (const el of elements) {
    for (const c of el.cells) {
      let s = cellToElements.get(c);
      if (!s) {
        s = new Set();
        cellToElements.set(c, s);
      }
      s.add(el.id);
    }
  }

  for (const el of elements) {
    const myCells = new Set(el.cells);
    const adj = new Set<string>();
    if (!opts?.lite) {
      for (const n of el.cells) {
        for (const nb of world.cells[n].neighbors) {
          if (!myCells.has(nb)) {
            const owners = cellToElements.get(nb);
            if (owners) for (const oid of owners) {
              if (oid !== el.id) adj.add(oid);
            }
          }
        }
      }
    }
    el.adjacentElementIds = adj;

    const overlaps: ElementOverlap[] = [];
    for (const other of elements) {
      if (other.id === el.id) continue;
      const otherCells = new Set(other.cells);
      let count = 0;
      const shared: CellId[] = [];
      for (const c of el.cells) {
        if (otherCells.has(c)) {
          count++;
          if (shared.length < MAX_SHARED_CELLS) shared.push(c);
        }
      }
      if (count > 0) {
        const type =
          count === el.cells.length && count === other.cells.length ? 'complete' : 'partial';
        overlaps.push({
          elementId: other.id,
          type,
          sharedCells: shared,
          sharedCount: count,
        });
      }
    }
    el.overlaps = overlaps;
  }
}
