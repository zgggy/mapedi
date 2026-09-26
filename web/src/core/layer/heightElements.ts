/**
 * 高度区间元素：固定 12 档，**嵌套重叠 = 等高线**。
 *
 * 归属（海陆同一规则，不反向）：
 *   cell.height ≥ 区间.lo  ⇒  该 cell ∈ 此区间元素
 *   即：**低区间自动包含更高的 cell**（顶峰 ⊂ 高山 ⊂ … ⊂ 深海）
 */
import type { CellId, Region, World } from '../types';
import { HEIGHT_INTERVALS } from './heightIntervals';

/** cell 是否落在区间元素内（低区间含高 cell） */
export function cellInInterval(h: number, lo: number, _hi: number): boolean {
  return Math.round(h) >= lo;
}

/**
 * 写回 world.regions 的 height 层 12 个区间元素。
 * 不调用 computeRelationships（大重叠只记 count）。
 */
export function rebuildHeightIntervalElements(world: World): Region[] {
  const cellsPer: CellId[][] = HEIGHT_INTERVALS.map(() => []);
  for (const c of world.cells) {
    const h = Math.round(c.height);
    for (let i = 0; i < 12; i++) {
      const iv = HEIGHT_INTERVALS[i];
      if (h >= iv.lo) cellsPer[i].push(c.id);
    }
  }

  const els: Region[] = HEIGHT_INTERVALS.map((iv, i) => {
    const cells = cellsPer[i];
    return {
      id: iv.id,
      layerId: 'height',
      name: iv.name,
      cells,
      color: iv.color,
      attributes: {
        kind: 'interval',
        lo: iv.lo,
        hi: iv.hi,
        min: iv.min,
        allowOverlap: true,
      },
      adjacentElementIds: new Set<string>(),
      overlaps: [],
    } satisfies Region;
  });

  // 嵌套重叠：只记 sharedCount，不展开 sharedCells
  for (let i = 0; i < 12; i++) {
    const setA = new Set(els[i].cells);
    for (let j = 0; j < 12; j++) {
      if (i === j) continue;
      let shared = 0;
      for (const c of els[j].cells) if (setA.has(c)) shared++;
      if (shared <= 0) continue;
      els[i].overlaps!.push({
        elementId: els[j].id,
        type: shared === els[i].cells.length && shared === els[j].cells.length ? 'complete' : 'partial',
        sharedCells: [],
        sharedCount: shared,
      });
    }
    // 相邻档
    if (i > 0) els[i].adjacentElementIds!.add(els[i - 1].id);
    if (i < 11) els[i].adjacentElementIds!.add(els[i + 1].id);
  }

  world.regions = world.regions.filter((r) => r.layerId !== 'height').concat(els);
  return els;
}

export function heightIntervalRegions(world: World): Region[] {
  return world.regions.filter((r) => r.layerId === 'height' && r.attributes?.kind === 'interval');
}

/**
 * 增量更新高度区间：只动被改 cell 所属的区间，不全量重扫。
 * 每个区间是嵌套集（h ≥ lo），cell 在 old→new 间迁移时只影响中间几档。
 */
export function updateHeightIntervalElements(
  world: World,
  samples: { id: number; h0: number; h1: number }[],
): void {
  const els = heightIntervalRegions(world);
  if (els.length !== 12) {
    rebuildHeightIntervalElements(world);
    return;
  }
  for (const s of samples) {
    const h0 = Math.round(s.h0);
    const h1 = Math.round(s.h1);
    if (h0 === h1) continue;
    for (let i = 0; i < 12; i++) {
      const lo = HEIGHT_INTERVALS[i].lo;
      const inOld = h0 >= lo;
      const inNew = h1 >= lo;
      if (inOld && !inNew) {
        els[i].cells = els[i].cells.filter((id) => id !== s.id);
      } else if (!inOld && inNew) {
        els[i].cells.push(s.id);
      }
    }
  }
}
