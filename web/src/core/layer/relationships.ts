/** 元素关系：相邻（共享边）+ 重叠（共享 cell；大重叠只记 count，防卡死） */
import type { CellId, ElementOverlap, Region, World } from '../types';

const MAX_SHARED_CELLS = 64;

/**
 * 划分快路径：元素 cells 互不相交时（海陆层不变量）重叠恒空，
 * 邻接用整型 owner 扫描（O(cells×deg) 无 Set/Map）。返回 owner 数组；
 * 双属同一 cell（前置不成立）返回 null → 调用方走通用版。
 */
function partitionOwner(elements: Region[], cellCount: number): Int32Array | null {
  const owner = new Int32Array(cellCount).fill(-1);
  for (let i = 0; i < elements.length; i++) {
    for (const c of elements[i].cells) {
      if (!(c >= 0 && c < cellCount) || owner[c] !== -1) return null;
      owner[c] = i;
    }
  }
  return owner;
}

export function computeRelationships(
  world: World,
  elements: Region[],
  opts?: { lite?: boolean },
): void {
  const owner = opts?.lite ? null : partitionOwner(elements, world.cells.length);
  if (owner) {
    const m = elements.length;
    const adjIdx: number[][] = elements.map(() => []);
    // 对去重：m 小用整型戳，m 大退回 Set
    const pairStamp = m <= 2048 ? new Int32Array(m * m) : null;
    const seen = pairStamp ? null : new Set<number>();
    const wcells = world.cells;
    for (let i = 0; i < m; i++) {
      const cells = elements[i].cells;
      for (let k = 0; k < cells.length; k++) {
        const nbs = wcells[cells[k]].neighbors;
        for (let t = 0; t < nbs.length; t++) {
          const j = owner[nbs[t]];
          if (j < 0 || j === i) continue;
          const key = i < j ? i * m + j : j * m + i;
          if (pairStamp) {
            if (pairStamp[key]) continue;
            pairStamp[key] = 1;
          } else {
            if (seen!.has(key)) continue;
            seen!.add(key);
          }
          adjIdx[i].push(j);
          adjIdx[j].push(i);
        }
      }
    }
    for (let i = 0; i < m; i++) {
      elements[i].adjacentElementIds = new Set(adjIdx[i].map((j) => elements[j].id));
      elements[i].overlaps = [];
    }
    return;
  }

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

  // 重叠：单次扫描 cellToElements 的 owners 对（输出敏感）
  const SEP = '\u0000';
  const pairCount = new Map<string, number>();
  const pairShared = new Map<string, CellId[]>();
  for (const [cid, owners] of cellToElements) {
    if (owners.size < 2) continue;
    const arr = [...owners];
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i] < arr[j] ? arr[i] : arr[j];
        const b = arr[i] < arr[j] ? arr[j] : arr[i];
        const k = a + SEP + b;
        pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
        const shared = pairShared.get(k);
        if (shared) {
          if (shared.length < MAX_SHARED_CELLS) shared.push(cid);
        } else {
          pairShared.set(k, [cid]);
        }
      }
    }
  }

  const byId = new Map(elements.map((e) => [e.id, e]));
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
    for (const [k, count] of pairCount) {
      const sep = k.indexOf(SEP);
      const a = k.slice(0, sep);
      const b = k.slice(sep + 1);
      const otherId = a === el.id ? b : b === el.id ? a : null;
      if (!otherId) continue;
      const other = byId.get(otherId);
      if (!other) continue;
      overlaps.push({
        elementId: otherId,
        type:
          count === el.cells.length && count === other.cells.length ? 'complete' : 'partial',
        sharedCells: pairShared.get(k) ?? [],
        sharedCount: count,
      });
    }
    el.overlaps = overlaps;
  }
}
