/**
 * 元素边界边集的**增量维护**（二期：笔刷实时生效核心）。
 *
 * 失效纪律（与 borderCache 的键约定配对）：
 * - `region.cells` 的变化要么走 `invalidateBorderCache()`（全量），要么走本模块（增量补丁），
 *   **二者互斥且必居其一**——否则环缓存与归属真相分叉。
 * - 补丁路径下环缓存键不含内容指纹（O(n) 指纹是热路径反模式，见 AGENTS.md §8/9）：
 *   件身份 = setKey（`piece:${dp.key}`）+ 投影 + geomRev；内容由本模块就地维护。
 *
 * 复杂度：成员变化 Δ → 翻转 Δ 的关联边 O(|Δ|·deg)；链化仍走 `edgeListToRings`（O(边界)）；
 * 环恒等匹配让未变环复用旧对象（hermite/三角化缓存命中，只重建受牵连的环）。
 */
import type { CellId } from '../types';
import type { World } from '../types';
import type { LonLat } from '../../render/space';
import type { Pt } from '../../render/space';
import type { BoundEdge } from './build';
import type { MidRing } from './displayRing';
import { edgeListToRings, orientMemberLeft } from './build';

/** cell → 关联边（含 pair 表里的伪边/极区补边）；世界拓扑变化时重建 */
export type IncidentEdges = Map<CellId, BoundEdge[]>;

export function buildIncidentEdges(
  world: World,
  pair: Map<string, BoundEdge>,
): IncidentEdges {
  void world;
  const inc: IncidentEdges = new Map();
  for (const e of pair.values()) {
    const dash = e.ek.indexOf('-');
    if (dash < 0) continue;
    const i = +e.ek.slice(0, dash);
    const j = +e.ek.slice(dash + 1);
    let a = inc.get(i);
    if (!a) { a = []; inc.set(i, a); }
    a.push(e);
    if (j !== i) {
      let b = inc.get(j);
      if (!b) { b = []; inc.set(j, b); }
      b.push(e);
    }
  }
  return inc;
}

export interface BoundaryBook {
  /** 成员集（与 Region.cells 同源同步；补丁调用前必须已是新归属） */
  set: Set<CellId>;
  /** 当前边界边（ek → 边；与 cellSetBoundaryEdges 同一引用） */
  edges: Map<string, BoundEdge>;
}

/** 一次 O(n) 播种（首个 tick 付；其后全增量） */
export function seedBoundaryBook(
  world: World,
  set: Set<CellId>,
  pair: Map<string, BoundEdge>,
): BoundaryBook {
  const edges = new Map<string, BoundEdge>();
  // 与 cellSetBoundaryEdges 同语义：成员两侧不一致的边（含 pair 伪边），
  // 且必须**定向**（成员在左）——链化只走有向出边，未定向的边会死链。
  for (const [ek, e] of pair) {
    const dash = ek.indexOf('-');
    if (dash < 0) continue;
    const i = +ek.slice(0, dash);
    const j = +ek.slice(dash + 1);
    if (set.has(i) !== set.has(j)) edges.set(ek, orientMemberLeft(world, set, e));
  }
  return { set, edges };
}

/**
 * 增量补丁：`changed` = 本轮归属变化的 cell（已按 book.set 的**新**状态）。
 * 只翻转 changed 的关联边；返回是否发生翻转（无翻转 → 下游无需重建）。
 */
export function patchBoundaryBook(
  world: World,
  book: BoundaryBook,
  incident: IncidentEdges,
  changed: CellId[],
): boolean {
  let flipped = false;
  for (const c of changed) {
    const list = incident.get(c);
    if (!list) continue;
    for (const e of list) {
      const dash = e.ek.indexOf('-');
      if (dash < 0) continue;
      const i = +e.ek.slice(0, dash);
      const j = +e.ek.slice(dash + 1);
      const want = book.set.has(i) !== book.set.has(j);
      const has = book.edges.has(e.ek);
      if (want) {
        // 重定向副本：新增边要定；**已存在但成员侧翻转**的边也要重定（cell 进/出
        // 集合时 ek 不变、方向必须跟着翻）。pa/pb 是 pair 缓存的稳定 LonLat 引用，
        // 引用比较即可判定方向变化——变了才置 flipped（否则每次补丁都全量重链）。
        const o = orientMemberLeft(world, book.set, e);
        const cur = book.edges.get(e.ek);
        if (!cur || cur.pa !== o.pa || cur.pb !== o.pb) {
          book.edges.set(e.ek, o);
          flipped = true;
        }
      } else if (has) {
        book.edges.delete(e.ek);
        flipped = true;
      }
    }
  }
  return flipped;
}

/** 环内容键：首点+长度+闭合/尾巴（恒等匹配用；环重链后内容相同 → 复用旧对象） */
function ringMatchKey(r: MidRing): string {
  const n = r.pts.length;
  const a = r.pts[0];
  return `${n}|${r.closed ? 1 : 0}|${r.virtualFrom ?? -1}|${a ? `${a.x},${a.y}` : ''}`;
}

/**
 * 由边集链化成环；与 `prev` 做恒等匹配——内容未变的环复用旧对象，
 * 让下游缓存（hermite 采样 / 三角化）命中，只重建受牵连的环。
 */
export function ringsFromBook(
  book: BoundaryBook,
  world: World,
  project: (ll: LonLat) => Pt,
  period: number,
  prev?: MidRing[],
): MidRing[] {
  const rings = edgeListToRings([...book.edges.values()], project, period);
  if (!prev?.length) return rings;
  const byKey = new Map<string, MidRing>();
  for (const r of prev) {
    const k = ringMatchKey(r);
    if (!byKey.has(k)) byKey.set(k, r);
  }
  return rings.map((r) => byKey.get(ringMatchKey(r)) ?? r);
}
