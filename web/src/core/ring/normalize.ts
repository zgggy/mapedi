/**
 * 边界环正规化（投影空间）：unwrap → 周期真实终点 → 填充用框边。
 *
 * fill / stroke 共用本模块输出，禁止在绘制侧再拆。（阴影已归档）
 */
import { unwrapXAgainst, type Pt } from '../../render/space';
import {
  compactPts,
  toDisplayRing,
  type DisplayRing,
  type MidRing,
} from './displayRing';

/**
 * 绕行环补边侧 = **统一南侧**（不变量，勿逐环选择）。
 *
 * 原理：所有绕行环同侧闭合时，「成员 ≡ XOR(闭合环) ⊕ flip」全局成立——
 * 穿越任何一条环，奇偶与成员同步翻转，差值是常数（flip），由奇偶探针在闭合环上定。
 * 逐环选侧（如按环均值 y）会破坏可加性：区间件（带状+散布）被整体翻转成「补色」
 * ——这正是「浅滩地块没涂色、非浅滩反被涂浅滩色」的根因（球面逐 cell 着色无此问题）。
 */
export function poleSideForRing(_ring: MidRing): 'north' | 'south' {
  return 'south';
}

/**
 * 显示环统一预处理：**fill / stroke / 内阴影必须共用同一结果**。
 * 真实闭环绕经度一周时在相邻副本收尾；框边只用于填充。
 */
export function prepareDisplayRings(
  ring: MidRing,
  frameY: { minY: number; maxY: number; minX?: number; maxX?: number; cylindrical?: boolean },
  poleSide: 'north' | 'south' = 'south',
): DisplayRing[] {
  if (frameY.cylindrical === false) {
    const base = toDisplayRing(ring);
    return base ? [base] : [];
  }
  const rawPts = compactPts(ring.pts ?? []);
  const n = rawPts.length;
  if (n < 2) return [];
  const period = (frameY.maxX ?? Math.PI) - (frameY.minX ?? -Math.PI);

  const pts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      pts.push({ x: rawPts[0].x, y: rawPts[0].y });
      continue;
    }
    const prev = pts[i - 1];
    let x = rawPts[i].x;
    while (x - prev.x > period / 2) x -= period;
    while (x - prev.x < -period / 2) x += period;
    pts.push({ x, y: rawPts[i].y });
  }

  // verts[i] 对 pts[i]→pts[i+1] 段中点 unwrap
  const rawVerts = ring.verts ?? [];
  const verts: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const next = pts[(i + 1) % n];
    const b = i === n - 1 && ring.closed
      ? { x: unwrapXAgainst(a.x, next.x, period), y: next.y }
      : next;
    const refX = (a.x + b.x) / 2;
    const v = rawVerts[i];
    if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y)) {
      verts.push({ x: refX, y: (a.y + b.y) / 2 });
      continue;
    }
    verts.push({ x: unwrapXAgainst(refX, v.x, period), y: v.y });
  }

  return closeRingForCylindrical({ pts, verts, closed: ring.closed }, frameY, poleSide);
}

/**
 * 绕行环的末端与首端是同一球面位置、不同世界副本。最后一段仍是真边；
 * 沿所属极点一侧框边补虚边；每个副本独立闭合，不能跨副本接极点。
 */
function closeRingForCylindrical(
  ring: MidRing,
  frameLatY: { minY: number; maxY: number; minX?: number; maxX?: number },
  poleSide: 'north' | 'south' = 'south',
): DisplayRing[] {
  const base = toDisplayRing(ring);
  if (!base) return [];
  const { pts, verts } = base;
  if (pts.length < 3 || !ring.closed) return [base];
  const period = (frameLatY.maxX ?? Math.PI) - (frameLatY.minX ?? -Math.PI);

  const p0 = pts[0];
  const pN = pts[pts.length - 1];
  const seamX = unwrapXAgainst(pN.x, p0.x, period);
  const winding = Math.round((seamX - p0.x) / period);
  if (winding === 0) return [base];
  const end = { x: seamX, y: p0.y };
  const edgeY = poleSide === 'north' ? frameLatY.maxY : frameLatY.minY;
  const bottomEnd = { x: seamX, y: edgeY };
  const bottomStart = { x: p0.x, y: edgeY };
  const display = toDisplayRing({
    pts: [...pts, end, bottomEnd, bottomStart],
    verts: [
      ...verts,
      { x: end.x, y: (end.y + bottomEnd.y) / 2 },
      { x: (bottomEnd.x + bottomStart.x) / 2, y: bottomEnd.y },
      { x: bottomStart.x, y: (bottomStart.y + p0.y) / 2 },
    ],
    closed: true,
    virtualFrom: pts.length,
  });
  return display ? [display] : [];
}
