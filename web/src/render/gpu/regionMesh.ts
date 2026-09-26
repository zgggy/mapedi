/**
 * RegionMesh 数据层（GPU 后端地基；纯函数，无 GL 依赖）。
 *
 * 填充语义：元素 = cell 集合（evenodd 环只是派生视图）。Voronoi cell 凸 →
 * 每 cell 从中心扇形三角化即可，中空 = 缺 cell，天然等价，无需环挖洞三角化。
 * 边界/描边/内阴影 = 边界折线的细长四边形（WebGL lineWidth 不可靠，quad 是正道）。
 *
 * 平滑不变：边界是过边中点的 Hermite 曲线（`core/ring/hermite.ts` 唯一采样），
 * 这里只把采样折线四边形化——smooth 参数与 Canvas2D 版完全同源。
 */
import type { CellId } from '../../core/types';

export interface MeshBuffers {
  /** 三角形顶点 [x,y,...]，每 3 顶点一个三角形 */
  verts: Float32Array;
  /** 边界/描边四边形顶点 [x,y,...]，每 6 顶点（2 三角形）一段四边形 */
  edgeQuads: Float32Array;
}

/** cell 扇形三角化：polyXY 为投影多边形（闭合不重复首点），center 为扇心 */
export function fanTriangles(
  polyXY: Float64Array,
  cx: number,
  cy: number,
): Float32Array {
  const n = polyXY.length >> 1;
  if (n < 3) return new Float32Array(0);
  const out = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o = i * 6;
    out[o] = cx;
    out[o + 1] = cy;
    out[o + 2] = polyXY[i * 2];
    out[o + 3] = polyXY[i * 2 + 1];
    out[o + 4] = polyXY[j * 2];
    out[o + 5] = polyXY[j * 2 + 1];
  }
  return out;
}

/**
 * 折线 → 细长四边形串（描边/内阴影共用）。
 * halfWidth 为半宽（用户单位）；alpha0/alpha1 内阴影用（外缘→内缘渐隐）。
 */
export function segmentQuads(
  pts: { x: number; y: number }[],
  halfWidth: number,
  closed = true,
): Float32Array {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  if (segs < 1 || halfWidth <= 0) return new Float32Array(0);
  const out = new Float32Array(segs * 12);
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    // 法向（右偏 halfWidth）
    const nx = (dy / len) * halfWidth;
    const ny = (-dx / len) * halfWidth;
    const o = i * 12;
    // 三角形 1：a- a+ b+
    out[o] = a.x - nx; out[o + 1] = a.y - ny;
    out[o + 2] = a.x + nx; out[o + 3] = a.y + ny;
    out[o + 4] = b.x + nx; out[o + 5] = b.y + ny;
    // 三角形 2：a- b+ b-
    out[o + 6] = a.x - nx; out[o + 7] = a.y - ny;
    out[o + 8] = b.x + nx; out[o + 9] = b.y + ny;
    out[o + 10] = b.x - nx; out[o + 11] = b.y - ny;
  }
  return out;
}

/** 一组 cell 的填充三角形合并（每 cell 扇形；cellXY[i] = Float64Array 多边形） */
export function mergeFans(
  cellXY: Float64Array[],
  centers: Float64Array,
  ids: CellId[],
): Float32Array {
  const parts: Float32Array[] = [];
  let total = 0;
  for (let k = 0; k < ids.length; k++) {
    const poly = cellXY[ids[k]];
    if (!poly || poly.length < 6) continue;
    const fan = fanTriangles(poly, centers[ids[k] * 2], centers[ids[k] * 2 + 1]);
    if (fan.length) {
      parts.push(fan);
      total += fan.length;
    }
  }
  const out = new Float32Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
