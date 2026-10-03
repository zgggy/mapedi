/**
 * 显示空间（Display Space）
 *
 * 职责边界（与几何渲染解耦）：
 * - 几何层只负责「画出 cell / 边界 / 路径」的连续投影坐标，不判断是否穿过地图。
 * - 本模块统一处理：坐标 wrap/unwrap、世界副本（world copies）、地图外框、视口反算。
 *
 * 业界对应做法：
 * - MapLibre：线要素跨 180° 时对后续点 ±360 做 unwrap；`renderWorldCopies` 横向平铺世界。
 * - D3-geo：projection.stream 默认 preclip=antimeridian，postclip=clipExtent，几何与裁剪分层。
 * - OpenLayers：数据 CRS 不动，渲染时由 view/extent 决定显示范围与 wrap。
 */

import { EPS_FP, SCALE_FLOOR } from '../core/tolerances';
import {
  projectionFrameLat,
  projectionPeriodAt,
  projectionWraps,
  projectionXScale,
  type ProjectionId,
} from '../core/project/projections';

export type Pt = { x: number; y: number };
export type LonLat = { lon: number; lat: number };

/** 投影平面上 360° 经度对应的横向周期（墨卡托 x 以弧度计） */
export const WORLD_PERIOD = Math.PI * 2;

/**
 * 地图矩形外框纬度（度）——**裁剪框**。
 * 数值投影上限见 `core/project/mercator.PROJ_LAT_MAX`（89.5°，极冠顶点可高于本框）。
 * 二者只准各司其职，禁止再夹出第三套。
 */
export const FRAME_LAT = 85;

/** 将 x 折入 (-period/2, period/2] */
export function wrapPeriod(x: number, period = WORLD_PERIOD): number {
  const half = period / 2;
  let v = x;
  while (v > half) v -= period;
  while (v <= -half) v += period;
  return v;
}

/** 相对 ref 展开 x，使 |x-ref| 最小（MapLibre 跨日界线点处理） */
export function unwrapXAgainst(refX: number, x: number, period = WORLD_PERIOD): number {
  let v = x;
  const half = period / 2;
  while (v - refX > half) v -= period;
  while (v - refX < -half) v += period;
  return v;
}

/** 把投影点列链展开成连续折线（允许越出 ±π） */
export function unwrapChainX(pts: Pt[], period = WORLD_PERIOD): Pt[] {
  if (!pts.length) return [];
  const out: Pt[] = [{ x: pts[0].x, y: pts[0].y }];
  for (let i = 1; i < pts.length; i++) {
    out.push({
      x: unwrapXAgainst(out[i - 1].x, pts[i].x, period),
      y: pts[i].y,
    });
  }
  return out;
}

/** 段集合 → 连续点列（先把 b 相对 a 展开） */
export function unwrapSegments(
  segs: [Pt, Pt][],
  period = WORLD_PERIOD,
): [Pt, Pt][] {
  return segs.map(([a, b]) => {
    const aw = { x: a.x, y: a.y };
    return [aw, { x: unwrapXAgainst(aw.x, b.x, period), y: b.y }] as [Pt, Pt];
  });
}

export interface FrameRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * 地图外框 bbox：固定在投影空间，**不随 contentOffset 移动**。
 * 「内容是否显示在地图上」只由这里 + 裁剪（矩形 scissor / 轮廓 stencil）决定。
 *
 * 水平半宽取 **赤道与四角的较大者**：圆柱族 λ=±180 的 x 与纬度无关（两者同值，
 * 行为不变）；两极内收的伪圆柱（罗宾森）赤道最宽——旧纯四角法取到的是 ±lat 处
 * 的窄角，框比地图窄，赤道两侧大片内容被 scissor 裁掉。
 */
export function frameRect(
  project: (ll: LonLat) => Pt,
  lat = FRAME_LAT,
): FrameRect {
  const a = project({ lon: -180, lat });
  const b = project({ lon: 180, lat });
  const c = project({ lon: 180, lat: -lat });
  const d = project({ lon: -180, lat: -lat });
  const ex = Math.max(Math.abs(a.x), Math.abs(b.x), Math.abs(c.x), Math.abs(d.x),
    Math.abs(project({ lon: 180, lat: 0 }).x));
  return {
    minX: -ex,
    maxX: ex,
    minY: Math.min(a.y, b.y, c.y, d.y),
    maxY: Math.max(a.y, b.y, c.y, d.y),
  };
}

/**
 * ring 补边链路的 frameY 统一构造（normalize.prepareDisplayRings 入口）：
 * - `cylindrical` = 是否做绕行环补边 = 投影支持水平回绕（罗宾森开——绕极环在
 *   投影域断在左右轮廓必须封口；旧判据 `period!==null` 把罗宾森误关）。
 * - `periodAt` = 世界局部周期（伪圆柱 = scale(y)·2π），补边 seamX/winding 由此求；
 *   框宽只是圆柱族的等价缺省。
 */
export function frameYEnv(
  project: (ll: LonLat) => Pt,
  proj: ProjectionId,
): {
  minY: number; maxY: number; minX: number; maxX: number;
  cylindrical: boolean; periodAt: (y: number) => number; scaleAt: (y: number) => number;
} {
  const lat = projectionFrameLat(proj);
  const fr = frameRect(project, lat);
  const fallback = (): number => fr.maxX - fr.minX;
  return {
    ...fr,
    cylindrical: projectionWraps(proj),
    periodAt: (y: number) => projectionPeriodAt(proj, y) ?? fallback(),
    scaleAt: (y: number) => projectionXScale(proj, y) ?? 1,
  };
}

export interface CameraLike {
  x: number;
  y: number;
  scale: number;
}

/**
 * 世界副本的横向绘制偏移。
 *
 * drawDx = contentOffsetX + k * WORLD_PERIOD
 * 副本与 contentOffset **组合**；k 由「视口 ∩ 内容包围盒」反算。
 * 相机/contentOffset 可以不 wrap（拖动中 wrap 会瞬移），因此 k 不固定为 ±1。
 * contentL/R：内容在投影空间的大致包围（默认 ±period；可用 projCache.worldBBox 收紧）。
 */
/**
 * 内容在 y 处的投影域位移 = scale(y)·λ偏移（`x = scale(y)·λ` 的平移像）。
 * 圆柱族 scale 常数 → 退化为刚性平移（= 旧行为）；非回绕投影 λ偏移即投影域位移。
 */
export function contentOffsetAt(proj: ProjectionId, y: number, lambdaOff: number): number {
  const s = projectionXScale(proj, y);
  return s === null ? lambdaOff : s * lambdaOff;
}

/**
 * 世界副本 = **整数序号 k**（单一语义；投影域位移由 scale(y)·(Δλ+k·2π) 派生）。
 *
 * 罗宾森周期随纬度变 → 不存在常数 dx 副本；以内容 y 范围上的 scale 极值做
 * 保守相交判定（off 区间 = [sMin·T, sMax·T]，T=Δλ+k·2π）。
 * 数学前提：透镜轮廓宽 = 局部周期 → 副本逐纬度首尾相接（奇偶接缝精确）。
 */
/**
 * 副本位移区间：off = scale(y)·T 对 y 取值域的像（sLo/sHi 任意序，恒 lo≤hi）。
 * 单一原语（2026-10-04 拍板④：世界级 worldCopyKs 与件级 GL 过滤此前各写一遍）。
 */
export function copyOffRange(sLo: number, sHi: number, T: number): [number, number] {
  const lo = Math.min(sLo * T, sHi * T);
  const hi = Math.max(sLo * T, sHi * T);
  return [lo, hi];
}

/**
 * 副本占位与视口相交（世界级候选筛选与件级 copy 过滤**同一谓词**）：
 * 占位 = [minX+lo, maxX+hi] 与 (viewL, viewR) 相交（EPS 收边，取宽不取窄
 * ——漏画可见副本是缺口、多画微出屏副本无感）。
 * **历史坑（勿回退）**：交形式若只取「各 y 位移的公共核心」（maxX+lo / minX+hi），
 * 会把仅以剪切尖端入视的副本整件裁掉 → 罗宾森 + 平移下的渲染缺口/填充消失。
 */
export function copyIntersectsBox(
  minX: number,
  maxX: number,
  lo: number,
  hi: number,
  viewL: number,
  viewR: number,
): boolean {
  return maxX + hi > viewL - EPS_FP && minX + lo < viewR + EPS_FP;
}

export function worldCopyKs(
  panLambda: number,
  cam: CameraLike,
  viewWidth: number,
  proj: ProjectionId,
  contentBounds?: { minX: number; maxX: number; minY: number; maxY: number },
): number[] {
  if (!projectionWraps(proj)) return [0];
  const halfW = viewWidth / 2 / Math.max(cam.scale, SCALE_FLOOR);
  const viewL = cam.x - halfW;
  const viewR = cam.x + halfW;
  const cL = contentBounds?.minX ?? -Math.PI;
  const cR = contentBounds?.maxX ?? Math.PI;
  const y0 = contentBounds?.minY ?? -2;
  const y1 = contentBounds?.maxY ?? 2;
  let sMin = Infinity;
  let sMax = -Infinity;
  for (const y of [y0, (y0 + y1) / 2, y1]) {
    const s = projectionXScale(proj, y);
    if (s === null) return [0];
    sMin = Math.min(sMin, s);
    sMax = Math.max(sMax, s);
  }
  // T 的可行界（scale 恒正）：off = s·T 要让 [cL,cR] 平移后与视口相交
  const tA = (viewL - cR) / sMax;
  const tB = (viewR - cL) / sMin;
  const tLo = Math.min(tA, tB);
  const tHi = Math.max(tA, tB);
  const kMin = Math.floor((tLo - panLambda) / (Math.PI * 2)) - 1;
  const kMax = Math.ceil((tHi - panLambda) / (Math.PI * 2)) + 1;
  const ks: number[] = [];
  for (let k = kMin; k <= kMax && ks.length < 12; k++) {
    const T = panLambda + k * Math.PI * 2;
    const [lo, hi] = copyOffRange(sMin, sMax, T);
    // 内容平移后覆盖 [cL+lo, cR+hi]（off 随 scale 取区间），与视口相交即保留
    if (copyIntersectsBox(cL, cR, lo, hi, viewL, viewR)) ks.push(k);
  }
  if (!ks.length) ks.push(Math.round(-panLambda / (Math.PI * 2)));
  return ks;
}

/**
 * 外框轮廓多边形（未闭合，调用方闭合）：λ=±180 采样曲线 + 顶/底边。
 * 圆柱族 x=±kπ 常数 → 退化为矩形 4 角（与 frameRect 等价）；
 * 罗宾森 = 透镜（弧边 = 局部半宽 scale(y)·π，副本偏移下逐点重合 → 奇偶接缝精确）。
 * 消费方：evenodd 翻转外环、框外遮罩、GL stencil、命中判定——必须同源。
 */
export function frameOutline(
  project: (ll: LonLat) => Pt,
  proj: ProjectionId,
  lat = projectionFrameLat(proj),
): Pt[] {
  const N = proj === 'robinson' ? 48 : 1;
  const pts: Pt[] = [];
  for (let i = 0; i <= N; i++) {
    pts.push(project({ lon: 180, lat: -lat + (2 * lat * i) / N }));
  }
  for (let i = 0; i <= N; i++) {
    pts.push(project({ lon: -180, lat: lat - (2 * lat * i) / N }));
  }
  return pts;
}

/**
 * 统一坐标变换（唯一 y 翻转点）。
 * 投影空间 y 向上、屏幕 y 向下；所有坐标转换必须走此类。
 */
export class MapTransform {
  constructor(
    public cam: CameraLike,
    public w: number,
    public h: number,
    public drawDx = 0,
  ) {}

  /** 投影空间 → 屏幕空间 */
  worldToScreen(x: number, y: number): { sx: number; sy: number } {
    return {
      sx: (x + this.drawDx - this.cam.x) * this.cam.scale + this.w / 2,
      sy: -(y - this.cam.y) * this.cam.scale + this.h / 2,
    };
  }

  /** 屏幕空间 → 投影空间 */
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - this.w / 2) / this.cam.scale + this.cam.x - this.drawDx,
      y: -(sy - this.h / 2) / this.cam.scale + this.cam.y,
    };
  }

  /** Canvas 变换（beginWorld 用） */
  applyToCanvas(ctx: CanvasRenderingContext2D): void {
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.cam.scale, -this.cam.scale);
    ctx.translate(-this.cam.x + this.drawDx, -this.cam.y);
  }

  /** 屏幕 y 偏移量（周期贴图 yOff 用） */
  yOffFor(proxyY: number, texDisplayH: number): number {
    return (this.h - texDisplayH) / 2 + (this.cam.y - proxyY) * this.cam.scale;
  }
}

/** 投影内容点 → 屏幕 x（css 像素） */
export function worldToScreenX(
  x: number,
  cam: CameraLike,
  cssW: number,
  drawDx: number,
): number {
  return (x + drawDx - cam.x) * cam.scale + cssW / 2;
}

/** 投影内容点 → 屏幕 y（css 像素）；**y 翻转**：投影 y 向上、屏幕 y 向下 */
export function worldToScreenY(y: number, cam: CameraLike, cssH: number): number {
  return -(y - cam.y) * cam.scale + cssH / 2;
}

/** 屏幕 → 某个副本下的内容投影坐标 */
export function screenToContentX(
  sx: number,
  cam: CameraLike,
  cssW: number,
  drawDx: number,
): number {
  return (sx - cssW / 2) / cam.scale + cam.x - drawDx;
}

/** 屏幕 → 内容投影 y；**y 翻转** */
export function screenToContentY(sy: number, cam: CameraLike, cssH: number): number {
  return -(sy - cssH / 2) / cam.scale + cam.y;
}

/**
 * 屏幕点反算「被显示的」内容经纬度。
 * 优先选：该副本下内容点落在地图外框屏幕矩形内且距离点击最近。
 */
export function screenToContentLonLat(
  sx: number,
  sy: number,
  cam: CameraLike,
  cssW: number,
  cssH: number,
  contentOffsetX: number,
  unproject: (x: number, y: number) => LonLat,
  project: (ll: LonLat) => Pt,
  proj: ProjectionId = 'mercator',
  lat = FRAME_LAT,
): LonLat {
  const ks = worldCopyKs(contentOffsetX, cam, cssW, proj);
  const py = screenToContentY(sy, cam, cssH);
  // 副本位移是 y 依赖的 scale(y)·(Δλ+k·2π)：先解 y（与 x 无关），再按该 y 取位移——零迭代
  const outline = frameOutline(project, proj, lat); // 视口形状 = 轮廓（外框固定投影空间）
  let best: LonLat | null = null;
  let bestScore = Infinity;
  for (const k of ks) {
    const dx = contentOffsetAt(proj, py, contentOffsetX + k * Math.PI * 2);
    const px = screenToContentX(sx, cam, cssW, dx);
    const ll = unproject(px, py);
    // 该 lonLat 在本副本下的屏幕位置
    const p = project(ll);
    const drawnX = worldToScreenX(p.x, cam, cssW, dx);
    const drawnY = worldToScreenY(p.y, cam, cssH);
    // 外框内判定 = 投影域点在**轮廓**内（罗宾森=透镜弧边；旧矩形会让四角误判）
    const inside = pointInOutline(p.x, p.y, outline);
    const dist = Math.hypot(drawnX - sx, drawnY - sy);
    // 外框内优先，其次距离
    const score = inside ? dist : dist + 1e6;
    if (score < bestScore) {
      bestScore = score;
      best = {
        lon: wrapLon(ll.lon),
        lat: ll.lat,
      };
    }
  }
  return best ?? { lon: wrapLon(unproject(screenToContentX(sx, cam, cssW, contentOffsetX), screenToContentY(sy, cam, cssH)).lon), lat: unproject(screenToContentX(sx, cam, cssW, contentOffsetX), screenToContentY(sy, cam, cssH)).lat };
}

/** 点在轮廓多边形内（even-odd 射线法）；轮廓未闭合按首尾相连处理。 */
export function pointInOutline(x: number, y: number, outline: Pt[]): boolean {
  let inside = false;
  const n = outline.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = outline[i];
    const b = outline[j];
    if ((a.y > y) !== (b.y > y)) {
      const t = (y - a.y) / (b.y - a.y);
      if (x < a.x + t * (b.x - a.x)) inside = !inside;
    }
  }
  return inside;
}

export function wrapLon(lon: number): number {
  let v = lon;
  while (v > 180) v -= 360;
  while (v <= -180) v += 360;
  return v;
}

/**
 * 经纬环 → 连续投影环（显示几何，不判断是否在框内）。
 * 这是 projCache 与路径层共用的同一套 unwrap 约定。
 */
export function projectRing(
  ring: LonLat[],
  project: (ll: LonLat) => Pt,
): Pt[] {
  const pts: Pt[] = [];
  let prevLon = ring[0]?.lon ?? 0;
  for (let i = 0; i < ring.length; i++) {
    let lon = ring[i].lon;
    // 先在经纬度域展开，再投影，避免 ±180 长刺
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    prevLon = lon;
    pts.push(project({ lon, lat: ring[i].lat }));
  }
  return pts;
}

/** 量化点键（链化边界/海岸时用；**必须用 wrap 后的 x**，跨日界线同一顶点才能对上） */
export function ptKey(p: Pt): string {
  return `${Math.round(p.x * 1e5)},${Math.round(p.y * 1e5)}`;
}

/** 拓扑身份键：x 折入主周期，y 原样 */
export function vertexKey(p: Pt, period = WORLD_PERIOD): string {
  return ptKey({ x: wrapPeriod(p.x, period), y: p.y });
}

/**
 * 外框在「beginWorld 之后的用户空间」中的裁剪矩形。
 *
 * beginWorld 已把 drawDx 写进变换：用户坐标 px 显示为 px+drawDx。
 * 外框固定在投影空间 [minX,maxX]，故用户空间可见范围是 [minX-drawDx, maxX-drawDx]。
 * cell/边界只管画完整几何；是否落在图上由此矩形决定。
 */
export function frameClipInUserSpace(
  fr: FrameRect,
  drawDx: number,
): FrameRect {
  return {
    minX: fr.minX - drawDx,
    maxX: fr.maxX - drawDx,
    minY: fr.minY,
    maxY: fr.maxY,
  };
}

/**
 * 把线段集链成有序折线。
 *
 * 顶点身份用 **wrap 后** 的坐标（跨日界线的同一球面顶点在 ±π 两侧必须认成同一个点）；
 * 输出再 unwrap 成连续折线供描边。几何层不需要知道自己是否贴着地图边界。
 */
export function chainSegments(
  segs: [Pt, Pt][],
  period = WORLD_PERIOD,
): { pts: Pt[]; closed: boolean }[] {
  const chains: { pts: Pt[]; closed: boolean }[] = [];
  if (!segs.length) return chains;

  // 拓扑只用 wrap 键；邻接表存 wrap 后的代表点
  const adj = new Map<string, Pt[]>();
  const add = (from: Pt, to: Pt) => {
    const kf = vertexKey(from, period);
    const kt = vertexKey(to, period);
    const fw = { x: wrapPeriod(from.x, period), y: from.y };
    const tw = { x: wrapPeriod(to.x, period), y: to.y };
    let la = adj.get(kf);
    if (!la) {
      la = [];
      adj.set(kf, la);
    }
    la.push(tw);
    let lb = adj.get(kt);
    if (!lb) {
      lb = [];
      adj.set(kt, lb);
    }
    lb.push(fw);
  };
  for (const [a, b] of segs) add(a, b);

  const used = new Set<string>();
  const mark = (a: Pt, b: Pt) => {
    const ka = vertexKey(a, period);
    const kb = vertexKey(b, period);
    used.add(ka + '|' + kb);
    used.add(kb + '|' + ka);
  };
  const walk = (start: Pt, next: Pt): Pt[] => {
    const sw = { x: wrapPeriod(start.x, period), y: start.y };
    const nw = { x: wrapPeriod(next.x, period), y: next.y };
    const chain = [sw, nw];
    mark(sw, nw);
    let cur = nw;
    for (;;) {
      const k = vertexKey(cur, period);
      const nbs = adj.get(k);
      if (!nbs) break;
      let found: Pt | null = null;
      for (const cand of nbs) {
        if (used.has(k + '|' + vertexKey(cand, period))) continue;
        found = cand;
        break;
      }
      if (!found) break;
      mark(cur, found);
      chain.push(found);
      cur = found;
    }
    return chain;
  };

  for (const [a, b] of segs) {
    const ka = vertexKey(a, period);
    const kb = vertexKey(b, period);
    if (used.has(ka + '|' + kb)) continue;
    let chain = walk(a, b);
    const closed =
      chain.length > 2 &&
      vertexKey(chain[0], period) === vertexKey(chain[chain.length - 1], period);
    if (!closed) {
      const rev = walk(chain[chain.length - 1], chain[chain.length - 2]);
      rev.reverse();
      chain = rev.slice(0, -1).concat(chain);
    } else {
      chain = chain.slice(0, -1);
    }
    if (chain.length >= 2) {
      chains.push({ pts: unwrapChainX(chain, period), closed });
    }
  }
  return chains;
}
