/**
 * 带洞多边形三角化（填充直绘用）—— ear clipping（支持凹）+ 洞桥接。
 *
 * 为什么需要：stencil 奇偶路径的「清零 / 外部参考点扇形 / 覆盖面」都是**包围盒级光栅**，
 * 而真实填充只是全图面积的一小块（件之间互相铺满）——包围盒放大是 GPU 光栅端饱和的主因。
 * 三角化后直绘，光栅 = 填充面积本身；奇偶语义由三角剖分天然给出（洞不进三角形）。
 *
 * 语义对照（显示契约）：Canvas `fill(path, 'evenodd')` 对「互不叠盖的副本平移」等价于
 * 各自的带洞填充（平移不改变奇偶）；副本几何可能重叠（件宽 ≥ 世界周期）时退回
 * stencil 奇偶路径（mapRenderer），语义精确不变。
 *
 * 结果按「环集数组 + smooth」缓存（几何缓存层）；面积自检不通过 → 调用方走兜底路径，
 * 不在此打补丁。
 */
import type { DisplayRing, MidRing } from '../../core/ring/displayRing';
import { splitOuterHoleRings, ringSignedArea, pointInRing } from '../../core/ring/displayRing';
import { ShapeUtils, Vector2 } from 'three';
import type { Pt } from './geometry';

function signedAreaFlat(pts: number[]): number {
  let a = 0;
  const n = pts.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) a += pts[j * 2] * pts[i * 2 + 1] - pts[i * 2] * pts[j * 2 + 1];
  return a / 2;
}

/**
 * 折线预处理：去相邻重复点、去共线中间点。
 * hermite 采样常出重复/共线点——不清理会让剖分退化（面积自检失败走兜底）。
 */
function cleanPoly(p: number[]): number[] {
  const n = p.length >> 1;
  const dedup: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = p[i * 2];
    const y = p[i * 2 + 1];
    const m = dedup.length;
    if (m >= 2 && Math.abs(dedup[m - 2] - x) < 1e-12 && Math.abs(dedup[m - 1] - y) < 1e-12) continue;
    dedup.push(x, y);
  }
  if (dedup.length >= 4 && Math.abs(dedup[0] - dedup[dedup.length - 2]) < 1e-12 &&
      Math.abs(dedup[1] - dedup[dedup.length - 1]) < 1e-12) {
    dedup.length -= 2;
  }
  const out: number[] = [];
  const m = dedup.length >> 1;
  for (let i = 0; i < m; i++) {
    const ax = dedup[((i + m - 1) % m) * 2], ay = dedup[((i + m - 1) % m) * 2 + 1];
    const bx = dedup[i * 2], by = dedup[i * 2 + 1];
    const cx = dedup[((i + 1) % m) * 2], cy = dedup[((i + 1) % m) * 2 + 1];
    const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (Math.abs(cross) < 1e-12) continue;
    out.push(bx, by);
  }
  return out.length >= 6 ? out : dedup;
}

function flatOf(pts: { x: number; y: number }[]): number[] {
  const out = new Array<number>(pts.length * 2);
  for (let i = 0; i < pts.length; i++) {
    out[i * 2] = pts[i].x;
    out[i * 2 + 1] = pts[i].y;
  }
  return out;
}

export interface PieceFill {
  /** 三角形顶点 [x,y]×3×n（直绘） */
  tris: Float32Array;
  /** 面积自检通过（外环−洞 vs 三角形总面积）；false → 调用方走 stencil 兜底 */
  areaOk: boolean;
}

export interface RingSample {
  ring: DisplayRing;
  /** fill 模式采样点（与 fan 同源；已去尾重复点） */
  pts: Pt[];
}

/**
 * 环集（带采样点）→ 带洞填充三角化。
 * 只收闭合环（与 Canvas `if (ring.closed) fill` 同语义）；开环不参与填充。
 * 每个外环携其包含的洞桥接后 ear clip；三角形总面积与「外环−洞」面积比对自检
 * （剖分丢失/桥接自交在此拦住 → 调用方走 stencil 兜底）。
 */
export function triangulateRings(entries: RingSample[]): PieceFill | null {
  const closed = entries.filter((e) => e.ring.closed && e.pts.length >= 3);
  if (!closed.length) return null;
  const { outers, holes } = splitOuterHoleRings(closed.map((e) => e.ring) as unknown as MidRing[]);
  if (!outers.length) return null;
  // 采样点（几何唯一来源）；分类用环自身（拓扑属性），几何全用采样点
  const sampled = new Map<DisplayRing, Pt[]>();
  for (const e of closed) sampled.set(e.ring, e.pts);

  // 洞 → 所属外环（探针取洞采样点，包含测试对外环采样点）
  const holeByOuter = new Map<DisplayRing, Pt[][]>();
  for (const h of holes) {
    const hp = sampled.get(h) ?? h.pts;
    if (hp.length < 3) continue;
    const probe = hp[0];
    let best: DisplayRing | null = null;
    let bestArea = 0;
    for (const o of outers) {
      const op = sampled.get(o) ?? o.pts;
      if (pointInRing(probe.x, probe.y, op)) {
        const a = Math.abs(ringSignedArea(op));
        if (!best || a > bestArea) {
          best = o;
          bestArea = a;
        }
      }
    }
    if (best) {
      const arr = holeByOuter.get(best) ?? [];
      arr.push(hp);
      holeByOuter.set(best, arr);
    }
  }

  const parts: number[] = [];
  let expectArea = 0;
  for (const o of outers) {
    const op = sampled.get(o) ?? o.pts;
    if (op.length < 3) continue;
    const outerFlat = cleanPoly(flatOf(op));
    expectArea += Math.abs(signedAreaFlat(outerFlat));
    const holeFlats = (holeByOuter.get(o) ?? []).map((hp) => {
      const f = cleanPoly(flatOf(hp));
      expectArea -= Math.abs(signedAreaFlat(f));
      return f;
    });
    // 顶点布局 = [外环..., 洞1..., 洞2...]，与 triangulateShape 的索引空间一致
    const verts: number[] = outerFlat.slice();
    const holePts: Vector2[][] = [];
    for (const f of holeFlats) {
      if (f.length < 6) continue;
      const arr: Vector2[] = [];
      for (let i = 0; i < f.length; i += 2) arr.push(new Vector2(f[i], f[i + 1]));
      holePts.push(arr);
      for (let i = 0; i < f.length; i++) verts.push(f[i]);
    }
    const contour: Vector2[] = [];
    for (let i = 0; i < outerFlat.length; i += 2) contour.push(new Vector2(outerFlat[i], outerFlat[i + 1]));
    // three.ShapeUtils（内含 mapbox Earcut）：带洞三角化，O(n log n)、复杂边界稳健
    const faces = ShapeUtils.triangulateShape(contour, holePts);
    for (const [a, b, c] of faces) {
      for (const k of [a, b, c]) {
        parts.push(verts[k * 2], verts[k * 2 + 1]);
      }
    }
  }
  if (!parts.length) return null;
  const tris = Float32Array.from(parts);
  let triArea = 0;
  for (let i = 0; i + 5 < tris.length; i += 6) {
    triArea +=
      Math.abs(
        (tris[i + 2] - tris[i]) * (tris[i + 5] - tris[i + 1]) -
          (tris[i + 4] - tris[i]) * (tris[i + 3] - tris[i + 1]),
      ) / 2;
  }
  const denom = Math.max(Math.abs(expectArea), 1e-9);
  const areaOk = Math.abs(triArea - Math.abs(expectArea)) / denom < 0.02;
  return { tris, areaOk };
}
