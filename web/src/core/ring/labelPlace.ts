/**
 * 面内名称放置几何（LABEL_DESIGN_2026-10-04 包1 · R1/R2/R3 · P1/polylabel 网格近似）。
 *
 * 单源原则：输入 = **元素显示件的实绘环**（`getCellSetRingsCached` 的 piece 环，过边中点
 * Hermite），「文字是否在面内」与填充同用 evenodd 奇偶——判定与所画的面同一套几何，
 * 不另造第二份多边形（AGENTS §3 显示契约：元素边界是显示环，不是 cell 贴角多边形）。
 *
 * 分两段（因为「文字盒」随缩放变、「面」不随缩放变）：
 *  ① `buildLabelGeom` = **静态几何**（与缩放无关 → 按 `proj|件键` 缓存）：
 *     - 段表 + 按 y 行分桶（CSR）→ 点在面内 = O(该行段数)；
 *     - 每个「外环组件」建距离场（网格 chamfer 两遍扫描），取最宽阔的前几格中心作候选
 *       ——即 polylabel「pole of inaccessibility（最大内接点）」的网格近似：候选只需
 *       「够好地排序」，精确性由 ② 兜底（放不下就换下一位/不放，绝不误放）。
 *  ② `fits()` = **动态判定**（消费端按 px/scale 换算后调用）：文字盒 16 点（四角 + 每边
 *     三分点）逐点奇偶。用点测而不是「内接圆半径 ≥ 文字对角线」：后者会误杀走廊形/狭长面
 *     （圆小但盒子能躺进去），16 点判定对凹形与狭长都更准，且 16 次行扫描 ≈ 百来次运算。
 *
 * 放不下**不缩字号**（P8：缩字号会暗示要素等级不同）——降级链在消费端走，
 * 包1 到「换候选位 → 省略名称只留核心符号」为止。
 */
import type { MidRing } from './displayRing';

export interface LabelSlot {
  /** 投影空间候选点 */
  x: number;
  y: number;
  /** 到边界距离场估值（世界单位，仅用于候选排序与调试读数） */
  d: number;
}

/**
 * 文字盒的**单位偏移**（四角 + 每边三分点，共 16 点）——`fits`/`fitsRot` 共用同一组，
 * 保证「直排」与「旋转排」的判定语义一致（凹形边界可能从两角之间切入，只测四角会漏判）。
 */
const BOX_U: readonly (readonly [number, number])[] = [
  [-1, -1], [1, -1], [-1, 1], [1, 1],
  [-0.5, -1], [0, -1], [0.5, -1],
  [-0.5, 1], [0, 1], [0.5, 1],
  [-1, -0.5], [-1, 0], [-1, 0.5],
  [1, -0.5], [1, 0], [1, 0.5],
];

/** 狭长判定阈值（LABEL_DESIGN R4：长宽比 ≥ 2.5–3:1 才启用沿轴排布） */
export const ELONGATION_MIN = 2.5;
/** 中轴折线节点数 / 每节点法向采样档数（构建期算，与缩放无关） */
const SPINE_NODES = 7;
const SPINE_SAMPLES = 9;

/** 每个外环组件产出的候选数（消费端按序试放，放不下换下一个） */
const CANDS_PER_OUTER = 4;
/** 全部组件合计候选上限（防多部件元素撑爆逐帧判定） */
const CANDS_MAX = 12;
const ROWS_MIN = 8;
const ROWS_MAX = 64;
const SQRT2 = Math.SQRT2;

/** 面内放置几何：段表 + 行分桶（奇偶） + 候选点（最宽阔处） */
export class LabelGeom {
  /** 全部环的联合包围盒（视口粗筛用；单位=投影空间，与 cell 中心同域） */
  readonly bbox: { minX: number; maxX: number; minY: number; maxY: number };
  /** 候选放置点：按到边界距离降序 */
  readonly cands: LabelSlot[];
  /** 长宽比（主轴长 / 法向宽；PCA 求主方向）——≥ ELONGATION_MIN 视为狭长（R4）。构建末尾赋值 */
  elongation: number;
  /** 主轴方向（单位向量，投影空间）；非狭长 = null */
  axisU: { x: number; y: number } | null;
  /** 中轴折线（沿主轴等距取节点、每节点取法向上最宽处），投影空间；非狭长 = []。d=该点到边界距离 */
  spine: { x: number; y: number; d: number }[];
  /** 中轴折线总弧长（逐字排布的可用长度） */
  spineLen: number;
  /** 段表 [x1,y1,x2,y2,…]（闭合环含收口段） */
  private readonly segs: Float64Array;
  /** 行分桶 CSR：rowStart[nRows+1] / rowSegs[]（段下标） */
  private readonly rowStart: Int32Array;
  private readonly rowSegs: Int32Array;
  private readonly nRows: number;
  private readonly y0: number;
  private readonly rowH: number;

  constructor(init: {
    bbox: LabelGeom['bbox'];
    cands: LabelSlot[];
    segs: Float64Array;
    rowStart: Int32Array;
    rowSegs: Int32Array;
    nRows: number;
    y0: number;
    rowH: number;
    elongation?: number;
    axisU?: { x: number; y: number } | null;
    spine?: { x: number; y: number; d: number }[];
    spineLen?: number;
  }) {
    this.bbox = init.bbox;
    this.cands = init.cands;
    this.segs = init.segs;
    this.rowStart = init.rowStart;
    this.rowSegs = init.rowSegs;
    this.nRows = init.nRows;
    this.y0 = init.y0;
    this.rowH = init.rowH;
    this.elongation = init.elongation ?? 1;
    this.axisU = init.axisU ?? null;
    this.spine = init.spine ?? [];
    this.spineLen = init.spineLen ?? 0;
  }

  /** 点是否在填充内（evenodd，与元素填充同一奇偶规则） */
  inside(x: number, y: number): boolean {
    let row = Math.floor((y - this.y0) / this.rowH);
    if (!(row >= 0)) row = 0;
    else if (row >= this.nRows) row = this.nRows - 1;
    const s = this.segs;
    const end = this.rowStart[row + 1];
    let cnt = 0;
    for (let i = this.rowStart[row]; i < end; i++) {
      const o = this.rowSegs[i] * 4;
      const y1 = s[o + 1];
      const y2 = s[o + 3];
      if ((y1 > y) !== (y2 > y)) {
        const t = (y - y1) / (y2 - y1);
        if (s[o] + t * (s[o + 2] - s[o]) > x) cnt++;
      }
    }
    return (cnt & 1) === 1;
  }

  /**
   * 文字盒（含 pad，**投影空间单位**）是否完全落在填充内。
   * 16 点奇偶：四角 + 每边三分点——凹形边界可能从两角之间切入，仅测四角会漏判。
   */
  fits(x: number, y: number, w: number, h: number, pad: number): boolean {
    return this.boxTest(x, y, w, h, pad, 0);
  }

  /**
   * 旋转排布版（包4 R5）：文字盒绕自身中心转 `theta`（投影空间弧度）后是否仍在填充内。
   * 与 `fits` 同一组 16 点（BOX_U），只是逐点先旋转——沿长轴/中轴排字就靠它判定。
   */
  fitsRot(x: number, y: number, w: number, h: number, pad: number, theta: number): boolean {
    return this.boxTest(x, y, w, h, pad, theta);
  }

  private boxTest(x: number, y: number, w: number, h: number, pad: number, theta: number): boolean {
    const hw = w / 2 + pad;
    const hh = h / 2 + pad;
    const c = Math.cos(theta);
    const s = Math.sin(theta);
    for (const [ux, uy] of BOX_U) {
      const dx = ux * hw;
      const dy = uy * hh;
      const rx = theta === 0 ? x + dx : x + dx * c - dy * s;
      const ry = theta === 0 ? y + dy : y + dx * s + dy * c;
      if (!this.inside(rx, ry)) return false;
    }
    return true;
  }

  /** 点到最近边界的距离（O(段数)，构建期用：中轴节点取「法向上最宽处」） */
  radiusAt(x: number, y: number): number {
    const s = this.segs;
    let best = Infinity;
    for (let i = 0; i < s.length; i += 4) {
      const x1 = s[i];
      const y1 = s[i + 1];
      const dx = s[i + 2] - x1;
      const dy = s[i + 3] - y1;
      const l2 = dx * dx + dy * dy;
      let t = l2 > 0 ? ((x - x1) * dx + (y - y1) * dy) / l2 : 0;
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const px = x1 + t * dx - x;
      const py = y1 + t * dy - y;
      const d = px * px + py * py;
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  }

  /** 沿中轴折线按弧长取点（t ∈ [0, spineLen]）：返回位置与该处的**切线方向**（单位向量） */
  spineAt(t: number): { x: number; y: number; tx: number; ty: number } | null {
    const pts = this.spine;
    if (pts.length < 2 || this.spineLen <= 0) return null;
    let rest = Math.max(0, Math.min(t, this.spineLen));
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len <= 1e-9) continue;
      if (rest <= len) {
        const u = rest / len;
        const tx = (b.x - a.x) / len;
        const ty = (b.y - a.y) / len;
        return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, tx, ty };
      }
      rest -= len;
    }
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const len = Math.hypot(last.x - prev.x, last.y - prev.y) || 1;
    return { x: last.x, y: last.y, tx: (last.x - prev.x) / len, ty: (last.y - prev.y) / len };
  }
}

/**
 * 由实绘环构建放置几何。返回 null = 这个件没有可用的面内放置能力
 * （空环 / 退化包围盒 / 全是框补边环）——消费端据此**不画名称**。
 */
export function buildLabelGeom(rings: readonly MidRing[]): LabelGeom | null {
  // —— ① 段表 + 逐环包围盒 ——
  const buf: number[] = [];
  const ringBox: { minX: number; maxX: number; minY: number; maxY: number }[] = [];
  const used: number[] = [];
  for (let ri = 0; ri < rings.length; ri++) {
    const ring = rings[ri];
    // virtualFrom 段 = 框补段：**只排除于描边**，填充奇偶照样吃（见 hermite.ts）——
    // 这里判定的就是填充，所以一视同仁收进段表。
    const pts = ring.pts;
    const idx: number[] = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) idx.push(i);
    }
    if (idx.length < 3) continue;
    const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
    for (const i of idx) {
      const p = pts[i];
      if (p.x < box.minX) box.minX = p.x;
      if (p.x > box.maxX) box.maxX = p.x;
      if (p.y < box.minY) box.minY = p.y;
      if (p.y > box.maxY) box.maxY = p.y;
    }
    const closed = ring.closed !== false;
    const m = idx.length;
    for (let k = 0; k < (closed ? m : m - 1); k++) {
      const a = pts[idx[k]];
      const b = pts[idx[(k + 1) % m]];
      buf.push(a.x, a.y, b.x, b.y);
    }
    ringBox[ri] = box;
    used.push(ri);
  }
  if (!buf.length) return null;

  const bbox = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let i = 0; i < buf.length; i += 2) {
    const x = buf[i];
    const y = buf[i + 1];
    if (x < bbox.minX) bbox.minX = x;
    if (x > bbox.maxX) bbox.maxX = x;
    if (y < bbox.minY) bbox.minY = y;
    if (y > bbox.maxY) bbox.maxY = y;
  }
  const bw = bbox.maxX - bbox.minX;
  const bh = bbox.maxY - bbox.minY;
  if (!(bw > 0) || !(bh > 0)) return null;

  const nSeg = buf.length / 4;
  const segs = Float64Array.from(buf);

  // —— ② 按 y 行分桶（CSR）：点在面内只需扫本行 ——
  const nRows = Math.min(ROWS_MAX, Math.max(ROWS_MIN, Math.ceil(Math.sqrt(nSeg))));
  const y0 = bbox.minY;
  const rowH = bh / nRows;
  const rowStart = new Int32Array(nRows + 1);
  const rowCount = (yMin: number, yMax: number) => {
    let r0 = Math.floor((yMin - y0) / rowH);
    let r1 = Math.floor((yMax - y0) / rowH);
    if (!(r0 >= 0)) r0 = 0;
    if (r1 >= nRows) r1 = nRows - 1;
    if (r1 < r0) r1 = r0;
    return [r0, r1] as const;
  };
  for (let s = 0; s < nSeg; s++) {
    const o = s * 4;
    const yMin = Math.min(segs[o + 1], segs[o + 3]);
    const yMax = Math.max(segs[o + 1], segs[o + 3]);
    const [r0, r1] = rowCount(yMin, yMax);
    for (let r = r0; r <= r1; r++) rowStart[r + 1]++;
  }
  for (let r = 0; r < nRows; r++) rowStart[r + 1] += rowStart[r];
  const rowSegs = new Int32Array(rowStart[nRows]);
  const cursor = Int32Array.from(rowStart.subarray(0, nRows));
  for (let s = 0; s < nSeg; s++) {
    const o = s * 4;
    const [r0, r1] = rowCount(Math.min(segs[o + 1], segs[o + 3]), Math.max(segs[o + 1], segs[o + 3]));
    for (let r = r0; r <= r1; r++) rowSegs[cursor[r]++] = s;
  }

  const geom = new LabelGeom({
    bbox,
    cands: [],
    segs,
    rowStart,
    rowSegs,
    nRows,
    y0,
    rowH,
  });

  // —— ③ 候选点：外环组件各自建距离场取最宽阔格 ——
  geom.cands.push(...collectCandidates(geom, ringBox, used, segs, bbox, 12));
  if (!geom.cands.length) {
    // 细粒度重试（小面：粗网格的格心可能全落在面外）
    geom.cands.push(...collectCandidates(geom, ringBox, used, segs, bbox, 36));
  }

  // —— ④ 主轴与中轴（包4 R4/R5，**只在狭长面上建**，构建期算完进缓存）——
  // PCA 求主方向只用**面积最大的外环**：缝两侧的副本环会把主轴拉平成「横跨世界」。
  const outer = largestOuterPts(rings, ringBox, used);
  const axis = outer ? pcaAxis(outer) : null;
  if (axis) {
    geom.elongation = axis.elongation;
    if (axis.elongation >= ELONGATION_MIN) {
      const nodes = buildSpine(geom, axis);
      if (nodes.length >= 2) {
        geom.axisU = axis.u;
        geom.spine = nodes;
        let len = 0;
        for (let i = 0; i + 1 < nodes.length; i++) {
          len += Math.hypot(nodes[i + 1].x - nodes[i].x, nodes[i + 1].y - nodes[i].y);
        }
        geom.spineLen = len;
      }
    }
  }
  return geom;
}

/** 面积最大的外环点集（主组件）——PCA/中轴只在它上面做 */
function largestOuterPts(
  rings: readonly MidRing[],
  ringBox: ({ minX: number; maxX: number; minY: number; maxY: number } | undefined)[],
  used: readonly number[],
): { x: number; y: number }[] | null {
  let bestArea = -1;
  let best: { x: number; y: number }[] | null = null;
  for (const ri of used) {
    const box = ringBox[ri];
    if (!box) continue;
    const raw = rings[ri].pts;
    // 只取**真实边界段**：`virtualFrom` 之后是为填充补的人工框边（或整圈就是框轮廓），
    // 混进 PCA 会把主轴/长宽比拉到「横跨地图」，让普通元素被误判成狭长（包4 实测踩过）。
    const limit = rings[ri].virtualFrom !== undefined ? Math.min(rings[ri].virtualFrom, raw.length) : raw.length;
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < limit; i++) {
      const p = raw[i];
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) pts.push(p);
    }
    if (pts.length < 3) continue;
    let area = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      area += a.x * b.y - b.x * a.y;
    }
    area = Math.abs(area) / 2;
    if (area > bestArea) {
      bestArea = area;
      best = pts;
    }
  }
  return best;
}

/**
 * 点集 PCA 主方向（协方差主特征向量）+ 轴/法向坐标范围。
 * 长宽比 = 轴长 / 法向宽（R4 判据「2.5–3:1」）。
 */
function pcaAxis(pts: readonly { x: number; y: number }[]): {
  u: { x: number; y: number };
  cx: number;
  cy: number;
  minT: number;
  maxT: number;
  minN: number;
  maxN: number;
  elongation: number;
} | null {
  const n = pts.length;
  if (n < 3) return null;
  let cx = 0;
  let cy = 0;
  for (const p of pts) {
    cx += p.x;
    cy += p.y;
  }
  cx /= n;
  cy /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const u = { x: Math.cos(theta), y: Math.sin(theta) };
  const v = { x: -u.y, y: u.x };
  let minT = Infinity;
  let maxT = -Infinity;
  let minN = Infinity;
  let maxN = -Infinity;
  for (const p of pts) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    const t = dx * u.x + dy * u.y;
    const nn = dx * v.x + dy * v.y;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
    if (nn < minN) minN = nn;
    if (nn > maxN) maxN = nn;
  }
  const spanT = maxT - minT;
  const spanN = maxN - minN;
  if (!(spanT > 0)) return null;
  return { u, cx, cy, minT, maxT, minN, maxN, elongation: spanT / Math.max(spanN, 1e-9) };
}

/**
 * 中轴折线：沿主轴等距取节点，每节点在法向全宽上采样，取**面内且到边界最远**的点
 * （= 局部最宽处连线 ≈ 骨架）。狭长面的重复注记与逐字排布都以它为路径（R4/R5）。
 */
function buildSpine(
  geom: LabelGeom,
  axis: { u: { x: number; y: number }; cx: number; cy: number; minT: number; maxT: number; minN: number; maxN: number },
): { x: number; y: number; d: number }[] {
  const v = { x: -axis.u.y, y: axis.u.x };
  const spanT = axis.maxT - axis.minT;
  const spanN = axis.maxN - axis.minN;
  const nodes: { x: number; y: number; d: number }[] = [];
  for (let k = 0; k < SPINE_NODES; k++) {
    const t = axis.minT + ((k + 0.5) / SPINE_NODES) * spanT;
    let best: { x: number; y: number; d: number } | null = null;
    let bestD = -1;
    for (let j = 0; j < SPINE_SAMPLES; j++) {
      const nn = spanN > 0 ? axis.minN + ((j + 0.5) / SPINE_SAMPLES) * spanN : 0;
      const x = axis.cx + t * axis.u.x + nn * v.x;
      const y = axis.cy + t * axis.u.y + nn * v.y;
      if (!geom.inside(x, y)) continue;
      const d = geom.radiusAt(x, y);
      if (d > bestD) {
        bestD = d;
        best = { x, y, d };
      }
    }
    if (best) nodes.push(best);
  }
  return nodes;
}

/**
 * 候选点收集：
 * - 外环 = 包围盒不被任何其他环严格包含（孔/内含环自动排除；互不相容的多部件各自成组，
 *   于是「缝两侧的两半」都能各出候选——谁在视口里谁被选中，见消费端）。
 * - 距离场 = 网格 chamfer 两遍扫描（含 √2 对角），段落格置 0 → 每格到最近边界的近似距离；
 *   取降序前几格中心，要求**在面内**（奇偶）且相互间隔 ≥ 2 格（避免候选扎堆在同一个宽处）。
 */
function collectCandidates(
  geom: LabelGeom,
  ringBox: ({ minX: number; maxX: number; minY: number; maxY: number } | undefined)[],
  used: number[],
  segs: Float64Array,
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  cellsPerSide: number,
): LabelSlot[] {
  // 外环判定：不被别的环 bbox 严格包含
  const outers: number[] = [];
  for (const i of used) {
    const bi = ringBox[i]!;
    let nested = false;
    for (const j of used) {
      if (i === j) continue;
      const bj = ringBox[j]!;
      if (
        bj.minX <= bi.minX &&
        bj.maxX >= bi.maxX &&
        bj.minY <= bi.minY &&
        bj.maxY >= bi.maxY &&
        (bj.maxX - bj.minX > bi.maxX - bi.minX || bj.maxY - bj.minY > bi.maxY - bi.minY)
      ) {
        nested = true;
        break;
      }
    }
    if (!nested) outers.push(i);
  }

  const out: LabelSlot[] = [];
  for (const oi of outers) {
    const box = ringBox[oi]!;
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    if (!(w > 0) || !(h > 0)) continue;
    // 逐轴格宽：狭长面（w≫h）必须 ny=1 且格高=h——否则格心会落到 bbox 外，
    // 「最宽阔处」候选全军覆没（正是需要沿轴放名字的那类面）。
    const cs = Math.max(w, h) / cellsPerSide; // 仅作 chamfer 的等距近似
    const nx = Math.max(1, Math.min(64, Math.round(w / cs)));
    const ny = Math.max(1, Math.min(64, Math.round(h / cs)));
    if (nx * ny > 4096) continue;
    const cw = w / nx;
    const ch = h / ny;

    const INF = Number.MAX_VALUE;
    const d = new Float64Array(nx * ny).fill(INF);
    // 段落格置 0（段 bbox 与格相交即置 0——略保守，只影响排序不影响正确性）
    const nSeg = segs.length / 4;
    for (let s = 0; s < nSeg; s++) {
      const o = s * 4;
      const sx0 = Math.min(segs[o], segs[o + 2]);
      const sx1 = Math.max(segs[o], segs[o + 2]);
      const sy0 = Math.min(segs[o + 1], segs[o + 3]);
      const sy1 = Math.max(segs[o + 1], segs[o + 3]);
      if (sx1 < box.minX || sx0 > box.maxX || sy1 < box.minY || sy0 > box.maxY) continue;
      let c0 = Math.floor((sx0 - box.minX) / cw);
      let c1 = Math.floor((sx1 - box.minX) / cw);
      let r0 = Math.floor((sy0 - box.minY) / ch);
      let r1 = Math.floor((sy1 - box.minY) / ch);
      if (c0 < 0) c0 = 0;
      if (r0 < 0) r0 = 0;
      if (c1 > nx - 1) c1 = nx - 1;
      if (r1 > ny - 1) r1 = ny - 1;
      for (let r = r0; r <= r1; r++) {
        const row = r * nx;
        for (let c = c0; c <= c1; c++) d[row + c] = 0;
      }
    }
    // 两遍 chamfer（前向/后向，正交 1、对角 √2）
    for (let r = 0; r < ny; r++) {
      for (let c = 0; c < nx; c++) {
        const i = r * nx + c;
        let v = d[i];
        if (v === 0) continue;
        if (r > 0) {
          const t = d[i - nx] + 1;
          if (t < v) v = t;
          if (c > 0) {
            const t2 = d[i - nx - 1] + SQRT2;
            if (t2 < v) v = t2;
          }
          if (c < nx - 1) {
            const t2 = d[i - nx + 1] + SQRT2;
            if (t2 < v) v = t2;
          }
        }
        if (c > 0) {
          const t = d[i - 1] + 1;
          if (t < v) v = t;
        }
        d[i] = v;
      }
    }
    for (let r = ny - 1; r >= 0; r--) {
      for (let c = nx - 1; c >= 0; c--) {
        const i = r * nx + c;
        let v = d[i];
        if (v === 0) continue;
        if (r < ny - 1) {
          const t = d[i + nx] + 1;
          if (t < v) v = t;
          if (c > 0) {
            const t2 = d[i + nx - 1] + SQRT2;
            if (t2 < v) v = t2;
          }
          if (c < nx - 1) {
            const t2 = d[i + nx + 1] + SQRT2;
            if (t2 < v) v = t2;
          }
        }
        if (c < nx - 1) {
          const t = d[i + 1] + 1;
          if (t < v) v = t;
        }
        d[i] = v;
      }
    }

    // 降序取格；要求在面内 + 与已取格间隔 ≥2（Chebyshev）
    const order: { i: number; v: number }[] = [];
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (v > 0 && v < INF) order.push({ i, v });
    }
    order.sort((a, b) => b.v - a.v);
    const picked: { c: number; r: number }[] = [];
    for (const { i, v } of order) {
      if (picked.length >= CANDS_PER_OUTER) break;
      const c = i % nx;
      const r = (i - c) / nx;
      let sep = picked.length === 0;
      if (!sep) {
        sep = true;
        for (const p of picked) {
          if (Math.max(Math.abs(p.c - c), Math.abs(p.r - r)) < 2) {
            sep = false;
            break;
          }
        }
      }
      if (!sep) continue;
      const x = box.minX + (c + 0.5) * cw;
      const y = box.minY + (r + 0.5) * ch;
      if (!geom.inside(x, y)) continue; // 角落格可能在面外
      picked.push({ c, r });
      // d = **到边界的可靠下界**：chamfer 测的是「格心 → 含段格心」的网格路长，
      // 网格路长 ≥ 欧氏距离，再减半格对角线（段在那个格里的最坏位置）⇒ d ≤ 真实距离。
      // 于是「hypot(半宽,半高) ≤ d」可**免奇偶判定**直接断定放得下；
      // 「d < 半字高」也能可靠断定放不下（反之才需精确判定，如走廊形面）。
      out.push({ x, y, d: v * ((cw + ch) / 2) - Math.hypot(cw, ch) / 2 });
      if (out.length >= CANDS_MAX) return out;
    }
    void bbox;
  }
  out.sort((a, b) => b.d - a.d);
  return out.length > CANDS_MAX ? out.slice(0, CANDS_MAX) : out;
}
