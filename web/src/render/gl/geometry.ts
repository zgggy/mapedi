/**
 * GL 元素几何（缓存层）—— 与 Canvas 路径共用同一套环语义。
 *
 * 一切几何只经 `core/ring/hermite` 采样（与 `ringPath2D` 同源）；
 * 几何按**环对象**缓存（WeakMap），相机变化零重算，缩放只改 uniform：
 * - fan：外部参考点三角扇（stencil 奇偶 = evenodd，含世界副本重叠不叠色）
 * - strip：描边条带 [base, dir]，宽度走 uHalfW uniform（用户单位）

 * 闭合语义只来自 hermite（willClose），不在此另立规则：
 * outline 模式遇 virtualFrom 跨界尾巴是**开环**，强制闭合 = 横跨地图的直线（「横线」bug）。
 */
import { GEOM_EPS } from '../../core/tolerances';
import type { DisplayRing } from '../../core/ring/displayRing';
import { sampleMidRing } from '../../core/ring/hermite';
import { triangulateRings, trianglesMatchRings } from './triangulate';

export interface Pt {
  x: number;
  y: number;
}

export interface RingGeo {
  /** fill 模式采样点（三角化与 fan 的同一几何来源） */
  fillPts: Pt[] | null;
  /** fill 奇偶三角组 [x,y]×3×n（stencil INVERT 用）：环自身 earcut（精确面积光栅）；
   *  面积自检失败回退外部参考点扇形（奇偶等价，光栅面积大） */
  xorTris: Float32Array | null;
  /** 描边条带 [baseX, baseY, dirX, dirY]×6/段；顶点 = base + dir·uHalfW */
  strip: Float32Array | null;
  /** 环包围盒（scissor 用） */
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
}

/**
 * 折线 → 描边条带（基点+单位方向；宽度由 uHalfW 施加）。
 * 每段端头沿切线外延 halfWidth 盖住连接处 ≈ round cap/join。
 */
function buildStripLayout(pts: Pt[], closed: boolean): Float32Array {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  if (segs < 1) return new Float32Array(0);
  const out = new Float32Array(segs * 24);
  let o = 0;
  const push = (bx: number, by: number, dx: number, dy: number): void => {
    out[o++] = bx; out[o++] = by; out[o++] = dx; out[o++] = dy;
  };
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const len = Math.hypot(sx, sy) || 1;
    const ux = sx / len;
    const uy = sy / len;
    const nx = uy;
    const ny = -ux;
    // 顶点 = base + dir * halfWidth（dir = ±u ±n 的合成）
    push(a.x, a.y, -ux - nx, -uy - ny);
    push(a.x, a.y, -ux + nx, -uy + ny);
    push(b.x, b.y, ux + nx, uy + ny);
    push(a.x, a.y, -ux - nx, -uy - ny);
    push(b.x, b.y, ux + nx, uy + ny);
    push(b.x, b.y, ux - nx, uy - ny);
  }
  return out;
}

/** 环 → 外部参考点三角扇（stencil INVERT 用；扇形奇偶 = evenodd = Canvas fill 隐式闭合） */
function buildFan(pts: Pt[]): Float32Array {
  const n = pts.length;
  if (n < 3) return new Float32Array(0);
  let minX = Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // 参考点只需在环外：包围盒正下方即保证外部（贴近包围盒 → 扇形光栅面积 ∝ 元素本身）
  const margin = Math.max(0.05, (maxY - minY) * 0.05);
  const refX = minX - margin;
  const refY = minY - margin;
  const out = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o = i * 6;
    out[o] = refX;
    out[o + 1] = refY;
    out[o + 2] = pts[i].x;
    out[o + 3] = pts[i].y;
    out[o + 4] = pts[j].x;
    out[o + 5] = pts[j].y;
  }
  return out;
}

const geoCache = new WeakMap<DisplayRing, Map<string, RingGeo>>();

/** 环几何（缓存）。mode='fill' → fan；'outline' → strip。 */
export function ringGeo(
  ring: DisplayRing,
  smooth: number,
  mode: 'fill' | 'outline',
): RingGeo | null {
  let byKey = geoCache.get(ring);
  if (!byKey) {
    byKey = new Map();
    geoCache.set(ring, byKey);
  }
  const key = `${mode}:${smooth.toFixed(2)}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  // 闭合条件 = hermite.appendMidRing 的 closePath 条件（唯一定义点）
  const willClose = ring.closed && (mode === 'fill' || ring.virtualFrom === undefined);
  const pts = sampleMidRing(ring, smooth, mode);
  if (willClose && pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < GEOM_EPS && Math.abs(a.y - b.y) < GEOM_EPS) pts.pop();
  }
  if (mode === 'outline' ? pts.length < 2 : pts.length < 3) return null;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // 逐环三角组（按环对象缓存 → 补丁只重建受牵连环）：earcut 精确面积光栅；
  // 面积自检失败回退外部参考点扇形（奇偶等价，包围盒级光栅）
  let xorTris: Float32Array | null = null;
  if (mode === 'fill') {
    const tri = triangulateRings([{ ring, pts }]);
    const ok = tri?.areaOk && trianglesMatchRings(tri.tris, [pts]);
    xorTris = ok ? tri!.tris : buildFan(pts);
  }
  const geo: RingGeo = {
    fillPts: mode === 'fill' ? pts : null,
    xorTris,
    strip: mode === 'outline' ? buildStripLayout(pts, willClose && pts.length >= 3) : null,
    bbox: { minX, maxX, minY, maxY },
  };
  byKey.set(key, geo);
  return geo;
}

/** cell 网格几何：条带顶点（按桶序）+ 均匀网格桶（视口裁剪用） */
export interface CellMeshGeo {
  data: Float32Array;
  /** 桶网格（投影空间；每桶顶点段连续，行主序） */
  minX: number;
  minY: number;
  cell: number;
  cols: number;
  rows: number;
  /** cols*rows*2：[vertStart, vertCount]（float 单位） */
  ranges: Int32Array;
  /** 长线段（跨度>桶格；极区框边等）不入桶——任何视口都画（float 单位 [start, count]） */
  wide: [number, number];
}

/**
 * cell 网格条带（按共享边去重——Canvas 单次 stroke 不双混，GL 重叠四边形会）。
 * 共享顶点经 projCache 的 snap 保证坐标逐位相同 → 原始值字符串键即可去重。
 * 按均匀桶收集（行主序、每桶段连续）→ 画前只取可见桶行，禁止整表直绘。
 */
export function buildCellMeshStrips(
  polys: (Float64Array | undefined)[],
  polarOutlines: Map<number, Float64Array>,
  period: number,
): CellMeshGeo {
  const seen = new Set<string>();
  const CELL = 0.35;
  // 先收集去重后的线段（含中点），再按桶归置；跨度>桶格的进 wide 段（防边界误裁）
  const segs: { s: Float32Array; mx: number; my: number }[] = [];
  const wides: Float32Array[] = [];
  let wideTotal = 0;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let id = 0; id < polys.length; id++) {
    const xy = polarOutlines.get(id) ?? polys[id];
    if (!xy || xy.length < 4) continue;
    const n = xy.length >> 1;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let x1 = xy[i * 2], y1 = xy[i * 2 + 1];
      let x2 = xy[j * 2], y2 = xy[j * 2 + 1];
      // 极区 frame 闭合边用 unwrap 版坐标（与 cellPolyPath2D 同口径）
      if (polarOutlines.has(id) && i === n - 1) {
        x2 += unwrapDelta(x1, x2, period);
      }
      const k1 = `${x1},${y1}`;
      const k2 = `${x2},${y2}`;
      const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const s = buildStripLayout([{ x: x1, y: y1 }, { x: x2, y: y2 }], false);
      if (Math.abs(x1 - x2) > CELL || Math.abs(y1 - y2) > CELL) {
        wides.push(s);
        wideTotal += s.length;
      } else {
        segs.push({ s, mx: (x1 + x2) / 2, my: (y1 + y2) / 2 });
      }
      if (x1 < minX) minX = x1;
      if (x2 < minX) minX = x2;
      if (x1 > maxX) maxX = x1;
      if (x2 > maxX) maxX = x2;
      if (y1 < minY) minY = y1;
      if (y2 < minY) minY = y2;
      if (y1 > maxY) maxY = y1;
      if (y2 > maxY) maxY = y2;
    }
  }
  if (!segs.length) {
    const wdata = new Float32Array(wideTotal);
    let wo = 0;
    for (const w of wides) {
      wdata.set(w, wo);
      wo += w.length;
    }
    return {
      data: wdata,
      minX: 0, minY: 0, cell: 1, cols: 1, rows: 1,
      ranges: new Int32Array(2),
      wide: [0, wideTotal],
    };
  }
  const cell = CELL;
  const cols = Math.max(1, Math.ceil((maxX - minX) / cell) + 1);
  const rows = Math.max(1, Math.ceil((maxY - minY) / cell) + 1);
  const buckets: { s: Float32Array; mx: number; my: number }[][] = new Array(cols * rows);
  for (const e of segs) {
    const i = Math.max(0, Math.min(cols - 1, Math.floor((e.mx - minX) / cell)));
    const j = Math.max(0, Math.min(rows - 1, Math.floor((e.my - minY) / cell)));
    const k = j * cols + i;
    let b = buckets[k];
    if (!b) {
      b = [];
      buckets[k] = b;
    }
    b.push(e);
  }
  let total = wideTotal;
  for (const e of segs) total += e.s.length;
  const data = new Float32Array(total);
  const ranges = new Int32Array(cols * rows * 2);
  let o = 0;
  for (let k = 0; k < cols * rows; k++) {
    const b = buckets[k];
    ranges[k * 2] = o;
    let cnt = 0;
    if (b) {
      for (const e of b) {
        data.set(e.s, o);
        o += e.s.length;
        cnt += e.s.length;
      }
    }
    ranges[k * 2 + 1] = cnt;
  }
  const wideStart = o;
  for (const w of wides) {
    data.set(w, o);
    o += w.length;
  }
  return { data, minX, minY, cell, cols, rows, ranges, wide: [wideStart, wideTotal] };
}

function unwrapDelta(refX: number, x: number, period: number): number {
  const half = period / 2;
  let v = x;
  while (v - refX > half) v -= period;
  while (v - refX < -half) v += period;
  return v - x;
}
