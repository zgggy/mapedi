/**
 * 边界环构建（**唯一归属 = CellId 集合**）。
 *
 * 没有 owner 概念：Region / DisplayPiece / 海岸 都是 `cellIds` 的边界。
 * 顶点拓扑只来自 `world.sharedEdges`（由 cell.polygon 导出）。
 */
import type { CellId, LonLat, World } from '../types';
import { unwrapXAgainst, wrapPeriod, type Pt } from '../../render/space';
import { alignVerts, type MidRing } from './displayRing';

export type BoundEdge = {
  ek: string;
  pa: LonLat;
  pb: LonLat;
};

function wkey(x: number, y: number, period: number): string {
  let wx = wrapPeriod(x, period);
  if (Math.abs(wx) >= period / 2 - 1e-5) wx = period / 2;
  return `${Math.round(wx * 1e6)},${Math.round(y * 1e6)}`;
}

/**
 * 顶点拓扑键（**全局唯一约定**）：0.001° 网格 + ±180 缝归一。
 * 25k 时 cell 边长 ~1°，0.001° 足够细又吸收浮点/对偶误差。
 */
export function lonlatKey(ll: LonLat): string {
  let lon = ll.lon;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  if (Math.abs(lon) >= 180 - 1e-3) lon = 180;
  return `${Math.round(lon * 1000)},${Math.round(ll.lat * 1000)}`;
}

/** lonlatKey 的数值版（**同分桶**：同一 0.001° 网格 + ±180 缝归一）——热路径用，免字符串 */
export function lonlatNumKey(ll: LonLat): number {
  let lon = ll.lon;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  if (Math.abs(lon) >= 180 - 1e-3) lon = 180;
  return (Math.round(lon * 1000) + 180000) * 360001 + (Math.round(ll.lat * 1000) + 90000);
}

export function edgeMidpoint(p0: Pt, p1: Pt, period = Math.PI * 2): Pt {
  const b = { x: unwrapXAgainst(p0.x, p1.x, period), y: p1.y };
  return { x: (p0.x + b.x) / 2, y: (p0.y + b.y) / 2 };
}

function sphericalEdgeMidpoint(pa: LonLat, pb: LonLat): LonLat {
  const unit = (p: LonLat) => {
    const lon = p.lon * Math.PI / 180;
    const lat = p.lat * Math.PI / 180;
    return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)];
  };
  const a = unit(pa);
  const b = unit(pb);
  const x = a[0] + b[0];
  const y = a[1] + b[1];
  const z = a[2] + b[2];
  const r = Math.hypot(x, y, z);
  if (r < 1e-10) return { lon: pa.lon, lat: pa.lat };
  return { lon: Math.atan2(y, x) * 180 / Math.PI, lat: Math.atan2(z, Math.hypot(x, y)) * 180 / Math.PI };
}

export function indexEdgesByPair(world: World): Map<string, BoundEdge> {
  const map = new Map<string, BoundEdge>();
  if (!world.sharedEdges?.size) return map;
  for (const [ek, [pa, pb]] of world.sharedEdges) {
    map.set(ek, { ek, pa, pb });
  }
  return map;
}

/** 集合边界边：恰好一端在 cellSet 内 */
/**
 * 不在任何 cell.neighbors 表里的边（极区补边/框边等）——只随 pairEdgeCache 构建一次。
 * 命中：cellSetBoundaryEdges 的第二循环只扫这张小表，不再 O(全部边) 解析 ek。
 */
export function pseudoEdgeList(
  world: World,
  pair: Map<string, BoundEdge>,
): BoundEdge[] {
  const seen = new Set<string>();
  for (const cell of world.cells) {
    for (const n of cell.neighbors) {
      const ek = cell.id < n ? `${cell.id}-${n}` : `${n}-${cell.id}`;
      seen.add(ek);
    }
  }
  const out: BoundEdge[] = [];
  for (const [ek, e] of pair) {
    if (!seen.has(ek)) out.push(e);
  }
  return out;
}

export function cellSetBoundaryEdges(
  world: World,
  cellIds: Iterable<CellId> | Set<CellId>,
  edgeByPair?: Map<string, BoundEdge>,
  pseudo?: BoundEdge[],
): BoundEdge[] {
  const set = cellIds instanceof Set ? cellIds : new Set(cellIds);
  const out: BoundEdge[] = [];
  if (!set.size) return out;
  const pair = edgeByPair ?? indexEdgesByPair(world);
  const seen = new Set<string>();
  const push = (e: BoundEdge) => {
    if (seen.has(e.ek)) return;
    seen.add(e.ek);
    out.push(e);
  };
  for (const id of set) {
    const cell = world.cells[id];
    if (!cell) continue;
    for (const n of cell.neighbors) {
      if (set.has(n)) continue;
      const ek = id < n ? `${id}-${n}` : `${n}-${id}`;
      const e = pair.get(ek);
      if (e) push(e);
    }
  }
  // 伪边（极区补边等）：小表直扫；缺省则退回全 pair 扫（正确优先）
  if (pseudo) {
    for (const e of pseudo) {
      const dash = e.ek.indexOf('-');
      if (dash < 0) continue;
      const i = +e.ek.slice(0, dash);
      const j = +e.ek.slice(dash + 1);
      if (set.has(i) !== set.has(j)) push(e);
    }
  } else {
    for (const [ek, e] of pair) {
      const dash = ek.indexOf('-');
      if (dash < 0) continue;
      const i = +ek.slice(0, dash);
      const j = +ek.slice(dash + 1);
      if (set.has(i) !== set.has(j)) push(e);
    }
  }
  return out;
}

/**
 * 边段 → 中点环。顶点身份优先 LonLat 键（±180 缝已归一）。
 */
export function chainEdgesToMidpointRings(
  edgeSrc: { p0: Pt; p1: Pt; midpoint?: Pt; k0?: string; k1?: string }[],
  period = Math.PI * 2,
): MidRing[] {
  if (!edgeSrc.length) return [];
  type E = { k0: string; k1: string; p0: Pt; p1: Pt; midpoint?: Pt };
  const edges: E[] = [];
  for (const { p0, p1, midpoint, k0, k1 } of edgeSrc) {
    if (!p0 || !p1) continue;
    const p0w = { x: wrapPeriod(p0.x, period), y: p0.y };
    const p1u = { x: unwrapXAgainst(p0w.x, p1.x, period), y: p1.y };
    edges.push({
      k0: k0 ?? wkey(p0.x, p0.y, period),
      k1: k1 ?? wkey(p1.x, p1.y, period),
      p0: p0w,
      p1: p1u,
      midpoint,
    });
  }
  const rep = new Map<string, Pt>();
  const adj = new Map<string, string[]>();
  const edgeBetween = new Map<string, number[]>();
  const ekey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  edges.forEach((e, idx) => {
    if (!rep.has(e.k0)) rep.set(e.k0, e.p0);
    if (!rep.has(e.k1)) rep.set(e.k1, { x: wrapPeriod(e.p1.x, period), y: e.p1.y });
    const add = (from: string, to: string) => {
      let l = adj.get(from);
      if (!l) {
        l = [];
        adj.set(from, l);
      }
      if (!l.includes(to)) l.push(to);
    };
    add(e.k0, e.k1);
    add(e.k1, e.k0);
    const ek = ekey(e.k0, e.k1);
    let el = edgeBetween.get(ek);
    if (!el) {
      el = [];
      edgeBetween.set(ek, el);
    }
    el.push(idx);
  });

  const usedE = new Array(edges.length).fill(false);
  const rings: MidRing[] = [];

  const walkFrom = (startEdge: number): MidRing[] => {
    const e0 = edges[startEdge];
    usedE[startEdge] = true;
    const startK = e0.k0;
    const chainEdges: number[] = [startEdge];
    const chainKeys: string[] = [startK, e0.k1];
    let curK = e0.k1;
    let prevK = startK;

    for (let guard = 0; guard < edges.length + 8; guard++) {
      if (curK === startK) break;
      const nbs = adj.get(curK) ?? [];
      let nextK: string | null = null;
      let nextEi = -1;
      for (const nk of nbs) {
        if (nk === prevK && nbs.length > 1) continue;
        const eis = edgeBetween.get(ekey(curK, nk)) ?? [];
        const free = eis.find((i) => !usedE[i]);
        if (free === undefined) continue;
        nextK = nk;
        nextEi = free;
        break;
      }
      if (!nextK || nextEi < 0) {
        for (const nk of nbs) {
          const eis = edgeBetween.get(ekey(curK, nk)) ?? [];
          const free = eis.find((i) => !usedE[i]);
          if (free !== undefined) {
            nextK = nk;
            nextEi = free;
            break;
          }
        }
      }
      if (!nextK || nextEi < 0) break;
      usedE[nextEi] = true;
      chainEdges.push(nextEi);
      prevK = curK;
      curK = nextK;
      chainKeys.push(curK);
      if (curK === startK) break;
    }

    // **在重复顶点处拆环**：8 字结/顶点接触会让链自交——自交环的三角化会吐出
    // 「错乱三角形」（earcut 在自交环上给出环外三角）。拆成简单子环后一切路径
    // （逐环三角组/整件剖分/扇形）都成立。
    const rings: MidRing[] = [];
    const buildRing = (from: number, to: number, keyFrom: number, keyTo: number, closed: boolean): MidRing | null => {
      const nE = to - from;
      if (nE < 2) return null;
      const pts: Pt[] = [];
      let prevX: number | null = null;
      for (let i = from; i < to; i++) {
        const e = edges[chainEdges[i]];
        const m = e.midpoint ?? edgeMidpoint(e.p0, e.p1, period);
        const mm = prevX === null ? m : { x: unwrapXAgainst(prevX, m.x, period), y: m.y };
        pts.push(mm);
        prevX = mm.x;
      }
      const keys = chainKeys.slice(keyFrom, keyTo + 1);
      const nV = closed ? nE : nE - 1;
      const rawVerts: Pt[] = [];
      for (let i = 0; i < nV; i++) {
        const a = pts[i];
        const b = pts[i + 1] ?? (closed ? { x: unwrapXAgainst(a.x, pts[0].x, period), y: pts[0].y } : pts[i]);
        const vk = keys[(i + 1) % keys.length];
        const v = vk ? rep.get(vk) : undefined;
        if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
          rawVerts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        } else {
          rawVerts.push({ x: unwrapXAgainst(a.x, v.x, period), y: v.y });
        }
      }
      return { pts, verts: alignVerts(pts, rawVerts), closed };
    };
    const posOf = new Map<string, number>();
    let segStart = 0;
    for (let i = 0; i < chainKeys.length; i++) {
      const k = chainKeys[i];
      if (posOf.has(k)) {
        const seg = posOf.get(k)!;
        if (seg >= segStart) {
          const r = buildRing(seg, i, seg, i, true);
          if (r) rings.push(r);
          for (let j = seg; j <= i; j++) posOf.delete(chainKeys[j]);
          segStart = i;
        }
      }
      posOf.set(k, i);
    }
    // 尾段：闭合（回到 startK）或保持开链
    const closedTail = chainKeys[chainKeys.length - 1] === startK && chainEdges.length - segStart >= 3;
    const tail = buildRing(segStart, chainEdges.length, segStart, chainKeys.length - (closedTail ? 1 : 0), closedTail);
    if (tail) rings.push(tail);
    return rings;
  };

  for (let i = 0; i < edges.length; i++) {
    if (usedE[i]) continue;
    for (const r of walkFrom(i)) {
      if (r.pts.length >= 2) rings.push(r);
    }
  }
  return rings;
}

export function edgeListToRings(
  edgeSrc: BoundEdge[],
  project: (ll: LonLat) => Pt,
  period: number,
): MidRing[] {
  if (!edgeSrc.length) return [];
  const projected: { p0: Pt; p1: Pt; midpoint: Pt; k0: string; k1: string }[] = [];
  for (const { pa, pb } of edgeSrc) {
    const a = project(pa);
    const b = project(pb);
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) ||
      !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    const p0 = { x: wrapPeriod(a.x, period), y: a.y };
    const bu = { x: unwrapXAgainst(p0.x, b.x, period), y: b.y };
    const midpoint = project(sphericalEdgeMidpoint(pa, pb));
    if (!Number.isFinite(midpoint.x) || !Number.isFinite(midpoint.y)) continue;
    projected.push({ p0, p1: bu, midpoint, k0: lonlatKey(pa), k1: lonlatKey(pb) });
  }
  const rings = chainEdgesToMidpointRings(projected, period);
  // **同件各环必须落在同一周期窗**：逐链 unwrap 会把不同链放到不同副本（相差整数周期），
  // 实例化绘制时跨副本 evenodd 相互抵消 → 整体「内外颠倒」（区间件尤甚）。
  // 以首环中心为基准把各环心 unwrap 对齐（只整体平移整数周期，件的周期语义不变）。
  if (rings.length > 1) {
    const centerX = (r: MidRing): number => {
      let mn = Infinity, mx = -Infinity;
      for (const p of r.pts) { if (p.x < mn) mn = p.x; if (p.x > mx) mx = p.x; }
      return (mn + mx) / 2;
    };
    const ref = centerX(rings[0]);
    for (let i = 1; i < rings.length; i++) {
      const r = rings[i];
      const cx = centerX(r);
      const k = Math.round((cx - ref) / period);
      if (k === 0) continue;
      const dx = -k * period;
      for (const p of r.pts) p.x += dx;
      for (const v of r.verts ?? []) v.x += dx;
    }
  }
  return rings;
}

/** 唯一求环入口：cell 集 → 中点环 */
export function cellSetBoundaryRings(
  world: World,
  cellIds: Iterable<CellId>,
  project: (ll: LonLat) => Pt,
  edgeSrc?: BoundEdge[],
  period = Math.PI * 2,
): MidRing[] {
  // 给定边集（增量路径）时禁止再建 Set：链化只依赖边，O(边界) 而非 O(cell)
  const edges = edgeSrc ?? cellSetBoundaryEdges(world, cellIds);
  return edgeListToRings(edges, project, period);
}
