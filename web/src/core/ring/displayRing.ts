/**
 * 显示环类型与不变量。
 *
 * DisplayRing 保证：
 * - pts.length >= 2 且点有限
 * - verts.length === pts.length
 * - verts[i] 对应 pts[i] → pts[i+1]（闭环含 last→first）
 *
 * fill / stroke **只**吃 DisplayRing，禁止分叉预处理。（阴影已归档）
 */
import { GEOM_EPS } from '../tolerances';
import type { Pt } from '../../render/space';

/** 边界环：曲线过边中点 pts，中点处切线 = 边（verts = 转角） */
export type MidRing = {
  pts: Pt[];
  verts: Pt[];
  closed: boolean;
  /** First frame-only segment; the preceding segments are real Hermite edges. */
  virtualFrom?: number;
  /** 成员奇偶表决判定的自然绕行环：x 空间 winding≠0 是环绕经度一周的合法累计，
   *  不得补边——补边经线取链起点任意经度，会切入环内部领土（海峡条带奇偶翻转）。 */
  seamNoCap?: boolean;
};

/** 规范化后的显示环（画前唯一形态） */
export type DisplayRing = MidRing & {
  pts: Pt[];
  verts: Pt[];
  closed: boolean;
};

function isFinitePt(p: Pt | undefined | null): p is Pt {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y);
}

/** 去掉空/非法点 */
export function compactPts(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    if (isFinitePt(p)) out.push({ x: p.x, y: p.y });
  }
  return out;
}

/**
 * verts 与 pts 对齐：缺角补弦中点，长度恒等于 pts。
 * 这是 DisplayRing 的唯一补角入口。
 */
export function alignVerts(pts: Pt[], verts: Pt[]): Pt[] {
  const n = pts.length;
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const v = verts?.[i];
    if (isFinitePt(v)) out.push({ x: v.x, y: v.y });
    else out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
}

/** 已是合法 DisplayRing 则原样返回（保 WeakMap/Path2D 键稳定） */
export function toDisplayRing(ring: MidRing): DisplayRing | null {
  if (!ring || !ring.pts) return null;
  const pts = ring.pts;
  const verts = ring.verts ?? [];
  if (pts.length < 2) return null;
  let ok = verts.length === pts.length;
  if (ok) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const v = verts[i];
      if (!isFinitePt(p) || !isFinitePt(v)) {
        ok = false;
        break;
      }
    }
  }
  if (ok) {
    return ring as DisplayRing;
  }
  const cp = compactPts(pts);
  if (cp.length < 2) return null;
  return {
    pts: cp,
    verts: alignVerts(cp, verts),
    closed: !!ring.closed && cp.length >= 3,
    virtualFrom: ring.virtualFrom,
  };
}

/** 有向面积（>0 外轮廓常见绕向） */
export function ringSignedArea(pts: Pt[]): number {
  const n = pts.length;
  if (n < 3) return 0;
  let a = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInRing(x: number, y: number, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].x;
    const yi = pts[i].y;
    const xj = pts[j].x;
    const yj = pts[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + GEOM_EPS) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 外环 / 洞环只由包含关系决定；独立岛屿不能按绕向误判为洞。 */
export function splitOuterHoleRings(rings: MidRing[]): {
  outers: DisplayRing[];
  holes: DisplayRing[];
} {
  const closed: DisplayRing[] = [];
  for (const r of rings) {
    const d = toDisplayRing(r);
    // 已合法时 toDisplayRing 仍可能新建 wrapper；优先保留入参引用以便 Path2D 缓存
    if (d && d.closed) {
      if (r.pts === d.pts && r.verts === d.verts) closed.push(r as DisplayRing);
      else closed.push(d);
    }
  }
  const areas = closed.map((r) => Math.abs(ringSignedArea(r.pts)));
  const outers: DisplayRing[] = [];
  const holes: DisplayRing[] = [];
  closed.forEach((r, i) => {
    const p0 = r.pts[0];
    let containers = 0;
    for (let j = 0; j < closed.length; j++) {
      if (j === i) continue;
      if (areas[j] <= areas[i]) continue;
      if (pointInRing(p0.x, p0.y, closed[j].pts)) {
        containers++;
      }
    }
    if (containers % 2) holes.push(r);
    else outers.push(r);
  });
  return { outers, holes };
}
