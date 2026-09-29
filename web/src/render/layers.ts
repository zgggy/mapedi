import type { World } from '../core/types';
import type { StyleSet } from '../core/styles';
import type { Camera } from './map2d';
import {
  project,
  projSpecKey,
  projectionFrameLat,
  type ProjSpec,
  type ProjectionId,
  type ProjectionParams,
} from '../core/project/projections';
import type { ProjCache } from './projCache';
import {
  getCellSetRingsCached,
  hasPieceEntry,
} from './borderCache';
import { defaultExclusiveColor } from '../core/layer/style';
import { prepareDisplayRings } from '../core/ring/normalize';
import type { MidRing, DisplayRing } from '../core/ring/displayRing';
import {
  frameClipInUserSpace,
  frameRect,
  unwrapXAgainst,
  worldToScreenX,
  worldToScreenY,
  MapTransform,
  type Pt,
  frameYEnv,
  contentOffsetAt,
  frameOutline,
} from './space';
import { catmullRomPolyline } from '../core/paths';
import { ringPath2D, cellPolyPath2D } from '../core/ring/path2d';
import type { DisplayPiece } from '../core/displayCompose';
import { isLayerShown } from '../core/displayCompose';
import { dataRev } from '../core/rev';

export interface RenderEnv {
  ctx: CanvasRenderingContext2D;
  world: World;
  cam: Camera;
  hoverId: number | null;
  dpr: number;
  w: number;
  h: number;
  style: StyleSet;
  focus: string;
  proj: ProjSpec;
  pp: ProjectionParams;
  smooth: number;
  pcache: ProjCache;
  showLabels?: boolean;
  /**
   * 内容平移 = **经度偏移 Δλ**（回绕投影「转动地球经度」的重映射语义；
   * 非回绕投影保留投影域位移，由 offsetAt 退化解释）。
   */
  contentOffsetX?: number;
  /** 本 pass 的总经度偏移 = Δλ + k·2π（副本按 pass 循环赋值） */
  drawDx?: number;
  /** 本帧世界副本（整数序号 k；投影域位移由 offsetAt 点级派生） */
  copyKs?: number[];
  /** 点级内容位移：投影域 x 位移 = scale(y)·drawDx（圆柱族退化常数）。消费方唯一求值点。 */
  offsetAt?: (y: number) => number;
  /** 平移/缩放中：跳过脏区域重烘焙（贴图本身仍 1:1，不拉伸） */
  isDragging?: boolean;
  /** 渐现：冷件（环未预热）跳过并入队，空闲补热后由 onGeometryReady 触发重绘 */
  warmQueue?: DisplayPiece[];
  /** 单周期贴图的接缝余量；仅扩展离屏绘制裁剪，不改变地图外框 */
  periodicTilePadX?: number;
  /** 烘焙代理的裁剪补偿：viewport 模式内容位移折进了相机，裁剪需补内容偏移；
   *  period 模式是位置无关贴图（平铺即副本），必须为 0 */
  clipDxBias?: number;
  /** 选中 Region（边界加亮） */
  highlightRegionId?: string | null;
  /** 拖动中的路径 id：地图层不画它（避免与覆盖层幽灵曲线叠成双线） */
  hidePathId?: string | null;
  /** 多显示树叠画碎片（core/displayCompose） */
  displayPieces?: DisplayPiece[];
  /** 地块网格层（只描 cell 边） */
  showCellMesh?: boolean;
  /** 默认区域虚拟层（全海色 + 大陆边界） */
  useDefaultRegions?: boolean;
  /** 焦点层元素标签（跟图层） */
  focusLayerId?: string;
  /** 填充层显示样式（底部悬浮面板） */
  fillStyle?: import('../core/layer/style').ElementStyle;
  /** 按层查样式；缺省回退 fillStyle / 默认 */
  styleOf?: (layerId: string) => import('../core/layer/style').ElementStyle;
  /** 边界显示样式（底部悬浮面板） */
  borderStyle?: import('../core/types').LayerRenderConfig;
}

export interface RenderLayer {
  name: string;
  /**
   * 是否按世界副本重复绘制。
   * true：锚定在地图内容上的几何（cell/边界/路径…），由编排层循环 drawDx。
   * false：一次性层（bg/labels/frame），不参与副本。
   */
  repeat?: boolean;
  draw(env: RenderEnv): void;
}

export function projectPt(env: RenderEnv, ll: { lon: number; lat: number }) {
  return project(ll, env.proj, env.pp);
}

/** 地图外框 bbox（显示裁剪用；固定，不随内容偏移）；框高按投影（罗宾森 ±90） */
export function getFrameRect(env: RenderEnv) {
  return frameRect((ll) => projectPt(env, ll), projectionFrameLat(env.proj));
}

/**
 * 世界变换：**只含相机**（唯一 y 翻转点）。
 *
 * 内容平移不再进矩阵——平移是 y 依赖的重映射（罗宾森 scale(y)·Δλ），刚性
 * translate 表达不了；各层点级走 `env.offsetAt(y)`（圆柱族退化为常数 = 原行为）。
 * offsetX 保留给特殊调用方（烘焙补偿等）。
 */
export function beginWorld(
  ctx: CanvasRenderingContext2D,
  env: RenderEnv,
  offsetX = 0,
  _skipContent = false,
): void {
  ctx.save();
  const t = new MapTransform(env.cam, env.w, env.h, offsetX);
  t.applyToCanvas(ctx);
}

export function endWorld(ctx: CanvasRenderingContext2D): void {
  ctx.restore();
}

/**
 * 将当前路径裁剪到地图外框。
 *
 * 必须在 beginWorld **之后** 调用：此时用户空间已含 drawDx，
 * 因此外框矩形要按 -drawDx 补偿，才能裁到「屏幕上固定的那块矩形」。
 * cell/边界路径本身不判断是否在边界，框外部分只被这里裁掉。
 */
export function clipToMapFrame(ctx: CanvasRenderingContext2D, env: RenderEnv, drawDxOverride?: number): void {
  // 外框固定在投影空间（beginWorld 已不含内容平移）→ 直接裁**轮廓**：
  // 圆柱族轮廓=矩形（与旧等价）；罗宾森=透镜弧边（旧矩形会把赤道鼓出部分裁掉）。
  void drawDxOverride;
  const outline = frameOutline((ll) => projectPt(env, ll), env.proj);
  const pad = env.periodicTilePadX ?? 0;
  ctx.save();
  ctx.beginPath();
  if (pad > 0) {
    // 周期贴图接缝余量：矩形近似外扩（仅离屏烘焙用）
    const fr = getFrameRect(env);
    ctx.rect(fr.minX - pad, fr.minY, fr.maxX - fr.minX + pad * 2, fr.maxY - fr.minY);
  } else {
    ctx.moveTo(outline[0].x, outline[0].y);
    for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i].x, outline[i].y);
    ctx.closePath();
  }
  ctx.clip();
}

/**
 * 地图外框 + 框外遮罩。
 *
 * 问题：遮罩曾用手算屏幕矩形，与 beginWorld 内容矩阵不一致 → 黑洞偏在左上；描边易被遮罩盖没。
 * 原理：先强制 `setTransform(dpr)`，再 **同一 beginWorld** 画 evenodd 遮罩 + 描边。
 * 效果：黑洞与地图外框、内容同一坐标系；黑描边压在洞缘上，始终可见。
 */
export const frameLayer: RenderLayer = {
  name: 'frame',
  repeat: false,
  draw(env) {
    const { ctx, style, cam, w, h, dpr } = env;
    const fr = getFrameRect(env);
    const fw = fr.maxX - fr.minX;
    const fh = fr.maxY - fr.minY;
    const margin = Math.hypot(w, h) / Math.max(cam.scale, 1e-6) + 4;

    // 与 Viewport.render 相同的基矩阵，避免残余 transform
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    beginWorld(ctx, env, 0, true);

    // 框外遮罩（evenodd：外大矩形挖掉地图**轮廓**——罗宾森=透镜弧边，视口不再是方框）
    const outline = frameOutline((ll) => projectPt(env, ll), env.proj);
    ctx.beginPath();
    ctx.rect(fr.minX - margin, fr.minY - margin, fw + 2 * margin, fh + 2 * margin);
    ctx.moveTo(outline[0].x, outline[0].y);
    for (let i = 1; i < outline.length; i++) ctx.lineTo(outline[i].x, outline[i].y);
    ctx.closePath();
    ctx.fillStyle = style.frameVoid ?? 'rgba(8,10,14,0.92)';
    ctx.fill('evenodd');

    // 描边沿轮廓（先浅底再黑线，保证看得见）
    ctx.lineWidth = 2.5 / cam.scale;
    ctx.strokeStyle = 'rgba(240,235,220,0.35)';
    ctx.stroke();
    ctx.lineWidth = 1.4 / cam.scale;
    ctx.strokeStyle = style.border.color || 'rgba(0,0,0,0.85)';
    ctx.stroke();

    endWorld(ctx);
  },
};

/**
 * 地形底：**不做 cell 填充**。
 * 陆地轮廓色由 displayStack 边界内填充（高度层=大陆色，否则黄陆）。
 * 此层只画选中高亮的 cell 描边。
 */
export const cellsLayer: RenderLayer = {
  name: 'cells',
  repeat: true,
  draw(env) {
    const { ctx } = env;
    beginWorld(ctx, env);
    clipToMapFrame(ctx, env);
    ctx.restore();
    endWorld(ctx);
  },
};

/** ring 补边 frameY：wraps 投影都补（含罗宾森）；周期 = 局部 periodAt（单一真相源） */
function frameYOf(env: RenderEnv) {
  return frameYEnv((ll) => projectPt(env, ll), env.proj);
}

/** CSS 颜色 → [r,g,b,a]（0..1）。解析不了返回 null（非纯色解析失败即拒）。 */
export function cssToRgba(c: string): [number, number, number, number] | null {
  const hex = /^#?([0-9a-f]{6})$/i.exec(c || '');
  if (hex) {
    const v = parseInt(hex[1], 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
  }
  const short = /^#?([0-9a-f]{3})$/i.exec(c || '');
  if (short) {
    const s = short[1];
    const v = parseInt(s[0] + s[0] + s[1] + s[1] + s[2] + s[2], 16);
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i.exec(c || '');
  if (rgb) return [+rgb[1] / 255, +rgb[2] / 255, +rgb[3] / 255, rgb[4] === undefined ? 1 : +rgb[4]];
  return null;
}

/** 元素显示参数（样式链唯一解析结果）：GL 直绘唯一消费。（Canvas2D 管线已归档） */
export interface PieceParams {
  key: string;
  /** 唯一环语义源：fill / outline 都由它派生（禁止第二套环） */
  rings: DisplayRing[];
  /** 无环整框片（h0 全海底等）：矩形填充，无描边 */
  fullFrame: { color: string; alpha: number; minX: number; maxX: number; minY: number; maxY: number } | null;
  /** 是否画填充 */
  fillOn: boolean;
  fillColor: string | CanvasGradient;
  fillAlpha: number;
  stroke: string;
  /** 描边全宽（用户单位，已含选中放大 1.6）；0 = 不描 */
  strokeW: number;
  smooth: number;
  selected: boolean;
  copies: number[];
  /** px→用户单位换算 */
  camScale: number;
}

/**
 * 元素显示参数解析（**样式链唯一实现**）。
 * 两条渲染后端只准消费本结果，禁止各自再推一遍宽度 / 颜色 / 选中放大。
 */
export function buildPieceParams(env: RenderEnv): PieceParams[] {
  const { world, cam, style, displayPieces, highlightRegionId } = env;
  const out: PieceParams[] = [];
  if (!displayPieces?.length) return out;
  const styleOf =
    env.styleOf ??
    ((_id: string) =>
      env.fillStyle ?? {
        border: { enabled: true, width: style.border.width, color: style.border.color, smooth: 1 },
        fill: { enabled: true, alpha: 0.85, color: '#888' },
      });
  const project = (ll: { lon: number; lat: number }) => projectPt(env, ll);
  const fr = frameYOf(env);
  const copies = elementCopies(env);
  const regionById = new Map(world.regions.map((r) => [r.id, r]));
  const seenFill = new Set<string>();
  const seenBound = new Set<string>();
  // 同层多件共享一次样式解析（styleOf 可能做对象合并，按件×帧重算是热路径浪费）
  const styleByLayer = new Map<string, ReturnType<typeof styleOf>>();
  const styleOnce = (id: string) => {
    let hit = styleByLayer.get(id);
    if (!hit) {
      hit = styleOf(id);
      styleByLayer.set(id, hit);
    }
    return hit;
  };
  for (const dp of displayPieces) {
    const es = styleOnce(dp.layerId);
    const fillOn = es.fill.enabled !== false;
    const fillA = es.fill.alpha;
    const elOn = es.border.enabled !== false;
    const bw = Math.max(0, es.border.width);
    const elColor = es.border.color;
    const sm = es.border.smooth;

    const rid = dp.regionId;
    const sel = dp.regionSelected || highlightRegionId === rid;
    const setKey = `piece:${dp.key}`;
    // 渐现：环未预热的件先跳过（拖缓元素出现，不阻塞交互）；入队由空闲补热
    if (env.warmQueue && !hasPieceEntry(setKey, env.proj)) {
      env.warmQueue.push(dp);
      continue;
    }
    const entry = getCellSetRingsCached(world, dp.cellIds, project, env.proj, setKey);
    // 跳过判定（仅对有环元素）：
    // 1) 无环片（整框底色等）无包围盒语义，永不跳过；
    // 2) 有环片按**周期相交**判定——元素可经 k 个世界副本平移后落入窗口，
    //    取所有使 [b + k·per] 与脏区相交的 k（精确解，不设固定 ±2 上限）。
    const rings = entry.rings;
    // 湖泊/大陆都是普通元素，不特判中空
    if (!rings.length && entry.fullWorld && fillOn && !seenFill.has(dp.key)) {
      seenFill.add(dp.key);
      const pad = env.periodicTilePadX ?? 0;
      const alpha = Math.max(0, Math.min(1, fillA * (dp.opacity ?? 1)));
      // 与 clipToMapFrame 同口径：填充须覆盖「可见带」[fr − clipDxBias]——
      // 平移后可见带滑出绝对 ±π（副本区域），钉在 ±π 的填充会让副本带丢底色
      const bias = env.clipDxBias ?? 0;
      const fx = fr.minX - bias - pad;
      const fy = fr.minY;
      const fw = fr.maxX - fr.minX + pad * 2;
      const fh = fr.maxY - fr.minY;
      out.push({
        key: dp.key,
        rings: [],
        fullFrame: { color: dp.color, alpha, minX: fx, maxX: fx + fw, minY: fy, maxY: fy + fh },
        fillOn: true,
        fillColor: dp.color,
        fillAlpha: alpha,
        stroke: 'transparent',
        strokeW: 0,
        smooth: sm,
        selected: sel,
        copies,
        camScale: cam.scale,
      });
      continue;
    }
    if (!rings.length) continue;
    const prepared = preparePieces(env, rings, fr, entry.frameFlip);
    if (!prepared.length) continue;

    const needFill = fillOn && !seenFill.has(dp.key);
    const needBound = !seenBound.has(dp.key) || sel;
    if (!needFill && !needBound) continue;
    if (needFill) seenFill.add(dp.key);
    if (needBound && !sel) seenBound.add(dp.key);

    const region = regionById.get(rid);
    const excl =
      region?.exclusiveColor || defaultExclusiveColor(region?.color ?? '#888888');
    const strokeCol = region ? darkenHex(region.color, 0.7) : elColor;
    // 选中：边界必须可见（颜色覆盖为专属色，宽度给已配置宽），与「选中元素最顶」配套
    const strokeW = (sel || elOn) ? (bw * (sel ? 1.6 : 1)) / cam.scale : 0;
    out.push({
      key: dp.key,
      rings: prepared,
      fullFrame: null,
      fillOn: needFill,
      fillColor: dp.color,
      fillAlpha: fillA * (dp.opacity ?? 1),
      stroke: sel ? defaultExclusiveColor(region?.color ?? '#f0c36a') : (elOn ? strokeCol : 'transparent'),
      strokeW,
      smooth: sm,
      selected: sel,
      copies,
      camScale: cam.scale,
    });
  }
  return out;
}

/** raw MidRing[] → display pieces。键含 frameY，换投影不得复用旧 unwrap/闭合 */
const prepCache = new WeakMap<object, Map<string, DisplayRing[]>>();
function preparePieces(
  env: RenderEnv,
  rings: MidRing[],
  frameY: ReturnType<typeof frameYOf>,
  frameFlip = false,
): DisplayRing[] {
  const fk = `${env.proj}|${frameY.minX},${frameY.maxX},${frameY.minY},${frameY.maxY},${frameY.cylindrical}|${frameFlip ? 1 : 0}`;
  let byF = prepCache.get(rings as unknown as object);
  if (!byF) {
    byF = new Map();
    prepCache.set(rings as unknown as object, byF);
  }
  const cached = byF.get(fk);
  if (cached) return cached;
  const out: DisplayRing[] = [];
  for (const r of rings) {
    for (const piece of prepareDisplayRings(r, frameY)) {
      if (piece.pts.length >= 2) out.push(piece);
    }
  }
  // 框矩形外环：evenodd 翻转（奇偶探针判定，见 computeFrameFlip）——
  // 集合贴框/含极时外轮廓常缺失，补框环一次翻转即「盖成员、排非成员」。
  // pts = 四角 + virtualFrom = 0：全段走 lineTo 折线——这是**渲染临时几何**，
  // 不适用元素边界的「过边中点 Hermite」（Hermite 会把矩形啃成内接圆角，四角缺色）；
  // virtualFrom 同时把它排除出描边（框边只用于填充）。
  if (frameFlip) {
    // 翻转外环 = **外框轮廓**（frameOutline 单源：圆柱族=矩形退化，罗宾森=透镜弧边）。
    // 关键不变量：副本位移 scale(y)·k·2π 下轮廓边逐点重合（透镜半宽恰 = 局部半周期
    // scale(y)·π）→ 相邻副本精确接缝、无重叠带 → evenodd 不抵消。旧矩形宽是常数，
    // 伪圆柱下接缝必裂。余量 0（外扩 → 副本重叠带奇偶抵消 → 换日线竖条）。
    // pts 全段 lineTo（渲染临时几何，不走元素边界 Hermite）；virtualFrom=0 排除描边。
    const outline = frameOutline((ll) => projectPt(env, ll), env.proj);
    const n = outline.length;
    const verts: Pt[] = outline.map((_, i) => {
      const a = outline[i];
      const b = outline[(i + 1) % n];
      return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    });
    out.push({ pts: outline, verts, virtualFrom: 0, closed: true });
  }
  byF.set(fk, out);
  return out;
}

/** 投影空间路径折线缓存：points 签名 + 投影不变则跨帧复用（平移/缩放零重算） */
const pathPolyCache = new Map<string, { sig: string; poly: Pt[] }>();
function pathPointsSig(proj: ProjSpec, pp: unknown, points: { lon: number; lat: number }[]): string {
  let h = 2166136261;
  for (const p of points) {
    h = Math.imul(h ^ Math.round(p.lon * 1e6), 16777619);
    h = Math.imul(h ^ Math.round(p.lat * 1e6), 16777619);
  }
  return `${projSpecKey(proj)}|${JSON.stringify(pp ?? 0)}|${points.length}|${h >>> 0}`;
}

/** 标签文字宽度缓存（同字体同名跨帧复用） */
const labelWidthCache = new Map<string, number>();
/** 元素中心缓存：rev + id + cells 长度为键 */
const regionCenterCache = new Map<string, { x: number; y: number }>();

/** 元素级副本：在帧级 k 集上再展开 ±1（元素 bbox 比全图窄，需邻副本余量）。 */
function elementCopies(env: RenderEnv): number[] {
  const base = env.copyKs ?? [0];
  const indices = new Set<number>();
  for (const k of base) {
    indices.add(k - 1);
    indices.add(k);
    indices.add(k + 1);
  }
  return [...indices].sort((a, b) => a - b);
}

function darkenHex(hex: string, f = 0.6): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  return `rgb(${Math.floor(((v >> 16) & 255) * f)},${Math.floor(((v >> 8) & 255) * f)},${Math.floor((v & 255) * f)})`;
}

type Pt2 = Pt;

/** 过点曲线路径：道路（双线）/ 航线（虚线）/ 河流（渐粗） */
export const pathsLayer: RenderLayer = {
  name: 'paths',
  repeat: true,
  draw(env) {
    const { ctx, world, cam, focus } = env;
    if (!world.paths?.length) return;
    beginWorld(ctx, env);
    clipToMapFrame(ctx, env);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const path of world.paths) {
      if (path.hidden) continue;
      if (!path.points || path.points.length < 2) continue;
      // 拖动中的路径由覆盖层画：原曲线虚线 + 新曲线实线，地图层不重复画
      if (env.hidePathId && path.id === env.hidePathId) continue;
      const kind = path.layerId;
      const dim = focus === kind ? 1 : 0.45;
      ctx.globalAlpha = dim;

      // 投影空间折线缓存：points 签名+投影不变则跨帧/跨副本复用
      const psig = pathPointsSig(env.proj, env.pp, path.points);
      const cached = pathPolyCache.get(path.id);
      let poly = cached?.poly;
      if (!cached || cached.sig !== psig) {
        const ctrl: Pt[] = [];
        let prev: Pt | null = null;
        for (const ll of path.points) {
          const p = projectPt(env, ll);
          const u: Pt = prev
            ? { x: unwrapXAgainst(prev.x, p.x), y: p.y }
            : { x: p.x, y: p.y };
          ctrl.push(u);
          prev = u;
        }
        poly = catmullRomPolyline(ctrl, 10);
        pathPolyCache.set(path.id, { sig: psig, poly });
      }
      if (!poly || poly.length < 2) continue;

      const offAt = env.offsetAt;
      const strokePoly = (width: number, color: string, dash: number[]) => {
        ctx.beginPath();
        ctx.moveTo(poly[0].x + (offAt?.(poly[0].y) ?? 0), poly[0].y);
        for (let i = 1; i < poly.length; i++) {
          ctx.lineTo(poly[i].x + (offAt?.(poly[i].y) ?? 0), poly[i].y);
        }
        ctx.setLineDash(dash.map((d) => d / cam.scale));
        ctx.strokeStyle = color;
        ctx.lineWidth = width / cam.scale;
        ctx.stroke();
        ctx.setLineDash([]);
      };

      if (kind === 'road') {
        strokePoly(3.2, 'rgba(30,24,12,0.4)', []);
        strokePoly(1.5, path.color || '#e8c36a', []);
      } else if (kind === 'route') {
        strokePoly(2.0, 'rgba(20,40,60,0.3)', [2, 3]);
        strokePoly(1.3, path.color || '#7ec8e3', [7, 5]);
      } else {
        const w0 = (path.widthStart ?? 0.5) * 2.4;
        const w1 = (path.widthEnd ?? 1.0) * 2.4;
        const n = poly.length;
        for (let i = 0; i < n - 1; i++) {
          const t = i / (n - 1);
          const w = w0 + (w1 - w0) * t;
          const a = poly[i];
          const b = poly[i + 1];
          ctx.beginPath();
          ctx.moveTo(a.x + (offAt?.(a.y) ?? 0), a.y);
          ctx.lineTo(b.x + (offAt?.(b.y) ?? 0), b.y);
          ctx.strokeStyle = 'rgba(10,28,48,0.35)';
          ctx.lineWidth = (w * 1.45) / cam.scale;
          ctx.stroke();
          ctx.strokeStyle = path.color || '#3d8ec9';
          ctx.lineWidth = w / cam.scale;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    endWorld(ctx);
  },
};

/** 核心地块符号：按 LayerDef.coreSymbol 画 */
function drawCoreSymbol(
  ctx: CanvasRenderingContext2D,
  sym: 'star' | 'square' | 'circle',
  x: number,
  y: number,
  s: number,
  regionColor: string,
  style: { labels: Record<string, { color: string; halo?: string }> },
): void {
  if (sym === 'star') {
    ctx.fillStyle = style.labels.default?.color ?? '#ffe68c';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = style.labels.default?.halo ?? 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 0.8 * s;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.lineTo(x + s * 0.3, y - s * 0.3);
    ctx.lineTo(x + s, y - s * 0.2);
    ctx.lineTo(x + s * 0.4, y + s * 0.2);
    ctx.lineTo(x + s * 0.6, y + s);
    ctx.lineTo(x, y + s * 0.5);
    ctx.lineTo(x - s * 0.6, y + s);
    ctx.lineTo(x - s * 0.4, y + s * 0.2);
    ctx.lineTo(x - s, y - s * 0.2);
    ctx.lineTo(x - s * 0.3, y - s * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (sym === 'square') {
    const hs = s * 0.7;
    ctx.fillStyle = '#fff8c8';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 0.6 * s;
    ctx.beginPath();
    ctx.rect(x - hs, y - hs, hs * 2, hs * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    const rs = s * 0.65;
    ctx.fillStyle = regionColor;
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 0.7 * s;
    ctx.beginPath();
    ctx.arc(x, y, rs, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** 逐 cell 树点装饰 */
function drawTree(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  s: number,
  j: number,
): void {
  const tree = (tx: number, ty: number, ts: number, dark: boolean) => {
    ctx.fillStyle = dark ? '#1a4a28' : '#2d6b3f';
    ctx.beginPath();
    ctx.moveTo(tx, ty - ts);
    ctx.lineTo(tx + ts * 0.7, ty + ts * 0.4);
    ctx.lineTo(tx - ts * 0.7, ty + ts * 0.4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#4a3020';
    ctx.fillRect(tx - ts * 0.12, ty + ts * 0.35, ts * 0.24, ts * 0.35);
  };
  tree(x + j * s * 0.3, y - j * s * 0.2, s, j > 0.5);
  if (j > 0.6) tree(x - s * 0.8, y + s * 0.4, s * 0.85, false);
}

/**
 * 装饰层：元素名称 + 核心标记 + 逐 cell 装饰 + cell 标记。
 * 统一规则：
 * - 显示范围 = isLayerShown（与元素层同一规则）
 * - 显示内容由 LayerDef 配置决定（labelMode / coreSymbol / cellSymbol / cellMarker）
 * - 字体统一用 style.labels.default
 * - 缩放阈值：cam.scale < 90 不画装饰（避免缩小后密密麻麻）
 */
export const decorationsLayer: RenderLayer = {
  name: 'decorations',
  repeat: true,
  draw(env) {
    const { ctx, world, cam, style, focus, pcache, dpr, w, h, showLabels } = env;
    if (cam.scale < 90) return;
    const sc = style.symbols?.scale || 1;
    const font = style.labels.default;
    beginWorld(ctx, env);
    clipToMapFrame(ctx, env);
    // 屏幕坐标换算：MapTransform 只含相机；内容平移是 y 依赖重映射 → 点级 off(y)
    const tScreen = new MapTransform(cam, w, h, 0);
    const offAt = env.offsetAt;
    const lambdaOff = env.drawDx ?? env.contentOffsetX ?? 0;
    // 视口裁剪（装饰只画视口内 cell）：内容位移 y 依赖 → frame y 三点采样取位移极值，
    // 保守区间判定（漏画比错画安全）
    const frBox = getFrameRect(env);
    let sMin = Infinity;
    let sMax = -Infinity;
    for (const fy of [frBox.minY, (frBox.minY + frBox.maxY) / 2, frBox.maxY]) {
      const o = contentOffsetAt(env.proj, fy, lambdaOff);
      sMin = Math.min(sMin, o);
      sMax = Math.max(sMax, o);
    }
    const padV = 4 / Math.max(cam.scale, 1e-6);
    const vL = cam.x - sMax - w / 2 / cam.scale - padV;
    const vR = cam.x - sMin + w / 2 / cam.scale + padV;
    const vT = cam.y + h / 2 / cam.scale + padV;
    const vB = cam.y - h / 2 / cam.scale + padV;
    const inView = (id: number) => {
      const i4 = id * 4;
      return (
        pcache.bboxes[i4 + 1] >= vL &&
        pcache.bboxes[i4] <= vR &&
        pcache.bboxes[i4 + 2] <= vT &&
        pcache.bboxes[i4 + 3] >= vB
      );
    };

    for (const layer of world.layers) {
      const labelMode = layer.labelMode ?? 'none';
      const coreSym = layer.coreSymbol ?? 'none';
      const cellSym = layer.cellSymbol ?? 'none';
      const cellMarker = layer.cellMarker ?? 'none';
      if (labelMode === 'none' && coreSym === 'none' && cellSym === 'none' && cellMarker === 'none') continue;
      // baseMesh 层不进元素合成，但可以有装饰（cell 标记等）
      const shown = layer.baseMesh
        ? (focus === layer.id || layer.visible === true)
        : isLayerShown(world, layer.id, focus);
      if (!shown) continue;

      const regions = world.regions.filter((r) => r.layerId === layer.id);
      // baseMesh 层的 cellMarker 遍历所有 cell，不依赖 Region
      const needsRegions = labelMode !== 'none' || coreSym !== 'none' || cellSym !== 'none' ||
        (cellMarker !== 'none' && !layer.baseMesh);
      if (needsRegions && !regions.length) continue;

      // —— 元素名称 ——
      if (labelMode !== 'none' && showLabels !== false) {
        const occupied: { x: number; y: number; w: number; h: number }[] = [];
        const hitsBox = (bx: number, by: number, bw: number, bh: number) => {
          for (const o of occupied) {
            if (bx < o.x + o.w && bx + bw > o.x && by < o.y + o.h && by + bh > o.y) return true;
          }
          return false;
        };
        const place = (bx: number, by: number, bw: number, bh: number) => {
          occupied.push({ x: bx, y: by, w: bw, h: bh });
        };
        /** 屏幕坐标投影（走统一 MapTransform，标签随内容平移） */
        const toScreen = (x: number, y: number) =>
          tScreen.worldToScreen(x + (offAt?.(y) ?? 0), y);
        const regionCenter = (r: { id: string; cells: number[] }): { x: number; y: number } | null => {
          const key = `${dataRev()}|${r.id}|${r.cells.length}`;
          const hit = regionCenterCache.get(key);
          if (hit) return hit;
          const cells = r.cells;
          if (!cells.length) return null;
          let sx = pcache.centers[cells[0] * 2];
          let sy = pcache.centers[cells[0] * 2 + 1];
          for (let i = 1; i < cells.length; i++) {
            sx += pcache.centers[cells[i] * 2];
            sy += pcache.centers[cells[i] * 2 + 1];
          }
          const c = { x: sx / cells.length, y: sy / cells.length };
          if (regionCenterCache.size > 512) regionCenterCache.clear();
          regionCenterCache.set(key, c);
          return c;
        };

        // 标签在屏幕空间画（字号不随缩放）
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = `${font.size}px ${font.family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (const r of regions) {
          const c = regionCenter(r);
          if (!c) continue;
          const sp = toScreen(c.x, c.y);
          const name = labelMode === 'coreLabel' && (r.coreLabel ?? r.centerLabel) ? (r.coreLabel ?? r.centerLabel)! : r.name;
          if (!name) continue;
          const wkey = `${font.size}|${font.family}|${name}`;
          let tw = labelWidthCache.get(wkey);
          if (tw === undefined) {
            tw = ctx.measureText(name).width;
            if (labelWidthCache.size > 1024) labelWidthCache.clear();
            labelWidthCache.set(wkey, tw);
          }
          const bh = font.size + 8;
          if (hitsBox(sp.sx - tw / 2, sp.sy - bh / 2, tw, bh)) continue;
          if (font.halo) {
            ctx.strokeStyle = font.halo;
            ctx.lineWidth = 3;
            ctx.strokeText(name, sp.sx, sp.sy);
          }
          ctx.fillStyle = font.color;
          ctx.fillText(name, sp.sx, sp.sy);
          place(sp.sx - tw / 2, sp.sy - bh / 2, tw, bh);
        }
        ctx.restore();
      }

      // —— 核心标记 + 逐 cell 装饰 + cell 标记 ——
      if (coreSym !== 'none' || cellSym !== 'none' || cellMarker !== 'none') {
        const sc2 = (1.1 * sc) / cam.scale;

        if (coreSym !== 'none') {
          for (const r of regions) {
            const coreId = r.coreCellId ?? r.centerCellId;
            if (coreId === undefined) continue;
            const x = pcache.centers[coreId * 2];
            const y = pcache.centers[coreId * 2 + 1];
            drawCoreSymbol(ctx, coreSym, x + (offAt?.(y) ?? 0), y, sc2, r.color, style);
          }
        }

        if (cellSym === 'tree') {
          for (const r of regions) {
            for (const id of r.cells) {
              const cell = world.cells[id];
              if (!cell || !inView(id)) continue;
              const x = pcache.centers[id * 2];
              const y = pcache.centers[id * 2 + 1];
              drawTree(ctx, x + (offAt?.(y) ?? 0), y, (0.55 * sc) / cam.scale, ((id * 9973) % 100) / 100);
            }
          }
        }

        if (cellMarker !== 'none') {
          ctx.save();
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.font = `${Math.max(8, font.size - 4)}px ${font.family}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // baseMesh 层标记所有 cell；普通层标记所属元素的 cell
          // baseMesh 全量 cell 走惰性迭代（不每帧建 10 万级数组）
          const cellIds: Iterable<number> = layer.baseMesh
            ? (function* () {
                for (const c of world.cells) yield c.id;
              })()
            : [...new Set(regions.flatMap((r) => r.cells))];
          for (const id of cellIds) {
            const cell = world.cells[id];
            if (!cell || !inView(id)) continue;
            const x = pcache.centers[id * 2];
            const y = pcache.centers[id * 2 + 1];
            const label = cellMarker === 'id' ? String(id) : String(Math.round(cell.height));
            const sp = tScreen.worldToScreen(x + (offAt?.(y) ?? 0), y);
            if (sp.sx < -20 || sp.sx > w + 20 || sp.sy < -20 || sp.sy > h + 20) continue;
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText(label, sp.sx, sp.sy);
          }
          ctx.restore();
        }
      }
    }

    ctx.restore();
    endWorld(ctx);
  },
};


/**
 * 2D 辅助管线（GL 唯一后端下的余下层）：选中描边 → 路径 → 装饰（名称/标记） → 框。
 * bg / cellsMesh / elements 三通道由 GL 直绘（见 render/gl/mapRenderer），不再进 2D 管线。
 */
export const defaultPipeline: RenderLayer[] = [
  cellsLayer,
  pathsLayer,
  decorationsLayer,
  frameLayer,
];
