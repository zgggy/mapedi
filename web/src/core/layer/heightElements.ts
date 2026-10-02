/**
 * 高度区间元素：固定 12 档，**两套真相各司其职**：
 *
 * - **数据**（Region.cells）= 精确档（lo ≤ h ≤ hi，互不相交）：归属真相、拾取、
 *   标签落点、工作区计数。
 * - **显示**（DisplayPiece.cellIds）= **累积**（cell.height ≥ lo ⇒ 显示包含）：
 *   低档托住所有更高的 cell（顶峰 ⊂ 高山 ⊂ … ⊂ 深海 = 等高线嵌套）。隐藏低档
 *   不漏底、拼缝露的是下档色而不是背景——直接档渲染不满足此语义（2026-09-30 用户定）。
 *
 * 单源谓词 = `cellInInterval`（h ≥ lo，不看 hi）；显示派生 = `displayCellsOfInterval`，
 * 件环 Δ 补丁（`updateHeightIntervalElements` 返回值）用同一谓词——改一处必改另一处。
 */
import type { CellId, Region, World } from '../types';
import { HEIGHT_INTERVALS } from './heightIntervals';

/** cell 是否落在区间元素**显示**集内（低区间含高 cell，不看 hi） */
export function cellInInterval(h: number, lo: number, _hi: number): boolean {
  return Math.round(h) >= lo;
}

/**
 * 显示归属（累积）：直接档 ∪ 所有更高的 cell（h ≥ lo）。
 * 非区间元素（无 lo）原样返回 region.cells。
 * 与 `updateHeightIntervalElements` 的 Δ 谓词同一真相。
 */
export function displayCellsOfInterval(world: World, region: Region): CellId[] {
  const lo = region.attributes?.lo;
  if (typeof lo !== 'number') return region.cells;
  const out: CellId[] = [];
  for (const c of world.cells) {
    if (cellInInterval(c.height, lo, Number.POSITIVE_INFINITY)) out.push(c.id);
  }
  return out;
}

/**
 * 写回 world.regions 的 height 层 12 个区间元素。
 * 不调用 computeRelationships（大重叠只记 count）。
 */
export function rebuildHeightIntervalElements(world: World): Region[] {
  // 数据 = **精确档**（lo ≤ h ≤ hi，互不相交）：归属真相不随叠放序变，全图巨件
  // 也不进 region.cells。**显示**侧的累积（h ≥ lo）在 displayCellsOfInterval 派生，
  // 不回写这里（两套真相各司其职，见文件头）。
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
 * 区间本就是派生数据（cells = 高度档位），元素对象/顺序保留，仅重导成员；
 * **名称随表单源**（2026-10-02 用户改「高平原」→「高原」——区间元素是 12 档
 * 结构数据，名称不接受独立定制，载入即与 NAMES 对齐；副作用：若曾手动改过
 * 档名会被表默认值覆盖）。
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
    el.name = iv.name; // 名称随表单源（见文件头注释）
  });
}

export function heightIntervalRegions(world: World): Region[] {
  return world.regions.filter((r) => r.layerId === 'height' && r.attributes?.kind === 'interval');
}

/**
 * 增量更新高度区间：只动被改 cell 所属的区间，不全量重扫。
 * 数据 = **精确档**（lo ≤ h ≤ hi，迁移离开旧档、进入新档）；
 * 返回 Δ = **显示累积集**的增减（见 updateHeightIntervalElements）。
 */
export interface HeightIntervalDelta {
  layerId: string;
  regionId: string;
  added: number[];
  removed: number[];
}

/**
 * 增量更新区间归属（双真相同步维护）：
 * - **数据**（region.cells）：精确档成员迁移（lo ≤ h ≤ hi，互不相交）。
 * - **返回 Δ = 显示累积集增减**（h ≥ lo，与 `displayCellsOfInterval` 同谓词）——
 *   件环缓存的内容是显示集；用精确档 Δ 打补丁会与显示派生分叉（只改一半的坑）。
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
      const el = byLo.get(iv.lo);
      if (!el) continue;
      const o = outOf(el);
      // 数据真相：精确档迁移
      const inOld = h0 >= iv.lo && h0 <= iv.hi;
      const inNew = h1 >= iv.lo && h1 <= iv.hi;
      if (inOld && !inNew) el.cells = el.cells.filter((id) => id !== s.id);
      else if (!inOld && inNew) el.cells.push(s.id);
      // 显示真相：累积 h ≥ lo（件环 Δ 补丁与显示派生同一谓词）
      const cOld = cellInInterval(h0, iv.lo, iv.hi);
      const cNew = cellInInterval(h1, iv.lo, iv.hi);
      if (cOld && !cNew) o.removed.push(s.id);
      else if (!cOld && cNew) o.added.push(s.id);
    }
  }
  return out.filter((d) => d.added.length || d.removed.length);
}
