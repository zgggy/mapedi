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
 * 地图外框：固定在投影空间 ±π / ±lat，**不随 contentOffset 移动**。
 * 「内容是否显示在地图上」只由这里 + ctx.clip 决定。
 */
export function frameRect(
  project: (ll: LonLat) => Pt,
  lat = FRAME_LAT,
): FrameRect {
  const a = project({ lon: -180, lat });
  const b = project({ lon: 180, lat });
  const c = project({ lon: 180, lat: -lat });
  const d = project({ lon: -180, lat: -lat });
  return {
    minX: Math.min(a.x, b.x, c.x, d.x),
    maxX: Math.max(a.x, b.x, c.x, d.x),
    minY: Math.min(a.y, b.y, c.y, d.y),
    maxY: Math.max(a.y, b.y, c.y, d.y),
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
export function worldCopyDxs(
  contentOffsetX: number,
  cam: CameraLike,
  viewWidth: number,
  period = WORLD_PERIOD,
  contentBounds?: { minX: number; maxX: number },
): number[] {
  const halfW = viewWidth / 2 / Math.max(cam.scale, 1e-6);
  const viewL = cam.x - halfW;
  const viewR = cam.x + halfW;
  // 展开后的内容大致占一个 period（再放宽半个 period 覆盖 unwrap 刺）
  const contentL = contentBounds?.minX ?? -period;
  const contentR = contentBounds?.maxX ?? period;
  // 内容 x 出现在视口：content + dx ∈ [viewL, viewR]
  const dxMin = viewL - contentR;
  const dxMax = viewR - contentL;
  const kMin = Math.floor((dxMin - contentOffsetX) / period);
  const kMax = Math.ceil((dxMax - contentOffsetX) / period);
  // 居中裁剪，避免相机远离原点时副本爆炸
  const kCenter = Math.round((cam.x - contentOffsetX) / period);
  const k0 = Math.max(kMin, kCenter - 2);
  const k1 = Math.min(kMax, kCenter + 2);
  const dxs: number[] = [];
  for (let k = k0; k <= k1; k++) dxs.push(contentOffsetX + k * period);
  const primary = contentOffsetX + kCenter * period;
  if (!dxs.some((d) => Math.abs(d - primary) < 1e-9)) dxs.push(primary);
  dxs.sort((a, b) => a - b);
  return dxs;
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
  lat = FRAME_LAT,
): LonLat {
  const fr = frameRect(project, lat);
  const dxs = worldCopyDxs(contentOffsetX, cam, cssW);
  let best: LonLat | null = null;
  let bestScore = Infinity;
  for (const dx of dxs) {
    const px = screenToContentX(sx, cam, cssW, dx);
    const py = screenToContentY(sy, cam, cssH);
    const ll = unproject(px, py);
    // 该 lonLat 在本副本下的屏幕位置
    const p = project(ll);
    const drawnX = worldToScreenX(p.x, cam, cssW, dx);
    const drawnY = worldToScreenY(p.y, cam, cssH);
    // 外框屏幕矩形
    const fL = worldToScreenX(fr.minX, cam, cssW, 0);
    const fR = worldToScreenX(fr.maxX, cam, cssW, 0);
    const fT = worldToScreenY(fr.minY, cam, cssH);
    const fB = worldToScreenY(fr.maxY, cam, cssH);
    const inside =
      drawnX >= fL - 1 && drawnX <= fR + 1 && drawnY >= fT - 1 && drawnY <= fB + 1;
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
