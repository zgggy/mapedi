/**
 * cell 集边界环缓存。
 * 键 = cellIds 指纹 + 投影 + **dataRev()**（O(1) 失效，不扫全图）。
 */
import type { World, CellId } from '../core/types';
import {
  cellSetBoundaryEdges,
  cellSetBoundaryRings,
  indexEdgesByPair,
  type BoundEdge,
} from '../core/ring/build';
import type { MidRing } from '../core/ring/displayRing';
import { frameRect, frameYEnv, type Pt, type LonLat } from '../render/space';
import { prepareDisplayRings } from '../core/ring/normalize';
import { sampleMidRing } from '../core/ring/hermite';
import type { ProjCache } from './projCache';
import { dataRev, geomRev } from '../core/rev';
import {
  projectionPeriodAt,
  projectionWraps,
  projectionXScale,
  type ProjectionId,
} from '../core/project/projections';
import {
  buildIncidentEdges,
  patchBoundaryBook,
  ringsFromBook,
  type BoundaryBook,
  type IncidentEdges,
} from '../core/ring/incremental';
import { pseudoEdgeList } from '../core/ring/build';

export type Ring = MidRing;

export type Entry = {
  rings: Ring[];
  fullWorld: boolean;
  /** 奇偶填充需补「框矩形外环」才能覆盖成员（见 computeFrameFlip） */
  frameFlip: boolean;
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
  /** 增量维护载体（二期：笔刷实时生效）；补丁路径就地更新 set/edges/rings */
  book?: BoundaryBook;
};

let ringsCache = new Map<string, Entry>();
let pairEdgeCache: Map<string, BoundEdge> | null = null;
let pseudoEdgeCache: BoundEdge[] | null = null;
let pairEdgeGeomRev = -1;
let baseRev = '';
let cachedWorld: World | null = null;

/** 件环条目是否已就绪（渐现：冷件先跳过，由空闲预热补） */
export function hasPieceEntry(setKey: string, projKey: ProjectionId): boolean {
  return ringsCache.has(ringCacheKey(setKey, projKey));
}

/** 按 setKey 前缀失效（定向清一类件，避免全清的松手卡顿） */
export function invalidatePieceEntries(prefix: string): void {
  for (const k of ringsCache.keys()) {
    if (k.startsWith(prefix)) ringsCache.delete(k);
  }
}

export function invalidateBorderCache(): void {
  ringsCache = new Map();
  pairEdgeCache = null;
  pseudoEdgeCache = null;
  pairEdgeGeomRev = -1;
  baseRev = '';
  cachedWorld = null;
}



/** 关联边索引（cell → 边）；与 pairEdgeCache 同代构建 */
let incidentCache: IncidentEdges | null = null;

/**
 * 增量补丁（二期）：成员变化后**就地**更新件的边集/环。
 * O(|Δ|·deg + 受牵连环链化)；未变环复用旧对象（下游 hermite/三角化缓存命中）。
 * 调用约定：`set` 已是新归属；未缓存的件无需补丁（下次常规构建）。
 */
export function patchPieceEntry(
  world: World,
  setKey: string,
  projKey: ProjectionId,
  project: (ll: LonLat) => Pt,
  added: CellId[],
  removed: CellId[],
): boolean {
  const key = ringCacheKey(setKey, projKey);
  const entry = ringsCache.get(key);
  if (!entry?.book) return false;
  if (!pairEdgeCache) {
    pairEdgeCache = indexEdgesByPair(world);
    pseudoEdgeCache = pseudoEdgeList(world, pairEdgeCache);
    incidentCache = null;
  }
  if (!incidentCache) incidentCache = buildIncidentEdges(world, pairEdgeCache);
  const b = entry.book;
  for (const id of added) b.set.add(id);
  for (const id of removed) b.set.delete(id);
  const changed = [...added, ...removed];
  if (!changed.length || !patchBoundaryBook(world, b, incidentCache, changed)) return false;
  entry.rings = ringsFromBook(
    entry.book,
    world,
    project,
    (y) => projectionPeriodAt(projKey, y) ?? Math.PI * 2,
    entry.rings,
  );
  entry.fullWorld = world.cells.length > 0 && b.set.size === world.cells.length;
  entry.frameFlip = computeFrameFlip(world, b.set, [...b.set], entry.rings, project, projKey);
  entry.bbox = ringBBox(entry.rings);
  return true;
}

function ensureRev(world: World): string {
  const rev = dataRev();
  // 环缓存按内容指纹命中，这里不清（见 ringCacheKey）
  if (rev !== baseRev) {
    baseRev = rev;
    cachedWorld = world;
  }
  // pairEdgeCache 是纯几何边表：只随几何域失效，不随 height/regions rev 清空
  const g = geomRev();
  if (!pairEdgeCache || pairEdgeGeomRev !== g) {
    pairEdgeCache = null;
    pairEdgeGeomRev = g;
  }
  return rev;
}

/** 键 = 调用方提示 + 内容指纹（长度/和/FNV）+ 几何域：
 *  不含 dataRev——未变化的 cell 集跨修订号命中（提交只重链变化的元素）；
 *  几何域变（重生/导入）则全部重链。 */
/**
 * 环缓存键：setKey（`piece:${dp.key}`）+ 投影 + geomRev。
 * **不含内容指纹**（O(n) 指纹是热路径反模式，AGENTS.md §8/9）。
 * 不变量：`region.cells` 变化要么走 `invalidateBorderCache()`（全量），
 * 要么走 `patchPieceEntry()`（增量补丁）——二者互斥且必居其一。
 */
function ringCacheKey(setKey: string, projKey: string): string {
  return `${setKey}|${projKey}|${geomRev()}`;
}

export function getCellSetRingsCached(
  world: World,
  cellIds: CellId[],
  project: (ll: { lon: number; lat: number }) => Pt,
  projKey: ProjectionId,
  setKey: string,
): Entry {
  ensureRev(world);
  const key = ringCacheKey(setKey, projKey);
  const hit = ringsCache.get(key);
  if (hit) return hit;
  // 有界增长：按插入序淘汰最旧（变化元素每修订只新增少量条目）
  if (ringsCache.size > 2048) {
    for (const k of ringsCache.keys()) {
      ringsCache.delete(k);
      if (ringsCache.size <= 1024) break;
    }
  }
  if (!pairEdgeCache) {
    pairEdgeCache = indexEdgesByPair(world);
    pseudoEdgeCache = pseudoEdgeList(world, pairEdgeCache);
  }
  const set = cellIds instanceof Set ? cellIds : new Set(cellIds);
  const edges = cellSetBoundaryEdges(world, set, pairEdgeCache, pseudoEdgeCache ?? undefined);
  const rings = cellSetBoundaryRings(
    world, set, project, edges, (y) => projectionPeriodAt(projKey, y) ?? Math.PI * 2,
  );
  seamWrapVote(world, set, rings, project, projKey);
  const entry: Entry = {
    rings,
    fullWorld: world.cells.length > 0 && set.size === world.cells.length,
    frameFlip: computeFrameFlip(world, set, cellIds, rings, project, projKey),
    bbox: ringBBox(rings),
    // 增量载体：边集/成员集在建缓存时零成本播种；补丁路径就地维护
    book: {
      set,
      edges: new Map(edges.map((e) => [e.ek, e])),
    },
  };
  ringsCache.set(key, entry);
  return entry;
}

/**
 * evenodd 奇偶：点被环集包住当且仅当穿越数为奇。
 *
 * **必须与实绘同一套副本语义**（跨副本 evenodd XOR——#82474 #4870 #88313
 * 海洋/过大大陆整件内外反的根因：单窗 raycast 与实绘实例化 XOR 相反 → flip 判反）：
 * 副本位移 = scale(y)·k·2π 是**每顶点 y 依赖**的重映射（伪圆柱周期随纬度内收），
 * 点平移等价只在刚性平移下成立 → 逐段平移两端点做 raycast；
 * 圆柱族 scale 常数时退化为刚性平移 = 原行为。
 */
function ringParity(
  rings: Ring[],
  x: number,
  y: number,
  copies = true,
  scaleAt: (y: number) => number = () => 1,
): boolean {
  let cross = 0;
  for (const k of copies ? [-1, 0, 1] : [0]) {
    const off = k * (Math.PI * 2);
    for (const ring of rings) {
      const pts = ring.pts;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const a = pts[j];
        const b = pts[i];
        if ((a.y > y) !== (b.y > y)) {
          const ax = a.x + scaleAt(a.y) * off;
          const bx = b.x + scaleAt(b.y) * off;
          const t = (y - a.y) / (b.y - a.y);
          if (x < ax + t * (bx - ax)) cross++;
        }
      }
    }
  }
  return (cross & 1) === 1;
}

/**
 * 奇偶探针（**多数表决**）：在大量成员/非成员采样点上比较「plain / flip」两种解释的吻合率，
 * 取高者（≥0.75 且领先 ≥0.1 才算确定）。
 *
 * 为什么不用单点探针：显示环过**边中点**（契约），比 cell 并集略内缩——边界 cell 的
 * 中心会落在环外，单点探针一票否决两种解释（返回 false → 整件内外翻转）。
 * 多数表决把边界噪声平均掉；对「整件翻转」这类结构性问题一锤定音。
 *
 * 环必须探**闭合后**的显示环（与绘制同一条补边）；不变量：成员 ≡ XOR(闭合环) ⊕ flip。
 */
function computeFrameFlip(
  world: World,
  set: Set<CellId>,
  cellIds: CellId[],
  rings: Ring[],
  project: (ll: { lon: number; lat: number }) => Pt,
  projKey: ProjectionId,
): boolean {
  const n = world.cells.length;
  if (!n) return false;
  // 补边 frameY 与绘制同源（frameYEnv）；ringParity 的副本开关 = draw 是否有副本
  const frameY = frameYEnv(project, projKey);
  // 实绘有副本 ⟺ 投影支持回绕（含罗宾森）；探针副本语义必须与实绘一致
  const copies = projectionWraps(projKey);
  const scaleAt = (y: number) => projectionXScale(projKey, y) ?? 1;
  const closed: Ring[] = [];
  for (const r of rings) {
    for (const d of prepareDisplayRings(r, frameY)) closed.push(d);
  }
  // 探针用**采样后**的折线（与绘制同一形状）：中点折线在尖角处切角/自交，
  // 与真实填充区域有系统性偏差——那正是单点探针被边界点一票否决的来源。
  const sampled: Ring[] = closed.map((d) => ({ pts: sampleMidRing(d, 1, 'fill'), verts: [], closed: true }));
  let plain = 0;
  let flip = 0;
  const VOTES = 64;
  const mStride = Math.max(1, Math.floor(cellIds.length / VOTES));
  for (let i = 0, seen = 0; i < cellIds.length && seen < VOTES; i += mStride, seen++) {
    const c = world.cells[cellIds[i]];
    if (!c) continue;
    const p = project(c.center);
    if (ringParity(sampled, p.x, p.y, copies, scaleAt)) plain++;
    else flip++;
  }
  if (set.size < n) {
    // 非成员按全局步进采样（不要只取 id 序前几个——会偏向单一半球）
    const stride = Math.max(1, Math.floor(n / (VOTES * 6)));
    for (let i = 0, seen = 0; i < n && seen < VOTES; i += stride) {
      if (set.has(i)) continue;
      const c = world.cells[i];
      if (!c) continue;
      const p = project(c.center);
      if (ringParity(sampled, p.x, p.y, copies, scaleAt)) flip++;
      else plain++;
      seen++;
    }
  }
  const tot = plain + flip;
  if (!tot) return false;
  const rate = flip / tot;
  return rate >= 0.75 && rate - plain / tot >= 0.1;
}

/**
 * 缝环闭合表决（单一裁决口径 = 成员奇偶真值）。
 *
 * 背景：x 空间 winding 对「自然闭合的绕行环」恒 ±1——环绕经度一周，unwrap 合法
 * 累计一个周期，链本身完整（首尾=同一物理顶点）。closeRingForCylindrical 无法凭
 * winding 区分「自然闭合」与「框缝分裂」，一律补边；而补边经线取链起点的任意经度，
 * 会切入环内部领土（南北向海峡条带奇偶被两条经线段翻转 → 填充缺失，用户可见缝隙）。
 *
 * 裁决：对绕行环构造两种闭合解释（补边 = 现行为 / 自然 = 不补边），在补边纬度带内
 * 采样成员+非成员格心，用 ringParity（与绘制同副本语义）比吻合率；自然解释明显
 * 更吻合（rate≥0.75 且领先≥0.05）才改判，否则保持现行为（不回归）。
 * 与 computeFrameFlip 的 flip 表决同一族：几何猜不准的语义，用成员真值定夺。
 */
function seamWrapVote(
  world: World,
  set: Set<CellId>,
  rings: MidRing[],
  project: (ll: LonLat) => Pt,
  projKey: ProjectionId,
): void {
  if (!projectionWraps(projKey)) return;
  const periodAt = (y: number) => projectionPeriodAt(projKey, y) ?? Math.PI * 2;
  const scaleAt = (y: number) => projectionXScale(projKey, y) ?? 1;
  const wrap: number[] = [];
  rings.forEach((r, i) => {
    if (!r.closed || r.pts.length < 3) return;
    const pp = periodAt(r.pts[0].y);
    if (Math.round((r.pts[r.pts.length - 1].x - r.pts[0].x) / pp) === 0) return;
    wrap.push(i);
  });
  if (!wrap.length) return;
  const frameY = frameYEnv(project, projKey);
  // 采样限制在补边纬度带（p0.y ↔ edgeY）——带外格心在两种解释下奇偶相同，无表决信息
  const band: { p: Pt; m: boolean }[] = [];
  const stride = Math.max(1, Math.floor(world.cells.length / 2400));
  for (let i = 0; i < world.cells.length && band.length < 1200; i += stride) {
    const c = world.cells[i];
    if (!c?.center) continue;
    const p = project(c.center);
    for (const ri of wrap) {
      const rp = rings[ri].pts;
      const y0 = rp[0].y;
      const edgeY = Math.round((rp[rp.length - 1].x - rp[0].x) / periodAt(y0)) > 0
        ? frameY.maxY
        : frameY.minY;
      if (p.y > Math.min(y0, edgeY) && p.y < Math.max(y0, edgeY)) {
        band.push({ p, m: set.has(c.id) });
        break;
      }
    }
  }
  if (band.length < 50) return;
  const capRings: Ring[] = [];
  const natRings: Ring[] = [];
  rings.forEach((r, i) => {
    if (!r.closed || r.pts.length < 3) return;
    if (wrap.includes(i)) {
      for (const d of prepareDisplayRings(r, frameY)) capRings.push({ pts: sampleMidRing(d, 1, 'fill'), verts: [], closed: true });
      natRings.push({ pts: sampleMidRing(r, 1, 'fill'), verts: [], closed: true });
    } else {
      for (const d of prepareDisplayRings(r, frameY)) {
        const sampled = { pts: sampleMidRing(d, 1, 'fill'), verts: [], closed: true };
        capRings.push(sampled);
        natRings.push(sampled);
      }
    }
  });
  let aNat = 0;
  let aCap = 0;
  for (const s of band) {
    if (ringParity(natRings, s.p.x, s.p.y, true, scaleAt) === s.m) aNat++;
    if (ringParity(capRings, s.p.x, s.p.y, true, scaleAt) === s.m) aCap++;
  }
  const tot = aNat + aCap;
  if (!tot) return;
  const rNat = aNat / tot;
  const rCap = aCap / tot;
  // 注意：两种闭合解释在补边纬度带内**精确互补**（excursion 把带内 parity 整体翻转，
  // rNat + rCap = 1）——不能用 flip 表决的 0.75 吻合率门槛（那要求自然解释近乎完美，
  // 实测 h3 rNat≈0.6 被错误否决）。这里只问「哪种解释与成员真值吻合更多」：
  // 多数 + 足够领先（≥0.05）即改判；不明显 → 保持现行为。
  if (rNat > rCap && rNat - rCap >= 0.05) {
    for (const i of wrap) rings[i].seamNoCap = true;
  }
}

function ringBBox(rings: Ring[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const p of r.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

export function ringBBoxHitsView(
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  viewL: number,
  viewR: number,
  viewT: number,
  viewB: number,
  pad = 0.2,
): boolean {
  return !(
    bbox.maxX + pad < viewL ||
    bbox.minX - pad > viewR ||
    bbox.maxY + pad < viewB ||
    bbox.minY - pad > viewT
  );
}

