/**
 * 边界环正规化（投影空间）：unwrap → 周期真实终点 → 填充用框边。
 *
 * fill / stroke 共用本模块输出，禁止在绘制侧再拆。（阴影已归档）
 */
import { EPS_FP } from '../tolerances';
import { unwrapXAgainst, type Pt } from '../../render/space';
import type { PeriodAt } from './build';
const per = (p: PeriodAt, y: number): number => (typeof p === 'function' ? p(y) : p);
import {
  compactPts,
  toDisplayRing,
  type DisplayRing,
  type MidRing,
} from './displayRing';

/**
 * 显示环统一预处理：**fill / stroke / 内阴影必须共用同一结果**。
 * 真实闭环绕经度一周时在相邻副本收尾；框边只用于填充。
 */
export function prepareDisplayRings(
  ring: MidRing,
  frameY: {
    minY: number;
    maxY: number;
    minX?: number;
    maxX?: number;
    cylindrical?: boolean;
    /** 世界局部周期（伪圆柱 = scale(y)·2π）；缺省 = 框宽（圆柱族等价） */
    periodAt?: PeriodAt;
    /** 水平结构 x = scale(y)·λ 的 scale（补边经线弧用）；缺省 1 = 圆柱族退化 */
    scaleAt?: (y: number) => number;
  },
): DisplayRing[] {
  if (frameY.cylindrical === false) {
    const base = toDisplayRing(ring);
    return base ? [base] : [];
  }
  const rawPts = compactPts(ring.pts ?? []);
  const n = rawPts.length;
  if (n < 2) return [];
  const period: PeriodAt =
    frameY.periodAt ?? (frameY.maxX ?? Math.PI) - (frameY.minX ?? -Math.PI);

  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      pts.push({ x: rawPts[0].x, y: rawPts[0].y });
      continue;
    }
    const prev = pts[i - 1];
    let x = rawPts[i].x;
    const pp = per(period, rawPts[i].y);
    while (x - prev.x > pp / 2) x -= pp;
    while (x - prev.x < -pp / 2) x += pp;
    pts.push({ x, y: rawPts[i].y });
  }

  // verts[i] 对 pts[i]→pts[i+1] 段中点 unwrap
  const rawVerts = ring.verts ?? [];
  const verts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const next = pts[(i + 1) % n];
    const b = i === n - 1 && ring.closed
      ? { x: unwrapXAgainst(a.x, next.x, per(period, next.y)), y: next.y }
      : next;
    const refX = (a.x + b.x) / 2;
    const v = rawVerts[i];
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
      verts.push({ x: refX, y: (a.y + b.y) / 2 });
      continue;
    }
    verts.push({ x: unwrapXAgainst(refX, v.x, per(period, v.y)), y: v.y });
  }

  return closeRingForCylindrical({ pts, verts, closed: ring.closed }, frameY, period);
}

/**
 * 绕行环补边（末端与首端是同一球面位置、不同世界副本）。
 *
 * **补边侧由链的净方向推导（成员在左 = cell 归属定内外，不猜）**：
 * 边界边已按「成员在左」定向（build.ts cellSetBoundaryEdges），链净向 +x（k>0）⟺
 * 成员在北 → 补北框边；k<0 ⟺ 成员在南 → 补南框边。于是**闭合环的平面内侧 ≡ 元素成员侧**——
 * 用户要求的「环的内侧就是元素的内侧」由定向直接保证。
 * 以前统一补南 + flip 探针是统计猜测，探针一旦错（副本盲区）整件内外反。
 *
 * 非绕行环（winding=0）原样返回；每个副本独立闭合，不能跨副本接极点。
 */
function closeRingForCylindrical(
  ring: MidRing,
  frameLatY: {
    minY: number; maxY: number; minX?: number; maxX?: number;
    periodAt?: PeriodAt; scaleAt?: (y: number) => number;
  },
  period: PeriodAt,
): DisplayRing[] {
  const base = toDisplayRing(ring);
  if (!base) return [];
  const { pts, verts } = base;
  if (pts.length < 3 || !ring.closed) return [base];
  // 成员奇偶表决判定的自然绕行环：环已完整（链首尾=同一物理顶点），补边经线
  // （链起点任意经度）会切入环内部领土 → 海峡/极区条带奇偶翻转 → 填充缺失
  if (ring.seamNoCap) return [base];

  const p0 = pts[0];
  const pN = pts[pts.length - 1];
  const pp = per(period, p0.y);
  const seamX = unwrapXAgainst(pN.x, p0.x, pp);
  const winding = Math.round((seamX - p0.x) / pp);
  if (winding === 0) return [base];
  const edgeY = winding > 0 ? frameLatY.maxY : frameLatY.minY;
  const scaleAt = frameLatY.scaleAt ?? (() => 1);

  // **补边沿「经线 + 极线」走**（不是矩形）：x = scale(y)·λ 下矩形补边的横线宽
  // = periodAt(p0.y)，而副本在 edgeY 高度的位移 = scale(edgeY)·2π —— 伪圆柱两者
  // 不等（接缝裂）；改走经线弧 + 极线段后，每个顶点的副本位移 = scale(顶点 y)·2π，
  // 相邻副本**逐顶点重合**（极线段宽恰 = 2π·scale(edgeY)）→ 奇偶接缝精确。
  // 圆柱族 scale≡1：经线 = 竖直线、极线 = 横线 → 退化为原矩形几何，零差异。
  const lam0 = p0.x / Math.max(EPS_FP, scaleAt(p0.y)); // 断点经度（窗口内可超 ±π）
  const lamN = (p0.x + winding * pp) / Math.max(EPS_FP, scaleAt(p0.y)); // = lam0 + winding·2π
  const N = 8; // 经线弧插值（副本重合只依赖顶点共享，插值精度无关紧要）
  const span = edgeY - p0.y;
  const mid: Pt[] = [];
  for (let i = 1; i < N; i++) {
    const y = p0.y + (span * i) / N;
    mid.push({ x: lamN * scaleAt(y), y });
  }
  const edgeEnd = { x: lamN * scaleAt(edgeY), y: edgeY };
  const edgeStart = { x: lam0 * scaleAt(edgeY), y: edgeY };
  const back: Pt[] = [];
  for (let i = N - 1; i >= 1; i--) {
    const y = p0.y + (span * i) / N;
    back.push({ x: lam0 * scaleAt(y), y });
  }
  const added = [...mid, edgeEnd, edgeStart, ...back]; // 闭合自动回 p0
  const ptsAll = [...pts, ...added];
  // 虚拟段（补边）排除描边：verts[i] = 段 (pts[i], pts[i+1]) 中点（与原实现同口径）
  const virtualFrom = pts.length;
  const vertsAll = [...verts];
  for (let i = virtualFrom; i < ptsAll.length; i++) {
    const a = ptsAll[i];
    const b = ptsAll[(i + 1) % ptsAll.length];
    vertsAll.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  const display = toDisplayRing({
    pts: ptsAll,
    verts: vertsAll,
    closed: true,
    virtualFrom,
  });
  return display ? [display] : [];
}

