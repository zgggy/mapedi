/**
 * 高度区间元素：固定 12 档，**单真相**（2026-10-06 包 B · 北极星对齐）：
 *
 * - `Region.cells` = **累积**（cell.height ≥ lo ⇒ 属于该档；低档托住所有更高的 cell，
 *   顶峰 ⊂ 高山 ⊂ … ⊂ 深海 = 等高线嵌套）。规则（档映射）在**重算期**跑完落成占据，
 *   渲染/件环只读 cells——原「数据=精确档 / 显示=累积」双真相退役（件环对账补丁随之退役）。
 * - **精确档**（lo ≤ h ≤ hi）= h 与区间表的纯函数，不存第二份：拾取/悬停/计数需要时
 *   **现算**（`exactIntervalElementOf` / `exactCountOfInterval`，heightRev 键控缓存）。
 * - 语义不变（2026-09-30 用户契约：显示=累积，低档托底、隐藏低档不漏底——下档同样
 *   包含该 cell，拼缝露的是下档色）。
 *
 * 不变量：任意时刻 cells = { c | round(c.height) ≥ lo }（rebuild/normalize/update 三路同谓词）。
 * 单源谓词 = `cellInInterval`（h ≥ lo，不看 hi）——改一处必改另两处。
 */
import type { CellId, Region, World } from '../types';
import { heightRev } from '../rev';
import { writeCells } from '../occupy';
import { HEIGHT_INTERVALS, heightToIntervalIndex } from './heightIntervals';

/** cell 是否落在区间元素集内（累积：h ≥ lo，不看 hi） */
export function cellInInterval(h: number, lo: number, _hi: number): boolean {
  return Math.round(h) >= lo;
}

/** 精确档定位：cell 高度落在哪个区间元素（拾取/悬停用；现算，不依赖元素数组序） */
export function exactIntervalElementOf(world: World, cellId: CellId): Region | undefined {
  const cell = world.cells[cellId];
  if (!cell) return undefined;
  const lo = HEIGHT_INTERVALS[heightToIntervalIndex(cell.height)].lo;
  return heightIntervalRegions(world).find((r) => r.attributes?.lo === lo);
}

/** 12 档**精确**计数（heightRev + world 身份键控缓存；检查区显示用——累积长度≠精确档计数） */
let countsWorld: World | null = null;
let countsRev = -1;
let counts: number[] = [];
export function exactHeightBandCounts(world: World): number[] {
  const rev = heightRev();
  if (world !== countsWorld || rev !== countsRev || counts.length !== 12) {
    counts = new Array<number>(12).fill(0);
    for (const c of world.cells) counts[heightToIntervalIndex(c.height)]++;
    countsWorld = world;
    countsRev = rev;
  }
  return counts;
}

/** 区间元素的精确档成员数（非区间型原样返回 cells.length；检查区/校验单入口） */
export function exactCountOfInterval(world: World, region: Region): number {
  const lo = region.attributes?.lo;
  if (region.attributes?.kind !== 'interval' || typeof lo !== 'number') return region.cells.length;
  const idx = HEIGHT_INTERVALS.findIndex((iv) => iv.lo === lo);
  if (idx < 0) return 0;
  return exactHeightBandCounts(world)[idx];
}

/** 幂等：确保高度层 12 档元素存在（缺失=补建；存在=不动）。新世界安装/载入的唯一兜底 */
export function ensureHeightIntervalElements(world: World): void {
  if (heightIntervalRegions(world).length !== 12) rebuildHeightIntervalElements(world);
}

/**
 * 写回 world.regions 的 height 层 12 个区间元素。
 * 不调用 computeRelationships（大重叠只记 count）。
 */
export function rebuildHeightIntervalElements(world: World): Region[] {
  // cells = **累积**（h ≥ lo）——规则跑完落成占据，单真相（2026-10-06 包 B）
  const cellsPer: CellId[][] = HEIGHT_INTERVALS.map(() => []);
  for (const c of world.cells) {
    const h = Math.round(c.height);
    for (let i = 0; i < 12; i++) {
      const iv = HEIGHT_INTERVALS[i];
      if (cellInInterval(h, iv.lo, iv.hi)) cellsPer[i].push(c.id);
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
 * 归一为**累积**（h ≥ lo）：旧档两代遗留（精确档 / 旧档嵌套累积）在此统一——幂等，
 * 成员由高度重导，元素对象/顺序保留。
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
      if (cellInInterval(h, iv.lo, iv.hi)) next[i].push(c.id);
    }
  }
  HEIGHT_INTERVALS.forEach((iv, i) => {
    const el = byLo.get(iv.lo);
    if (!el) return;
    writeCells(el, next[i], 'height');
    // 累积后各档互相嵌套包含（非「重叠」语义）；overlaps 是生成期快照字段，不填
    el.overlaps = [];
    el.name = iv.name; // 名称随表单源（见上）
  });
}

export function heightIntervalRegions(world: World): Region[] {
  return world.regions.filter((r) => r.layerId === 'height' && r.attributes?.kind === 'interval');
}

/**
 * 增量更新高度区间：只动被改 cell 所属的区间，不全量重扫。
 * cells = **累积**（h ≥ lo）单真相落写；返回 Δ（同谓词）供件环就地补丁——
 * 件环缓存内容 = cells = 显示集，二者恒一致（2026-10-06 包 B）。
 */
export interface HeightIntervalDelta {
  layerId: string;
  regionId: string;
  added: number[];
  removed: number[];
}

/**
 * 增量更新区间归属（累积单真相）：
 * - `region.cells`：h ≥ lo 迁移（进入更高档 = 对所有 lo ≤ 新高的档 +1 次迁移）。
 * - 返回 Δ = 同一迁移的 added/removed——件环缓存内容与 cells 同源，用精确档 Δ 打补丁
 *   会与显示集分叉（只改一半的坑）。
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
  // 先按谓词分类（同一 cell 每批只出现一次、记净迁移），后逐档一次经写入器落写
  for (const s of samples) {
    const h0 = Math.round(s.h0);
    const h1 = Math.round(s.h1);
    if (h0 === h1) continue;
    for (let i = 0; i < 12; i++) {
      const iv = HEIGHT_INTERVALS[i];
      const el = byLo.get(iv.lo);
      if (!el) continue;
      const o = outOf(el);
      // 累积谓词：进入 = h1 ≥ lo > h0（此前必不在集内）；离开反之
      const inOld = cellInInterval(h0, iv.lo, iv.hi);
      const inNew = cellInInterval(h1, iv.lo, iv.hi);
      if (inOld === inNew) continue;
      (inNew ? o.added : o.removed).push(s.id);
    }
  }
  for (const el of els) {
    const o = outOf(el);
    if (!o.added.length && !o.removed.length) continue;
    const drop = o.removed.length ? new Set(o.removed) : null;
    const next = drop ? el.cells.filter((id) => !drop.has(id)) : el.cells.slice();
    for (const id of o.added) next.push(id);
    writeCells(el, next, 'height', { delta: { added: o.added, removed: o.removed } });
  }
  return out.filter((d) => d.added.length || d.removed.length);
}
