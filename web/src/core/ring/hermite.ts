/**
 * 中点 Hermite **唯一实现**。
 * ctx 路径与 Path2D 都走 appendMidRing，禁止第二份控制柄公式。
 */
import type { Pt } from '../../render/space';
import { toDisplayRing, type DisplayRing, type MidRing } from './displayRing';

export type PathSink = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  bezierCurveTo(
    c1x: number,
    c1y: number,
    c2x: number,
    c2y: number,
    x: number,
    y: number,
  ): void;
  closePath(): void;
};

/** 过边中点、切线=边方向的 Hermite 路径 */
export function appendMidRing(
  path: PathSink,
  ring: MidRing | DisplayRing,
  smooth = 0.65,
  mode: 'fill' | 'outline' = 'fill',
): boolean {
  const d = toDisplayRing(ring);
  if (!d) return false;
  const { pts, verts, closed } = d;
  const n = pts.length;
  if (n < 2) return false;
  const k = 0.08 + 0.5 * Math.max(0, Math.min(1, smooth));
  if (n === 2) {
    path.moveTo(pts[0].x, pts[0].y);
    path.lineTo(pts[1].x, pts[1].y);
    return true;
  }
  path.moveTo(pts[0].x, pts[0].y);
  const segs = mode === 'outline' && d.virtualFrom !== undefined
    ? Math.min(n, d.virtualFrom)
    : closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = pts[i];
    const p3 = pts[(i + 1) % n];
    if (d.virtualFrom !== undefined && i >= d.virtualFrom) {
      path.lineTo(p3.x, p3.y);
      continue;
    }
    const V = verts[i] ?? { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
    let t0x = V.x - p0.x;
    let t0y = V.y - p0.y;
    let t3x = p3.x - V.x;
    let t3y = p3.y - V.y;
    const l0 = Math.hypot(t0x, t0y);
    const l3 = Math.hypot(t3x, t3y);
    if (!(l0 > 1e-6) || !(l3 > 1e-6) || l0 > 0.45 || l3 > 0.45) {
      const steps = Math.max(2, Math.ceil(Math.max(l0, l3) / 0.15));
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const u = 1 - t;
        const c1x = p0.x + (V.x - p0.x) * 0.3;
        const c1y = p0.y + (V.y - p0.y) * 0.3;
        const c2x = p3.x + (V.x - p3.x) * 0.3;
        const c2y = p3.y + (V.y - p3.y) * 0.3;
        const x =
          u * u * u * p0.x + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * p3.x;
        const y =
          u * u * u * p0.y + 3 * u * u * t * c1y + 3 * u * t * t * c2y + t * t * t * p3.y;
        path.lineTo(x, y);
      }
      continue;
    }
    t0x /= l0;
    t0y /= l0;
    t3x /= l3;
    t3y /= l3;
    const cap = Math.min(l0, l3) * 0.55;
    const h0 = Math.min(l0 * k, cap);
    const h3 = Math.min(l3 * k, cap);
    path.bezierCurveTo(
      p0.x + t0x * h0,
      p0.y + t0y * h0,
      p3.x - t3x * h3,
      p3.y - t3y * h3,
      p3.x,
      p3.y,
    );
  }
  if (closed && (mode === 'fill' || d.virtualFrom === undefined)) path.closePath();
  return true;
}

/** 采样成折线（导出 SVG / 调试用，与描边同一曲线） */
export function sampleMidRing(
  ring: MidRing | DisplayRing,
  smooth = 0.65,
  mode: 'fill' | 'outline' = 'fill',
): Pt[] {
  const out: Pt[] = [];
  const sink: PathSink = {
    moveTo(x, y) {
      out.push({ x, y });
    },
    lineTo(x, y) {
      out.push({ x, y });
    },
    bezierCurveTo(c1x, c1y, c2x, c2y, x, y) {
      const p0 = out[out.length - 1] ?? { x, y };
      const n = 8;
      for (let s = 1; s <= n; s++) {
        const t = s / n;
        const u = 1 - t;
        out.push({
          x:
            u * u * u * p0.x +
            3 * u * u * t * c1x +
            3 * u * t * t * c2x +
            t * t * t * x,
          y:
            u * u * u * p0.y +
            3 * u * u * t * c1y +
            3 * u * t * t * c2y +
            t * t * t * y,
        });
      }
    },
    closePath() {
      if (out.length) out.push({ ...out[0] });
    },
  };
  appendMidRing(sink, ring, smooth, mode);
  return out;
}
