/**
 * 边界环构建（**唯一归属 = CellId 集合**）。
 *
 * 没有 owner 概念：Region / DisplayPiece / 海岸 都是 `cellIds` 的边界。
 * 顶点拓扑只来自 `world.sharedEdges`（由 cell.polygon 导出）。
 */
import { KEY_QUANT, WRAP_EPS, GEOM_EPS } from '../tolerances';
import type { CellId, LonLat, World } from '../types';
import { unwrapXAgainst, wrapPeriod, type Pt } from '../../render/space';
import { alignVerts, type MidRing } from './displayRing';

export type BoundEdge = {
  ek: string;
  pa: LonLat;
  pb: LonLat;
  /** 成员格 id（orientMemberLeft 定向时按当前集合判定并带上）——
   *  触点续接用「同成员弧配对」：环必须沿同一成员格的边界转，与输入序/投影角无关。 */
  m?: CellId;
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
  if (Math.abs(lon) >= 180 - WRAP_EPS) lon = 180;
  return `${Math.round(lon * KEY_QUANT)},${Math.round(ll.lat * KEY_QUANT)}`;
}

/** lonlatKey 的数值版（**同分桶**：同一 0.001° 网格 + ±180 缝归一）——热路径用，免字符串 */
export function lonlatNumKey(ll: LonLat): number {
  let lon = ll.lon;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  if (Math.abs(lon) >= 180 - WRAP_EPS) lon = 180;
  return (Math.round(lon * KEY_QUANT) + 180000) * 360001 + (Math.round(ll.lat * KEY_QUANT) + 90000);
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
  if (triple < 0) return { ek: e.ek, pa: e.pb, pb: e.pa, m: mem };
  return e.m === mem ? e : { ek: e.ek, pa: e.pa, pb: e.pb, m: mem };
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
  edgeSrc: { p0: Pt; p1: Pt; midpoint?: Pt; k0?: string; k1?: string; m?: CellId }[],
  period: PeriodAt = Math.PI * 2,
): MidRing[] {
  if (!edgeSrc.length) return [];
  type E = { k0: string; k1: string; p0: Pt; p1: Pt; midpoint?: Pt; m?: CellId };
  const edges: E[] = [];
  for (const { p0, p1, midpoint, k0, k1, m } of edgeSrc) {
    if (!p0 || !p1) continue;
    const p0w = { x: wrapPeriod(p0.x, per(period, p0.y)), y: p0.y };
    const p1u = { x: unwrapXAgainst(p0w.x, p1.x, per(period, p1.y)), y: p1.y };
    edges.push({
      k0: k0 ?? wkey(p0.x, p0.y, period),
      k1: k1 ?? wkey(p1.x, p1.y, period),
      p0: p0w,
      p1: p1u,
      midpoint,
      m,
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
    void keyList;
    const nE = edgeIdx.length;
    if (nE < 2) return null;
    // 行走序 pts（原逻辑）
    const pts: Pt[] = [];
    let prevX: number | null = null;
    for (let i = 0; i < nE; i++) {
      const e = edges[edgeIdx[i]];
      const m = e.midpoint ?? edgeMidpoint(e.p0, e.p1, period);
      const mm: Pt = prevX === null ? m : { x: unwrapXAgainst(prevX, m.x, per(period, m.y)), y: m.y };
      pts.push(mm);
      prevX = mm.x;
    }
    // 绕行环（winding≠0）：把**闭合切口移到 |规范经度| 最大处（框缘）**并从该处重新
    // 展开。切口位置 = walk 起点 → 随边枚举序漂移 → 同一环在不同上下文 unwrap 出
    // 不同 x 轨迹（宽度都不同，实测 full/iso 331 环差 0.158）→ 与成员内容错位 →
    // even-odd 洞；且补边经线随切口插进内容内部（链起点经度纵贯 → 海峡奇偶翻转）。
    // 切到框缘后：闭合段为框缘处的小段、winding 归零 → closeRingForCylindrical 不再
    // 补边（补边经线=框缘自身，被 scissor 裁掉）→ 奇偶与枚举序彻底无关。
    if (closed && pts.length >= 3) {
      const pp0 = per(period, pts[0].y);
      const winding = Math.round((unwrapXAgainst(pts[nE - 1].x, pts[0].x, pp0) - pts[0].x) / pp0);
      if (winding !== 0) {
        // 候选 = |规范经度|（|x|/period 与投影无关）最大者；并列取 k0 键小者（确定性）
        let cut = 0;
        let bestScore = -1;
        for (let i = 0; i < nE; i++) {
          const pp = per(period, pts[i].y);
          const score = Math.abs(wrapPeriod(pts[i].x, pp)) / pp;
          if (score > bestScore + GEOM_EPS) {
            bestScore = score;
            cut = i;
          }
        }
        {
          // 轮转到切口；首点锚到**旧末点窗口**（闭合两点物理相邻 → 弦=小段）。
          // 若首点 wrap 到规范窗而末点在 +360 窗，闭合弦会横跨整周期 → 全图奇偶破坏
          // （实测 seam 组 328→201）。锚点的窗口差 = 整数周期 → 跨实例奇偶中性。
          const oldLastX = pts[nE - 1].x;
          const rotPts: Pt[] = pts.slice(cut).concat(pts.slice(0, cut));
          let prev: number | null = null;
          for (let i = 0; i < rotPts.length; i++) {
            const p = rotPts[i];
            const pp = per(period, p.y);
            const q: Pt = prev === null
              ? { x: unwrapXAgainst(oldLastX, wrapPeriod(p.x, pp), pp), y: p.y }
              : { x: unwrapXAgainst(prev, p.x, pp), y: p.y };
            rotPts[i] = q;
            prev = q.x;
          }
          for (let i = 0; i < pts.length; i++) { pts[i].x = rotPts[i].x; pts[i].y = rotPts[i].y; }
          const rotE = edgeIdx.slice(cut).concat(edgeIdx.slice(0, cut));
          for (let i = 0; i < nE; i++) edgeIdx[i] = rotE[i];
        }
      }
    }
    // 键序列由轮转后的边序重建（closed: 末键=末边 k1=首边 k0=首键，回绕一致）
    const keys: string[] = [edges[edgeIdx[0]].k0];
    for (let i = 0; i < nE; i++) keys.push(edges[edgeIdx[i]].k1);
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
   * 同成员后继置换（拆环唯一确定）：入弧 e 在其终点的后继 = **同成员格的有向出弧**。
   * 成员在左定向下环必沿同一成员格的边转；触点/三角点按成员分桶后每桶恰 1 in + 1 out，
   * 故 succ 是静态双射——与输入顺序、投影角（跨缝 atan2 失真）、usedE 状态全部无关。
   * 旧实现（行走史角序 + 无向兜底 + 栈式拆环）在同一图结构下随边枚举序产出不同拆环，
   * 还会拆出内部重叠的环 → even-odd 相消出缝隙（实证：strip 与中心两点在两种顺序下各坏一个）。
   * 退化回退：同成员桶空（度2 跨成员接续 A|C→C|B）→ 出弧唯一则取；多出弧 → 角序最近（保底）。
   */
  // ---- 逐顶点双射配对（in → out，每条出弧恰用一次）----
  // 桶1 同成员（1:1 时直接配）；桶2 剩余入弧按角序对剩余出弧贪心——顶点内 |in|=|out|
  // （定向不变量：成员|非成员邻接绕点成偶）→ 贪心必用光全部出弧 = 双射。
  const insAt = new Map<string, number[]>();
  edges.forEach((e, i) => {
    let l = insAt.get(e.k1);
    if (!l) { l = []; insAt.set(e.k1, l); }
    l.push(i);
  });
  const outsAt = new Map<string, number[]>();
  edges.forEach((e, i) => {
    let l = outsAt.get(e.k0);
    if (!l) { l = []; outsAt.set(e.k0, l); }
    l.push(i);
  });
  const succ = new Int32Array(edges.length).fill(-1);
  const outUsedG = new Set<number>();
  const angleOf = (k: string, to: Pt): number => {
    const v = rep.get(k)!;
    const ox = unwrapXAgainst(v.x, to.x, per(period, v.y));
    return Math.atan2(to.y - v.y, ox - v.x);
  };
  // 桶1：同成员 1:1
  for (const [k, ins] of insAt) {
    const outs = outsAt.get(k) ?? [];
    if (!outs.length) continue;
    const byM = (arr: number[], pick: (i: number) => number | undefined) => {
      const m = new Map<number, number[]>();
      for (const i of arr) {
        const mm = pick(i);
        if (mm === undefined) continue;
        let l = m.get(mm); if (!l) { l = []; m.set(mm, l); }
        l.push(i);
      }
      return m;
    };
    const insM = byM(ins, (i) => edges[i].m);
    const outsM = byM(outs, (i) => edges[i].m);
    for (const [m, iList] of insM) {
      const oList = (outsM.get(m) ?? []).filter((j) => !outUsedG.has(j));
      if (iList.length === 1 && oList.length === 1) {
        succ[iList[0]] = oList[0];
        outUsedG.add(oList[0]);
      }
    }
  }
  // 桶2：剩余入弧 × 剩余出弧，顶点内角序贪心（|in| = |out| → 用光 = 双射）
  for (const [k, ins] of insAt) {
    const pend = ins.filter((i) => succ[i] < 0);
    if (!pend.length) continue;
    const outs = (outsAt.get(k) ?? []).filter((j) => !outUsedG.has(j));
    if (!outs.length) continue;
    const v = rep.get(k)!;
    // 确定性：pend 按入射方位角排序处理（撞车时「角序先者」赢，与 edges 数组序无关）
    const pendAng = pend.map((ei) => {
      const u = edges[ei];
      const up = rep.get(u.k0) ?? u.p0;
      const inAng = Math.atan2(up.y - v.y, unwrapXAgainst(v.x, up.x, per(period, v.y)) - v.x);
      return { ei, inAng };
    });
    pendAng.sort((a, b) => a.inAng - b.inAng);
    for (const { ei, inAng } of pendAng) {
      let best = -1, bestOff = Infinity;
      for (const j of outs) {
        const w = rep.get(edges[j].k1) ?? edges[j].p1;
        const outAng = angleOf(k, w);
        let off = inAng - outAng;
        while (off <= GEOM_EPS) off += Math.PI * 2;
        while (off > Math.PI * 2) off -= Math.PI * 2;
        if (off < bestOff) { bestOff = off; best = j; }
      }
      if (best >= 0) { succ[ei] = best; outUsedG.add(best); }
    }
  }

  // 提环：succ 覆盖所有入弧（双射）→ 每条边恰属一环；万一断链按开链输出（不丢边，与旧行为一致）
  for (let i = 0; i < edges.length; i++) {
    if (usedE[i] || succ[i] < 0) continue;
    const chain: number[] = [];
    const keys: string[] = [];
    let cur = i;
    let closed = false;
    for (let guard = 0; guard < edges.length + 2; guard++) {
      usedE[cur] = true;
      chain.push(cur);
      keys.push(edges[cur].k0);
      const nx = succ[cur];
      if (nx === i) { closed = true; break; }
      if (nx < 0 || usedE[nx]) break;
      cur = nx;
    }
    keys.push(edges[i].k0);
    const r = buildRingFrom(chain, keys, closed);
    if (r && r.pts.length >= 2) rings.push(r);
  }
  // succ 未覆盖的入弧（|in|≠|out| 退化）兜底：角序补链成开环
  for (let i = 0; i < edges.length; i++) {
    if (!usedE[i]) {
      usedE[i] = true;
      const r = buildRingFrom([i], [edges[i].k0, edges[i].k1], false);
      if (r && r.pts.length >= 2) rings.push(r);
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
  const projected: { p0: Pt; p1: Pt; midpoint: Pt; k0: string; k1: string; m?: CellId }[] = [];
  for (const { pa, pb, m: mem } of edgeSrc) {
    const a = project(pa);
    const b = project(pb);
    if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y) ||
      !Number.isFinite(b.x) || !Number.isFinite(b.y)) continue;
    const p0 = { x: wrapPeriod(a.x, per(period, a.y)), y: a.y };
    const bu = { x: unwrapXAgainst(p0.x, b.x, per(period, b.y)), y: b.y };
    const midpoint = project(sphericalEdgeMidpoint(pa, pb));
    if (!Number.isFinite(midpoint.x) || !Number.isFinite(midpoint.y)) continue;
    projected.push({ p0, p1: bu, midpoint, k0: lonlatKey(pa), k1: lonlatKey(pb), m: mem });
  }
  const rings = chainEdgesToMidpointRings(projected, period);
  // **同件各环必须落在同一周期窗**：逐链 unwrap 会把不同链放到不同副本（相差整数周期），
  // 实例化绘制时跨副本 evenodd 相互抵消 → 整体「内外颠倒」（区间件尤甚）。
  //
  // 基准 = **规范窗（x≈0 附近）**，不是首环中心：ref 取首环会让对齐结果依赖
  // walk/输入枚举顺序（首环随顺序变 → 平移判定变 → 环间相对窗错位 → even-odd 缝隙，
  // 且漏点随顺序漂移到不同经线——实证三版拆环各坏一处、漏点全聚单经线）。
  // 规范窗同时与内容真相一致（内容 x ∈ [−sπ, sπ]），绘制副本 k=0 即正确。
  if (rings.length > 1) {
    const centerX = (r: MidRing): number => {
      let mn = Infinity, mx = -Infinity;
      for (const p of r.pts) { if (p.x < mn) mn = p.x; if (p.x > mx) mx = p.x; }
      return (mn + mx) / 2;
    };
    for (const r of rings) {
      const cx = centerX(r);
      // 整数周期窗对齐：伪圆柱周期随 y 变 → 平移 = per-vertex 的 k·periodAt(y)
      // （等价经度域 ±2πk 重映射，几何精确；常数周期时退化为整块平移）
      // 除数用环 y 中点处的 period（不依赖首点——首点随 walk 起点变）
      let ym = 0;
      for (const p of r.pts) ym += p.y;
      ym /= r.pts.length;
      const k = Math.round(cx / per(period, ym));
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
