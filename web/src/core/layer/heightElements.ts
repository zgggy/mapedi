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
  // **精确档**（lo ≤ h ≤ hi，互不相交）：区间可见色 = 该档色，与行叠放顺序无关；
  // 嵌套累积（h≥lo）会让可见色取决于叠放序且产生全图巨件，已废。
  const cellsPer: CellId[][] = HEIGHT_INTERVALS.map(() => []);
  for (const c of world.cells) {
    const h = Math.round(c.height);
    for (let i = 0; i < 12; i++) {
      const iv = HEIGHT_INTERVALS[i];
      if (h >= iv.lo && h <= iv.hi) cellsPer[i].push(c.id);
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
      },
      adjacentElementIds: new Set<string>(),
      overlaps: [],
    } satisfies Region;
  });

  // 精确档互不相交 → 无重叠；只记相邻档
  for (let i = 0; i < 12; i++) {
    if (i > 0) els[i].adjacentElementIds!.add(els[i - 1].id);
    if (i < 11) els[i].adjacentElementIds!.add(els[i + 1].id);
  }

  world.regions = world.regions.filter((r) => r.layerId !== 'height').concat(els);
  return els;
}

/**
 * 归一到**精确档**（lo ≤ h ≤ hi）：旧档嵌套累积（h≥lo）的遗留成员在此纠正。
 * 区间本就是派生数据（cells = 高度档位），元素对象/命名/顺序保留，仅重导成员。
 */
export function normalizeHeightIntervalElements(world: World): void {
  const els = heightIntervalRegions(world);
  if (els.length !== 12) {
    rebuildHeightIntervalElements(world);
    return;
  }
  const byLo = new Map<number, Region>();
  for (const r of els) {
    const lo = r.attributes?.lo;
    if (typeof lo === 'number') byLo.set(lo, r);
  }
  const next: CellId[][] = HEIGHT_INTERVALS.map(() => []);
  for (const c of world.cells) {
    const h = Math.round(c.height);
    for (let i = 0; i < 12; i++) {
      const iv = HEIGHT_INTERVALS[i];
      if (h >= iv.lo && h <= iv.hi) {
        next[i].push(c.id);
        break;
      }
    }
  }
  HEIGHT_INTERVALS.forEach((iv, i) => {
    const el = byLo.get(iv.lo);
    if (!el) return;
    el.cells = next[i];
    el.overlaps = []; // 精确档互不相交
  });
}

export function heightIntervalRegions(world: World): Region[] {
  return world.regions.filter((r) => r.layerId === 'height' && r.attributes?.kind === 'interval');
}

/**
 * 增量更新高度区间：只动被改 cell 所属的区间，不全量重扫。
 * 每个区间是**精确档**（lo ≤ h ≤ hi）；cell 在 old→new 间迁移时离开旧档、进入新档。
 */
export interface HeightIntervalDelta {
  layerId: string;
  regionId: string;
  added: number[];
  removed: number[];
}

/**
 * 增量更新区间归属；返回每区增减（二期：供件环补丁）。
 * h0 = 上次区间更新后的高度（调用方维护基线），h1 = 当前高度——多次触碰同一 cell 必须
 * 用「上次基线→当前」的净差，否则来回涂改会漏归属。
 */
export function updateHeightIntervalElements(
  world: World,
  samples: { id: number; h0: number; h1: number }[],
): HeightIntervalDelta[] {
  const els = heightIntervalRegions(world);
  if (els.length !== 12) {
    rebuildHeightIntervalElements(world);
    return [];
  }
  // 按区间 lo 匹配元素（不依赖数组顺序：用户可拖动改变叠放顺序）
  const byLo = new Map<number, Region>();
  for (const r of els) {
    const lo = r.attributes?.lo;
    if (typeof lo === 'number') byLo.set(lo, r);
  }
  const out: HeightIntervalDelta[] = els.map((r) => ({ layerId: r.layerId, regionId: r.id, added: [], removed: [] }));
  const outOf = (r: Region) => out[els.indexOf(r)];
  for (const s of samples) {
    const h0 = Math.round(s.h0);
    const h1 = Math.round(s.h1);
    if (h0 === h1) continue;
    for (let i = 0; i < 12; i++) {
      const iv = HEIGHT_INTERVALS[i];
      const inOld = h0 >= iv.lo && h0 <= iv.hi;
      const inNew = h1 >= iv.lo && h1 <= iv.hi;
      const el = byLo.get(iv.lo);
      if (!el) continue;
      const o = outOf(el);
      if (inOld && !inNew) {
        el.cells = el.cells.filter((id) => id !== s.id);
        o.removed.push(s.id);
      } else if (!inOld && inNew) {
        el.cells.push(s.id);
        o.added.push(s.id);
      }
    }
  }
  return out.filter((d) => d.added.length || d.removed.length);
}
