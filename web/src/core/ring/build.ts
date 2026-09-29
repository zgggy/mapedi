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

/**
 * 周期参数：常数（平面坐标/圆柱族）或**按 y 求值**（伪圆柱——罗宾森周期
 * = scale(y)·2π 随纬度内收）。x = scale(y)·λ 是经度的仿射单调像，故
 * 「x 域在局部周期下 unwrap」≡「经度域 ±360 unwrap」，链化无需知道投影。
 */
export type PeriodAt = number | ((y: number) => number);
const per = (p: PeriodAt, y: number): number => (typeof p === 'function' ? p(y) : p);

function wkey(x: number, y: number, period: PeriodAt): string {
  const pp = per(period, y);
  let wx = wrapPeriod(x, pp);
  if (Math.abs(wx) >= pp / 2 - 1e-5) wx = pp / 2;
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

export function edgeMidpoint(p0: Pt, p1: Pt, period: PeriodAt = Math.PI * 2): Pt {
  const b = { x: unwrapXAgainst(p0.x, p1.x, per(period, p1.y)), y: p1.y };
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

/**
 * **定向（cell 归属 = 内外真相）**：把边界边定向为「成员侧在行进方向**左侧**」。
 * 环的内外由此由数据唯一确定，不靠几何猜测：外环顺成员、洞环反成员，
 * 手性自然分化；链化只走有向出边（见 chainEdgesToMidpointRings），
 * 补边侧由链净方向推导（见 normalize.closeRingForCylindrical）。
 *
 * 边对象可能是 pairEdgeCache 的共享缓存，**不得就地换向**——同一边在不同件里
 * 成员侧相反，就地改会串向；换向只体现在返回副本上。
 *
 * 判据用球面三重积 a·(b×m)：> 0 ⟺ 成员中心 m 在有向边 pa→pb 左侧。
 * 平面叉积在跨 ±180 缝（经度差绕错向）和高纬会错号；三重积处处同胚保向。
 */
export function orientMemberLeft(
  world: World,
  set: Set<CellId>,
  e: BoundEdge,
): BoundEdge {
  const dash = e.ek.indexOf('-');
  if (dash < 0) return e;
  const i = +e.ek.slice(0, dash);
  const j = +e.ek.slice(dash + 1);
  const mem = set.has(i) ? i : set.has(j) ? j : -1;
  if (mem < 0) return e;
  const c = world.cells[mem];
  if (!c) return e;
  const unit = (p: LonLat) => {
    const lon = (p.lon * Math.PI) / 180;
    const lat = (p.lat * Math.PI) / 180;
    const cl = Math.cos(lat);
    return [cl * Math.cos(lon), cl * Math.sin(lon), Math.sin(lat)] as const;
  };
  const a = unit(e.pa);
  const b = unit(e.pb);
  const m = unit(c.center);
  const triple =
    a[0] * (b[1] * m[2] - b[2] * m[1]) -
    a[1] * (b[0] * m[2] - b[2] * m[0]) +
    a[2] * (b[0] * m[1] - b[1] * m[0]);
  return triple < 0 ? { ek: e.ek, pa: e.pb, pb: e.pa } : e;
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
    out.push(orientMemberLeft(world, set, e));
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
  period: PeriodAt = Math.PI * 2,
): MidRing[] {
  if (!edgeSrc.length) return [];
  type E = { k0: string; k1: string; p0: Pt; p1: Pt; midpoint?: Pt };
  const edges: E[] = [];
  for (const { p0, p1, midpoint, k0, k1 } of edgeSrc) {
    if (!p0 || !p1) continue;
    const p0w = { x: wrapPeriod(p0.x, per(period, p0.y)), y: p0.y };
    const p1u = { x: unwrapXAgainst(p0w.x, p1.x, per(period, p1.y)), y: p1.y };
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
    if (!rep.has(e.k1)) rep.set(e.k1, { x: wrapPeriod(e.p1.x, per(period, e.p1.y)), y: e.p1.y });
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

  const buildRingFrom = (
    edgeIdx: number[],
    keyList: string[],
    closed: boolean,
  ): MidRing | null => {
    const nE = edgeIdx.length;
    if (nE < 2) return null;
    const pts: Pt[] = [];
    let prevX: number | null = null;
    for (let i = 0; i < nE; i++) {
      const e = edges[edgeIdx[i]];
      const m = e.midpoint ?? edgeMidpoint(e.p0, e.p1, period);
      const mm: Pt = prevX === null ? m : { x: unwrapXAgainst(prevX, m.x, per(period, m.y)), y: m.y };
      pts.push(mm);
      prevX = mm.x;
    }
    const keys = keyList.slice(0, closed ? nE : nE + 1);
    const nV = closed ? nE : nE - 1;
    const rawVerts: Pt[] = [];
    for (let i = 0; i < nV; i++) {
      const a = pts[i];
      const b = pts[i + 1] ?? (closed ? { x: unwrapXAgainst(a.x, pts[0].x, per(period, pts[0].y)), y: pts[0].y } : pts[i]);
      const vk = keys[(i + 1) % keys.length];
      const v = vk ? rep.get(vk) : undefined;
      if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
        rawVerts.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      } else {
        rawVerts.push({ x: unwrapXAgainst(a.x, v.x, per(period, v.y)), y: v.y });
      }
    }
    return { pts, verts: alignVerts(pts, rawVerts), closed };
  };

  /**
   * 走链 + **栈式拆环**：到重复顶点即弹出子环、外链保留（此前的拆法会吞掉
   * 子环之前的链段 → 外环丢失 → 局部内外反）。终点回到起点 = 闭合；走死 = 开链。
   */
  const walkFrom = (startEdge: number): MidRing[] => {
    const out: MidRing[] = [];
    const e0 = edges[startEdge];
    usedE[startEdge] = true;
    const startK = e0.k0;
    const chainEdges: number[] = [startEdge];
    const chainKeys: string[] = [startK, e0.k1];
    let curK = e0.k1;
    let prevK = startK;

    for (let guard = 0; guard < edges.length + 8; guard++) {
      if (curK === startK) break;
      // 角序续接（同侧转定则）：接触点取「入边反向的下一条」，不走错边
      const nbs = adj.get(curK) ?? [];
      let nextK: string | null = null;
      let nextEi = -1;
      const curPt = rep.get(curK);
      const prevPt = rep.get(prevK);
      if (curPt && prevPt) {
        const inAng = Math.atan2(prevPt.y - curPt.y, prevPt.x - curPt.x);
        let bestOff = Infinity;
        for (const nk of nbs) {
          if (nk === prevK && nbs.length > 1) continue;
          const eis = edgeBetween.get(ekey(curK, nk)) ?? [];
          // 只走**有向出边**（定向后边的方向 = 成员在左）——续接由数据定，不猜
          const free = eis.find((i) => !usedE[i] && edges[i].k0 === curK);
          if (free === undefined) continue;
          const np = rep.get(nk);
          if (!np) continue;
          const outAng = Math.atan2(np.y - curPt.y, np.x - curPt.x);
          let off = inAng - outAng;
          while (off <= 1e-12) off += Math.PI * 2;
          while (off > Math.PI * 2) off -= Math.PI * 2;
          if (off < bestOff) {
            bestOff = off;
            nextK = nk;
            nextEi = free;
          }
        }
      }
      if (!nextK || nextEi < 0) {
        // 兜底无向续接：伪边定向缺失等退化时保链化不死链（正常数据走上方有向分支）
        for (const nk of nbs) {
          if (nk === prevK && nbs.length > 1) continue;
          const eis = edgeBetween.get(ekey(curK, nk)) ?? [];
          const free = eis.find((i) => !usedE[i]);
          if (free === undefined) continue;
          nextK = nk;
          nextEi = free;
          break;
        }
      }
      if (!nextK || nextEi < 0) break;
      usedE[nextEi] = true;
      chainEdges.push(nextEi);
      prevK = curK;
      curK = nextK;
      chainKeys.push(curK);

      if (curK === startK) {
        const r = buildRingFrom(chainEdges, chainKeys, true);
        if (r) out.push(r);
        chainEdges.length = 0;
        chainKeys.length = 1;
        break;
      }
      // 重复顶点 → 弹出子环（keys[s..] 是一个闭环），外链截断到 s 继续
      let s = -1;
      for (let j = chainKeys.length - 2; j >= 0; j--) {
        if (chainKeys[j] === curK) { s = j; break; }
      }
      if (s >= 0) {
        const r = buildRingFrom(chainEdges.slice(s), chainKeys.slice(s), true);
        if (r) out.push(r);
        chainEdges.length = s;
        chainKeys.length = s + 1;
      }
    }
    // 走死的剩余链：保持开链（不补假边）
    if (chainEdges.length >= 2) {
      const r = buildRingFrom(chainEdges, chainKeys, false);
      if (r) out.push(r);
    }
    return out;
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
  period: PeriodAt,
): MidRing[] {
  if (!edgeSrc.length) return [];
  const projected: { p0: Pt; p1: Pt; midpoint: Pt; k0: string; k1: string }[] = [];
  for (const { pa, pb } of edgeSrc) {
    const a = project(pa);
    const b = project(pb);
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) ||
      !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    const p0 = { x: wrapPeriod(a.x, per(period, a.y)), y: a.y };
    const bu = { x: unwrapXAgainst(p0.x, b.x, per(period, b.y)), y: b.y };
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
      // 整数周期窗对齐：伪圆柱周期随 y 变 → 平移 = per-vertex 的 k·periodAt(y)
      // （等价经度域 ±2πk 重映射，几何精确；常数周期时退化为整块平移）
      const k = Math.round((cx - ref) / per(period, r.pts[0]?.y ?? 0));
      if (k === 0) continue;
      for (const p of r.pts) p.x += -k * per(period, p.y);
      for (const v of r.verts ?? []) v.x += -k * per(period, v.y);
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
  period: PeriodAt = Math.PI * 2,
): MidRing[] {
  // 给定边集（增量路径）时禁止再建 Set：链化只依赖边，O(边界) 而非 O(cell)
  const edges = edgeSrc ?? cellSetBoundaryEdges(world, cellIds);
  return edgeListToRings(edges, project, period);
}
