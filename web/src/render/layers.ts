import { SCALE_FLOOR } from '../core/tolerances';
import type { World, LabelMode, CoreSymbol, CellSymbol, CellMarker } from '../core/types';
import type { StyleSet } from '../core/styles';
import type { Camera } from './map2d';
import {
  project,
  projectionFrameLat,
  projectionWorldPeriod,
  type ProjectionId,
  type ProjectionParams,
} from '../core/project/projections';
import type { ProjCache } from './projCache';
import {
  getCellSetRingsCached,
  hasPieceEntry,
} from './borderCache';
import { defaultExclusiveColor } from '../core/layer/style';
import { heightToIntervalIndex } from '../core/layer/heightIntervals';
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
import { layerTreeOf } from '../core/hierarchy/derive';
import { isCJK, labelSpecOf, labelTextOf, type LabelSpec } from '../core/layer/labelStyle';
import { buildLabelGeom, ELONGATION_MIN, type LabelGeom } from '../core/ring/labelPlace';
import { coreCellOf } from '../core/regionCenter';
import { isLayerShown } from '../core/displayCompose';
import { dataRev } from '../core/rev';

// —— 装饰层缓存（2026-10-01 还债步骤6）：每层 region 列表 / cellMarker id 集
// 原为每帧每层 `world.regions.filter` + `flatMap+Set`（GC 热源）；改为 dataRev 键控、
// 惰性按层填充——每次数据编辑只重建可见层，帧内零分配。单线程帧内快照，读-only 消费。
let decorRev = '';
let decorRegionsByLayer = new Map<string, (World['regions'])[number][]>();
let decorMarkerByLayer = new Map<string, number[]>();
function decorRegionsOf(world: World, layerId: string): (World['regions'])[number][] {
  const rev = dataRev();
  if (rev !== decorRev) {
    decorRev = rev;
    decorRegionsByLayer = new Map();
    decorMarkerByLayer = new Map();
  }
  let hit = decorRegionsByLayer.get(layerId);
  if (!hit) {
    hit = world.regions.filter((r) => r.layerId === layerId);
    decorRegionsByLayer.set(layerId, hit);
  }
  return hit;
}
function decorMarkerIdsOf(world: World, layerId: string, regions: (World['regions'])[number][]): number[] {
  const rev = dataRev();
  if (rev !== decorRev) {
    decorRev = rev;
    decorRegionsByLayer = new Map();
    decorMarkerByLayer = new Map();
  }
  let hit = decorMarkerByLayer.get(layerId);
  if (!hit) {
    hit = [...new Set(regions.flatMap((r) => r.cells))];
    decorMarkerByLayer.set(layerId, hit);
  }
  return hit;
}

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
  proj: ProjectionId;
  pp: ProjectionParams;
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
  /** 增量烘焙的脏区（内容空间包围盒）：元素层跳过不相交元素 */
  dirtyBoxes?: { minX: number; maxX: number; minY: number; maxY: number }[];
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
    const margin = Math.hypot(w, h) / Math.max(cam.scale, SCALE_FLOOR) + 4;

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

/**
 * 元素渲染取色（2026-10-06）：数据色 `reg.color` 是唯一真相；风格带 `StyleSet.heightBands`
 * 定义时（羊皮纸）按高度区间覆盖——填色/描边/核心符号同走此函数，不改数据、暗色模式行为不变。
 */
function bandColorOf(
  style: StyleSet,
  region?: { color: string; attributes?: Record<string, unknown> },
): string {
  // 风格带（高度档）已是按风格调好的成品色 → 不再二次压饱和
  if (style.heightBands && region?.attributes?.kind === 'interval') {
    const lo = region.attributes.lo;
    if (typeof lo === 'number') return style.heightBands[heightToIntervalIndex(lo)] ?? region.color;
    return region.color;
  }
  const raw = region?.color ?? '#888';
  const k = style.desaturate;
  return k === undefined || k >= 1 ? raw : desaturateHex(raw, k);
}
/** 去饱和（保色相）+ 轻压亮：古地图淡彩。只认 #rrggbb；解析不了原样返回（护栏仅限格式） */
function desaturateHex(hex: string, keep: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
  const mid = (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
  // 向中点线性缩放：通道差 ×keep → 降饱和、保色相、中性色不变、单调（不跳变）
  const out = (c: number) => Math.round(mid + (c - mid) * keep);
  const hex2 = (c: number) => Math.max(0, Math.min(255, c)).toString(16).padStart(2, '0');
  return `#${hex2(out(r))}${hex2(out(g))}${hex2(out(b))}`;
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
// —— 每帧分配清零（2026-10-01 还债步骤6）：buildPieceParams 每帧 new Map/Set 是 GC 热源。
// 跨帧复用（clear+重填 = 零分配）；同步不可重入——全库无「在 buildPieceParams 调用栈内
// 再次调用它」的路径（帧渲染与 idle 预热都是同步直通）。out 保持每帧新数组（微分配，
// 持有方跨帧保存的唯一风险点，刻意不复用）。
const scratchRegionById = new Map<string, (World['regions'])[number]>();
const scratchSeenFill = new Set<string>();
const scratchSeenBound = new Set<string>();

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
  const regionById = scratchRegionById;
  regionById.clear();
  for (const r of world.regions) regionById.set(r.id, r);
  const seenFill = scratchSeenFill;
  seenFill.clear();
  const seenBound = scratchSeenBound;
  seenBound.clear();
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
    if (env.dirtyBoxes?.length && entry.rings.length) {
      const b = entry.bbox;
      const per = projectionWorldPeriod(env.proj) ?? Math.PI * 2;
      let hits = false;
      for (const r of env.dirtyBoxes) {
        if (b.maxY < r.minY || b.minY > r.maxY) continue;
        const kMin = Math.ceil((r.minX - b.maxX) / per);
        const kMax = Math.floor((r.maxX - b.minX) / per);
        if (kMin <= kMax) {
          hits = true;
          break;
        }
      }
      if (!hits) continue;
    }
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
      const bandFill = bandColorOf(env.style, regionById.get(rid));
      out.push({
        key: dp.key,
        rings: [],
        fullFrame: { color: bandFill, alpha, minX: fx, maxX: fx + fw, minY: fy, maxY: fy + fh },
        fillOn: true,
        fillColor: bandFill,
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
    const effColor = bandColorOf(env.style, region);
    const strokeCol = region ? darkenHex(effColor, 0.7) : elColor;
    // 选中：边界必须可见（颜色覆盖为专属色，宽度给已配置宽），与「选中元素最顶」配套
    const strokeW = (sel || elOn) ? (bw * (sel ? 1.6 : 1)) / cam.scale : 0;
    out.push({
      key: dp.key,
      rings: prepared,
      fullFrame: null,
      fillOn: needFill,
      fillColor: effColor,
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
const prepCache = new WeakMap<MidRing[], Map<string, DisplayRing[]>>();
function preparePieces(
  env: RenderEnv,
  rings: MidRing[],
  frameY: ReturnType<typeof frameYOf>,
  frameFlip = false,
): DisplayRing[] {
  const fk = `${env.proj}|${frameY.minX},${frameY.maxX},${frameY.minY},${frameY.maxY},${frameY.cylindrical}|${frameFlip ? 1 : 0}`;
  let byF = prepCache.get(rings);
  if (!byF) {
    byF = new Map();
    prepCache.set(rings, byF);
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
function pathPointsSig(proj: string, pp: unknown, points: { lon: number; lat: number }[]): string {
  let h = 2166136261;
  for (const p of points) {
    h = Math.imul(h ^ Math.round(p.lon * 1e6), 16777619);
    h = Math.imul(h ^ Math.round(p.lat * 1e6), 16777619);
  }
  return `${proj}|${JSON.stringify(pp ?? 0)}|${points.length}|${h >>> 0}`;
}

/** 标签文字宽度缓存（同字体同名跨帧复用） */
const labelWidthCache = new Map<string, number>();

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

/**
 * 核心符号屏幕半径（px）= 字号 × 倍率 × 主题符号缩放（R15：随字号，不再用固定 1.1px——
 * 旧值画出来直径只有 2px，图上几乎看不见）。倍率依据 LABEL_DESIGN §1.7 实测：
 * 首府符号直径 ≈ 0.8–1.05× 字号（CIA）、一般中心 0.4–0.55×（OSM）。
 */
function coreSymbolRadiusPx(sym: CoreSymbol, size: number): number {
  switch (sym) {
    case 'star':
    case 'hollowStar':
      return size * 0.5;
    case 'ring':
      return size * 0.35;
    case 'diamond':
      return size * 0.32;
    case 'square':
      return size * 0.3;
    case 'circle':
    default:
      return size * 0.28;
  }
}

/**
 * 核心地块符号：按 LayerDef.coreSymbol 画（`s` = **视觉半径**，世界空间单位——
 * 调用方按 `coreSymbolRadiusPx × symbols.scale ÷ cam.scale` 算好，故屏幕尺寸恒定）。
 * 描边居中于路径 → 路径半径按形状回缩，使**外缘**正好落在 R 上。
 */
function drawCoreSymbol(
  ctx: CanvasRenderingContext2D,
  sym: CoreSymbol,
  x: number,
  y: number,
  s: number,
  regionColor: string,
  style: { labels: Record<string, { color: string; halo?: string }> },
): void {
  if (sym === 'none' || s <= 0) return;
  const bright = style.labels.default?.color ?? '#ffe68c';
  const dark = style.labels.default?.halo ?? 'rgba(0,0,0,0.7)';
  const starPath = (r: number) => {
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.3, y - r * 0.3);
    ctx.lineTo(x + r, y - r * 0.2);
    ctx.lineTo(x + r * 0.4, y + r * 0.2);
    ctx.lineTo(x + r * 0.6, y + r);
    ctx.lineTo(x, y + r * 0.5);
    ctx.lineTo(x - r * 0.6, y + r);
    ctx.lineTo(x - r * 0.4, y + r * 0.2);
    ctx.lineTo(x - r, y - r * 0.2);
    ctx.lineTo(x - r * 0.3, y - r * 0.3);
    ctx.closePath();
  };
  if (sym === 'star') {
    // 实心星 = 国家首都。**先描边再填充**：描边是居中线，反过来画时 0.36R 宽的深色
    // 轮廓会向内吞掉细长星臂的亮色填充（15px 星实测只剩 4 个亮像素 = 几乎全黑）；
    // 反序后描边只留外半 → 亮星 + 深色外缘，外缘正好落在 R 上。
    ctx.strokeStyle = dark;
    ctx.lineWidth = s * 0.36;
    starPath(s * 0.82);
    ctx.stroke();
    ctx.fillStyle = bright;
    starPath(s * 0.82);
    ctx.fill();
  } else if (sym === 'hollowStar') {
    // 空心星 = 其他首府（省会）：元素色填充（视觉上"空"）+ 亮色轮廓
    ctx.fillStyle = regionColor;
    starPath(s * 0.82);
    ctx.fill();
    ctx.strokeStyle = bright;
    ctx.lineWidth = s * 0.36;
    ctx.stroke();
  } else if (sym === 'ring') {
    // 同心圆 ⊙ = 中心/圣城（OSM 首都样式）：环 + 亮色圆心
    ctx.fillStyle = regionColor;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = bright;
    ctx.lineWidth = s * 0.5;
    ctx.stroke();
    ctx.fillStyle = bright;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.32, 0, Math.PI * 2);
    ctx.fill();
  } else if (sym === 'diamond') {
    // 菱形：自定义地块标记同款（与行政符号族并列，包5）
    const r = s * 0.85;
    ctx.strokeStyle = dark;
    ctx.lineWidth = s * 0.4;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = bright;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r, y);
    ctx.closePath();
    ctx.fill();
  } else if (sym === 'square') {
    const r = s * 0.8;
    ctx.strokeStyle = dark;
    ctx.lineWidth = s * 0.4;
    ctx.beginPath();
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.stroke();
    ctx.fillStyle = bright;
    ctx.beginPath();
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fill();
  } else {
    // circle：元素色底 + 亮描边（一般中心，视觉最轻）
    ctx.fillStyle = regionColor;
    ctx.strokeStyle = bright;
    ctx.lineWidth = s * 0.5;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.75, 0, Math.PI * 2);
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
 * 注记放置统计：装饰层是 `repeat` 层，**按世界副本逐 pass 重入**——用帧号做令牌把
 * 各 pass 的计数并进同一帧（`__drawCount` 在 drawWorld 末尾自增 → 帧内恒定）。
 * 否则最后一个「远副本 pass（屏内无物）」会把可见 pass 的结果覆盖掉。
 */
interface LabelFrameStat {
  /** 帧令牌（= __drawCount） */
  frame: number;
  placed: number;
  hid: number;
  hidNoFit: number;
  hidCollide: number;
  noPiece: number;
  cold: number;
  off: number;
  /** 已放置项（name + 屏幕坐标）：验收/回归读数 */
  items: { id: string; name: string; tier: string; mode: string; angle: number; el: number; n: number; ls: number; sx: number; sy: number }[];
  /** 视口盒 [vL,vR,vB,vT]（世界 y 向上） */
  view: number[];
  /** 本帧画出的核心符号数（累加各副本 pass）——R14「符号先消失」验收读数 */
  syms: number;
  /** 用户自定义地块标记数（包5 验收读数） */
  marks: number;
  /** 符号读数：形状 + 屏幕坐标 + 视觉半径（验收用，封顶） */
  symbols: { sym: string; sx: number; sy: number; r: number }[];
  /** 放置几何构建归因：gate=冷件闸 / empty=环解析不出 / built=建成 */
  geom?: { gate: number; empty: number; built: number };
}
let labelFrameAcc: LabelFrameStat | null = null;
/** 帧级「已画名字的元素」：同一元素每帧只画一个名字（跨世界副本 pass 去重，2026-10-04 报障） */
let placedFrameNo = -1;
let placedIds = new Set<string>();

/**
 * 注记碰撞表（R13/R20）：屏幕空间均匀网格，**跨层共用一张**（原实现每层重置 occupied
 * → 下层名称会被上层压字）。cell 64px ≈ 4-6 个标签一格，命中后仍做精确盒判定。
 */
class BoxGrid {
  private readonly cell = 64;
  private readonly map = new Map<string, number[]>();
  private readonly boxes: { x: number; y: number; w: number; h: number }[] = [];

  add(x: number, y: number, w: number, h: number): void {
    const i = this.boxes.length;
    this.boxes.push({ x, y, w, h });
    this.eachCell(x, y, w, h, (k) => {
      const a = this.map.get(k);
      if (a) a.push(i);
      else this.map.set(k, [i]);
    });
  }

  hits(x: number, y: number, w: number, h: number): boolean {
    let found = false;
    this.eachCell(x, y, w, h, (k) => {
      if (found) return;
      const a = this.map.get(k);
      if (!a) return;
      for (const j of a) {
        const o = this.boxes[j];
        if (x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y) {
          found = true;
          return;
        }
      }
    });
    return found;
  }

  private eachCell(x: number, y: number, w: number, h: number, cb: (k: string) => void): void {
    const c0 = Math.floor(x / this.cell);
    const c1 = Math.floor((x + w) / this.cell);
    const r0 = Math.floor(y / this.cell);
    const r1 = Math.floor((y + h) / this.cell);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cb(`${c},${r}`);
  }
}

/**
 * 一件注记（包4）：投影空间锚点 + **方向点**（dx,dy 单位向量）——屏幕角由消费端用
 * `toScreen(锚点)` 与 `toScreen(锚点+方向)` 两点求 atan2，天然吸收投影形变与 y 翻转
 * （解析求导会被罗宾森 scale(y)·Δλ 的 y 依赖坑掉）。
 */
interface LabelItemAt {
  x: number;
  y: number;
  dx: number;
  dy: number;
  text: string;
  /** 字距拉伸（em，0=档位常规字距）：狭长面**一个名字沿长轴铺开**（2026-10-04 用户否掉重复注记） */
  ls?: number;
}

/** 布局结果；mode=null 表示全部失败（blocked 区分「放不下」与「被占位」） */
interface LabelLayout {
  mode: 'flat' | 'stretch' | 'curve' | null;
  items: LabelItemAt[];
  blocked: boolean;
}

/**
 * 选一个排布（LABEL_DESIGN 包4 · R4/R5；**2026-10-04 用户拍板：不要重复注记，改「拉伸字距」**）：
 *  - **非狭长** → 只走现状的水平直排（最宽处候选 + 局部细化），行为零变化；
 *  - **狭长**（长宽比 ≥ 2.5）→ ①**一个名字沿长轴**：轴向旋转 + 字距拉伸铺开
 *    （每字符额外间距上限：中文 1×字大、西文 0.5em——调研 B3；拉伸放不下就退回常规字距）
 *    → ②**逐字弯曲**（整串沿中轴弧长贴合，相邻字转角滑动窗口 ≤25°、不倒置）
 *    → ③退回水平 → ④省略。
 * `place(items, union)` = 屏幕空间碰撞检查（union=true 时按整串联合盒判）。
 */
function pickLabelLayout(
  geom: LabelGeom,
  text: string,
  textW: number,
  size: number,
  padPx: number,
  scale: number,
  measure: (t: string) => number,
  place: (items: LabelItemAt[], union: boolean) => boolean,
  specSpacingEm: number,
): LabelLayout {
  const w = textW / scale;
  const h = size / scale;
  const pad = padPx / scale;
  let blocked = false;

  if (geom.elongation >= ELONGATION_MIN && geom.spine.length >= 2 && geom.axisU) {
    const u = geom.axisU;
    const theta = Math.atan2(u.y, u.x);
    const n = Array.from(text).length || 1;
    // 拉伸上限（调研 B3）：中文 1×字大/字符、西文 0.5em/字符；目标宽 = min(自然宽+上限, 轴向可用)
    const gapMax = isCJK(text) ? size : size * 0.5;
    const axisLen = Math.max(0, geom.spineLen * scale - padPx * 2); // 轴向可用长度（px）
    // 量宽含档位字距的尾距 → 还原「无字距自然宽」，拉伸后总宽才与目标一致
    const natural = textW - n * specSpacingEm * size;
    const wStretch = Math.min(natural + n * gapMax, axisLen);
    // 按局部宽度（节点 d）降序试锚点：最宽处先放
    const nodes = [...geom.spine].sort((a, b) => b.d - a.d);
    // 阶梯回落：一步到顶常因「锚点局部不够宽」全失败 → 退回自然宽（视觉=没拉伸）；
    // 分三档试，保证拿到「能放下的最大拉伸」。
    const attempts =
      wStretch > natural
        ? [wStretch, natural + (wStretch - natural) * 0.5, natural]
        : [natural];
    for (const node of nodes) {
      for (const wTry of attempts) {
        const ls = wTry > natural ? (wTry - natural) / (n * size) : 0;
        if (!geom.fitsRot(node.x, node.y, wTry / scale, h, pad, theta)) continue;
        const it: LabelItemAt = { x: node.x, y: node.y, dx: u.x, dy: u.y, text, ls };
        if (!place([it], false)) {
          blocked = true;
          continue;
        }
        return { mode: 'stretch', items: [it], blocked };
      }
    }
    // 轴向整体放不下 → 逐字沿中轴贴合
    const curve = curveLayout(geom, text, w, h, pad, size, scale, measure, place);
    if (curve) return { mode: 'curve', items: curve, blocked };
  }

  const slot = pickLabelSlot(geom, textW, size, padPx, scale, (x, y) =>
    place([{ x, y, dx: 1, dy: 0, text }], false),
  );
  if (slot.slot) {
    return { mode: 'flat', items: [{ x: slot.slot.x, y: slot.slot.y, dx: 1, dy: 0, text }], blocked: slot.blocked || blocked };
  }
  return { mode: null, items: [], blocked: slot.blocked || blocked };
}

/** 逐字沿中轴排布（R5）：整串放得下 + 逐字在面内 + 相邻字转角窗口 ≤25° + 不倒置 */
function curveLayout(
  geom: LabelGeom,
  text: string,
  w: number,
  h: number,
  pad: number,
  size: number,
  scale: number,
  measure: (t: string) => number,
  place: (items: LabelItemAt[], union: boolean) => boolean,
): LabelItemAt[] | null {
  const L = geom.spineLen;
  if (!(L > 0)) return null;
  const chars = Array.from(text);
  if (!chars.length) return null;
  const adv = chars.map((c) => measure(c) / scale);
  const total = adv.reduce((a, b) => a + b, 0);
  if (total > L) return null;
  const items: LabelItemAt[] = [];
  const winArc = Math.max(1e-9, (size * 0.6) / scale); // 窗口 ≈ 3/5 字高（MapLibre 同款）
  const maxA = (25 * Math.PI) / 180; // QGIS/Mapnik 档位（R5）
  let t = (L - total) / 2;
  let prev: number | null = null;
  let win: { at: number; d: number }[] = [];
  let sum = 0;
  for (let i = 0; i < chars.length; i++) {
    const cw = adv[i];
    const p = geom.spineAt(t + cw / 2);
    if (!p) return null;
    const ang = Math.atan2(p.ty, p.tx);
    if (Math.abs(ang) > Math.PI / 2) return null; // 不倒置：轴向反了就整串放弃
    if (prev !== null) {
      let d = ang - prev;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      win.push({ at: t, d });
      sum += d;
      while (win.length > 1 && t - win[0].at > winArc) sum -= win.shift()!.d;
      if (Math.abs(sum) > maxA) return null;
    }
    prev = ang;
    if (!geom.fitsRot(p.x, p.y, cw, h, pad, ang)) return null;
    items.push({ x: p.x, y: p.y, dx: p.tx, dy: p.ty, text: chars[i] });
    t += cw;
  }
  if (!place(items, true)) return null;
  return items;
}

/**
 * 面内放置几何缓存（R19）：键 = `投影|件键`，**不含缩放**（候选点是纯几何）；
 * 判活 = `cells` 数组引用（本项目写入全 COW 换数组 → O(1) 失效，不扫内容）。
 * 环未预热（渐现冷件）时返回 null：名称随元素一起补热后出现，不阻塞首帧。
 */
interface LabelGeomCell {
  cellsRef: readonly number[];
  geom: LabelGeom | null;
}
const labelGeomCache = new Map<string, LabelGeomCell>();
/** 放置几何构建原因计数（诊断：区分「冷件闸」与「环解析不出几何」） */
const labelGeomStat = { gate: 0, empty: 0, built: 0 };
function labelGeomOf(env: RenderEnv, dp: DisplayPiece): LabelGeom | null {
  const key = `${env.proj}|${dp.key}`;
  const hit = labelGeomCache.get(key);
  if (hit && hit.cellsRef === dp.cellIds) return hit.geom;
  if (labelGeomCache.size > 1024) labelGeomCache.clear();
  const setKey = `piece:${dp.key}`;
  if (env.warmQueue && !hasPieceEntry(setKey, env.proj)) {
    labelGeomStat.gate++;
    return null;
  }
  const entry = getCellSetRingsCached(
    env.world,
    dp.cellIds,
    (ll) => projectPt(env, ll),
    env.proj,
    setKey,
  );
  // 吃**与实绘同一份** preparePieces（unwrap/框闭合/frameFlip 框环全在内）：
  // 判定的「面内」必须等于画出来的填充（单源，AGENTS §3/§9.3）。preparePieces 自带
  // WeakMap 缓存，按 rings 数组身份命中。
  const prepared = preparePieces(env, entry.rings, frameYOf(env), entry.frameFlip);
  const geom = buildLabelGeom(prepared);
  if (geom) labelGeomStat.built++;
  else labelGeomStat.empty++;
  labelGeomCache.set(key, { cellsRef: dp.cellIds, geom });
  return geom;
}

/**
 * 选一个能放下文字的放置点（P8 降级链第一步 = 候选位轮换）：
 * ① 逐候选（按「最宽阔」降序）试放；② 全失败 → 在前两个候选附近按**文字尺寸**为步长
 * 局部细化再试（候选是网格近似，最宽处可能落在两格之间）；③ 仍失败 → null，消费端
 * **省略名称**（保留核心符号）。文字盒 = px/scale（字号是屏幕恒定 → 判定天然随缩放变化：
 * 放大到放得下就出现，正是想要的）。判定早退（首点失败即返回），逐帧成本百来次运算。
 */
function pickLabelSlot(
  geom: LabelGeom,
  textW: number,
  textH: number,
  padPx: number,
  scale: number,
  /** 额外筛选：放得下 **且** 没被别的注记/符号占位（P8「候选位轮换」逐个试，不是只试一个） */
  filter?: (x: number, y: number) => boolean,
): { slot: { x: number; y: number; d: number } | null; blocked: boolean } {
  const w = textW / scale;
  const h = textH / scale;
  const pad = padPx / scale;
  const need = h / 2 + pad; // 内接半径下限：连「零宽的一行字」都放不下
  const diag = Math.hypot(w / 2, h / 2) + pad; // 居中放入所需的半径
  let anyFits = false; // 归因：有位置放得下却被占位 = blocked（否则 = 根本放不下）
  let maxD = 0;
  for (const c of geom.cands) {
    maxD = Math.max(maxD, c.d);
    if (c.d < need) continue; // 可靠下界不足 ⇒ 必放不下（免 16 点奇偶）
    let fitsHere: boolean;
    if (c.d >= diag) fitsHere = true; // 可靠下界足以包住整盒 ⇒ 必放得下（免奇偶）
    else fitsHere = geom.fits(c.x, c.y, w, h, pad);
    if (!fitsHere) continue;
    anyFits = true;
    if (!filter || filter(c.x, c.y)) return { slot: c, blocked: false };
  }
  // 局部细化：候选是网格近似，最宽处可能落在两格之间——只在「确有宽处」时才值得找
  if (maxD >= need * 0.5) {
    const step = Math.max(w, h) / 2;
    const limit = Math.min(2, geom.cands.length);
    for (let i = 0; i < limit; i++) {
      const c = geom.cands[i];
      for (let gy = -2; gy <= 2; gy++) {
        for (let gx = -2; gx <= 2; gx++) {
          if (!gx && !gy) continue;
          const x = c.x + gx * step;
          const y = c.y + gy * step;
          if (!geom.fits(x, y, w, h, pad)) continue;
          anyFits = true;
          if (!filter || filter(x, y)) return { slot: { x, y, d: c.d }, blocked: false };
        }
      }
    }
  }
  return { slot: null, blocked: anyFits };
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
    // 旧实现：`cam.scale < 90` 整层一刀切 → 现改为 **R14 分档缩放阶梯**：
    // 名称按本层 `minScale`（档位表），核心符号 = 名称门槛 + 20（缩小过程中**符号先消失**），
    // cell 级装饰（树 / id 标记，调试性质）保留旧的 90 地板。
    const decorFloor = cam.scale < 90;
    const sc = style.symbols?.scale || 1;
    const font = style.labels.default;
    /** 符号比名称早 20 个 scale 消失（R14：符号先消失、名称后消失） */
    const SYM_LADDER = 20;
    const specMemo = new Map<string, LabelSpec>();
    const specOf = (layer: World['layers'][number]): LabelSpec => {
      let hit = specMemo.get(layer.id);
      if (!hit) {
        hit = labelSpecOf(world, layer, style);
        specMemo.set(layer.id, hit);
      }
      return hit;
    };
    const hasLetterSpacing = 'letterSpacing' in ctx;
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
    const padV = 4 / Math.max(cam.scale, SCALE_FLOOR);
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

    // —— 收集本帧画装饰的层（过滤条件与原逐层循环一致：任一装饰开关 + 显示）——
    interface Decor {
      order: number;
      layer: World['layers'][number];
      regions: World['regions'];
      labelMode: LabelMode;
      coreSym: CoreSymbol;
      cellSym: CellSymbol;
      cellMarker: CellMarker;
    }
    const decors: Decor[] = [];
    for (let li = 0; li < world.layers.length; li++) {
      const layer = world.layers[li];
      const labelMode = layer.labelMode ?? 'none';
      const coreSym = layer.coreSymbol ?? 'none';
      const cellSym = layer.cellSymbol ?? 'none';
      const cellMarker = layer.cellMarker ?? 'none';
      if (labelMode === 'none' && coreSym === 'none' && cellSym === 'none' && cellMarker === 'none') continue;
      // baseMesh 层不进元素合成，但可以有装饰（cell 标记等）；显隐唯一真相=眼睛（2026-10-06）
      const shown = layer.baseMesh
        ? layer.visible === true
        : isLayerShown(world, layer.id);
      if (!shown) continue;
      const regions = decorRegionsOf(world, layer.id);
      // baseMesh 层的 cellMarker 遍历所有 cell，不依赖 Region
      const needsRegions = labelMode !== 'none' || coreSym !== 'none' || cellSym !== 'none' ||
        (cellMarker !== 'none' && !layer.baseMesh);
      if (needsRegions && !regions.length) continue;
      decors.push({ order: li, layer, regions, labelMode, coreSym, cellSym, cellMarker });
    }

    /** 屏幕坐标投影（走统一 MapTransform，标签随内容平移） */
    const toScreen = (x: number, y: number) => tScreen.worldToScreen(x + (offAt?.(y) ?? 0), y);

    // —— 跨层碰撞表（R13）：名称与符号共用一张屏幕网格，先放者占位 ——
    const boxes = new BoxGrid();

    // —— ① 核心符号先占位（名称要避让符号；符号本体最后画，压在名称之上）——
    const symPlan: {
      sym: Exclude<CoreSymbol, 'none'>;
      coreId: number;
      color: string;
      size: number;
      sx: number;
      sy: number;
      r: number;
    }[] = [];
    for (const d of decors) {
      if (d.coreSym === 'none') continue;
      const spec = specOf(d.layer);
      if (cam.scale < spec.minScale + SYM_LADDER) continue; // 符号先消失（R14）
      for (const r of d.regions) {
        // 核心两形态单源（选项1）：coreRegionId（核心=子元素）→ 取其核心格
        const coreId = coreCellOf(world, r);
        if (coreId === undefined) continue;
        const x = pcache.centers[coreId * 2];
        const y = pcache.centers[coreId * 2 + 1];
        if (!Number.isFinite(x)) continue;
        const sp = toScreen(x, y);
        if (sp.sx < -40 || sp.sx > w + 40 || sp.sy < -40 || sp.sy > h + 40) continue;
        // 占位盒 = 符号视觉半径（随字号，R15）× 描边余量；与实际画出来的尺寸同源
        const half = coreSymbolRadiusPx(d.coreSym, spec.size) * sc * 1.15;
        boxes.add(sp.sx - half, sp.sy - half, half * 2, half * 2);
        symPlan.push({
          sym: d.coreSym,
          coreId,
          color: bandColorOf(style, r),
          size: spec.size,
          sx: sp.sx,
          sy: sp.sy,
          r: coreSymbolRadiusPx(d.coreSym, spec.size) * sc,
        });
      }
    }

    // —— 用户自定义地块标记（包5 · CellMark）：画在指定格上，独立于任何层。
    //    复用 symPlan = 复用「占位（名称避让）+ 绘制（pass③ 压在名称之上）」全链。
    for (const m of world.cellMarks ?? []) {
      const x = pcache.centers[m.cellId * 2];
      const y = pcache.centers[m.cellId * 2 + 1];
      if (!Number.isFinite(x)) continue; // 悬空 cell（撒点重生后）→ 跳过
      const sp = toScreen(x, y);
      if (sp.sx < -40 || sp.sx > w + 40 || sp.sy < -40 || sp.sy > h + 40) continue;
      const half = coreSymbolRadiusPx(m.symbol, font.size) * sc * 1.15;
      boxes.add(sp.sx - half, sp.sy - half, half * 2, half * 2);
      symPlan.push({
        sym: m.symbol,
        coreId: m.cellId,
        color: m.color ?? font.color,
        size: font.size,
        sx: sp.sx,
        sy: sp.sy,
        r: coreSymbolRadiusPx(m.symbol, font.size) * sc,
      });
    }

    // —— ② 元素名称：面内最宽处放置 + 放得下才画（放不下 = 省略，绝不缩字号，见 P8）——
    let placed = 0;
    let hid = 0;
    let noPiece = 0;
    let cold = 0;
    let off = 0;
    let hidNoFit = 0;
    let hidCollide = 0;
    /** 已放置项（name + 屏幕坐标）——验收/回归读数用，封顶防热路径膨胀 */
    const debugInfo: { id: string; name: string; tier: string; mode: string; angle: number; el: number; n: number; ls: number; sx: number; sy: number }[] = [];
    // 帧级防重令牌（**必须在模块级**：装饰层 draw 每个世界副本 pass 重入，局部变量
    //  每 pass 新建 = 防不住；按 __drawCount 与 labelFrameAcc 同一帧令牌重置）
    const frameNo0 = globalThis.__drawCount ?? 0;
    if (frameNo0 !== placedFrameNo) {
      placedFrameNo = frameNo0;
      placedIds = new Set<string>();
    }
    const labelT0 = performance.now();
    if (showLabels !== false) {
      // 本帧要画名称的层 = 有 labelMode **且过了本档的缩放门槛**（R14 分档阶梯）
      const labelDecors = decors
        .filter((d) => d.labelMode !== 'none')
        .map((d) => ({ d, spec: specOf(d.layer) }))
        .filter((x) => cam.scale >= x.spec.minScale);
      if (labelDecors.length) {
        // 放置优先级 = 叠放同源（R12）：焦点层 → 层深度（父层先于子层）→ 列表序
        const depth = new Map(layerTreeOf(world).map((r) => [r.id, r.depth]));
        labelDecors.sort((a, b) => {
          const fa = a.d.layer.id === focus ? 0 : 1;
          const fb = b.d.layer.id === focus ? 0 : 1;
          if (fa !== fb) return fa - fb;
          const da = depth.get(a.d.layer.id) ?? 0;
          const db = depth.get(b.d.layer.id) ?? 0;
          if (da !== db) return da - db;
          return a.d.order - b.d.order;
        });
        // 一元素多显示片时取最大片（LabelLargestPartOnly）
        const labelIds = new Set(labelDecors.map((x) => x.d.layer.id));
        const pieceOf = new Map<string, DisplayPiece>();
        for (const dp of env.displayPieces ?? []) {
          if (!labelIds.has(dp.layerId)) continue;
          const k = `${dp.layerId}:${dp.regionId}`;
          const cur = pieceOf.get(k);
          if (!cur || dp.cellIds.length > cur.cellIds.length) pieceOf.set(k, dp);
        }
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        for (const { d, spec } of labelDecors) {
          // 每档一套排版（R6/R7）：字重 + 字号 + 中英字体栈 + 字距（拉丁疏排、方块字也吃字距）
          ctx.font = `${spec.weight} ${spec.size}px ${spec.family}`;
          if (hasLetterSpacing) ctx.letterSpacing = `${spec.spacing}em`;
          const padPx = Math.max(2, Math.round(spec.size / 4)); // 碰撞余量 = halo 宽度 = 字号/4（R8）
          const haloW = padPx;
          /** 量宽（键含字重/字号/字体/字距，跨帧复用）——排布与碰撞同源 */
          const widthOf = (t: string): number => {
            const key = `${spec.weight}|${spec.size}|${spec.family}|${spec.spacing}|${t}`;
            let cw = labelWidthCache.get(key);
            if (cw === undefined) {
              cw = ctx.measureText(t).width;
              if (labelWidthCache.size > 1024) labelWidthCache.clear();
              labelWidthCache.set(key, cw);
            }
            return cw;
          };
          /**
           * 屏幕盒（包4）：投影锚点+方向 → toScreen 两点求**屏幕角** → 旋转盒 AABB。
           * 角度从屏幕两点取，天然吸收投影形变与 y 翻转，不需要解析导数。
           */
          const boxOf = (it: LabelItemAt) => {
            const s0 = toScreen(it.x, it.y);
            const s1 = toScreen(it.x + it.dx, it.y + it.dy);
            let a = Math.atan2(s1.sy - s0.sy, s1.sx - s0.sx);
            // 不倒置（R5）：PCA 主轴方向是任意的，屏幕角可能落在 ±90° 外 → 归一到
            // (-90°,90°]。盒是中心对称的（旋转 a 与 a+180° 同一矩形），所以归一只影响
            // 「字往哪边读」；逐字（curve）在投影空间已挡掉反向，这里对它是恒等。
            if (a > Math.PI / 2) a -= Math.PI;
            else if (a <= -Math.PI / 2) a += Math.PI;
            // 拉伸件（ls）按**拉伸后**的实际宽算盒：量宽时是档位字距，绘制时是 ls
            const twI = widthOf(it.text) + (it.ls ? (it.ls - spec.spacing) * spec.size * Array.from(it.text).length : 0);
            const thI = spec.size;
            const hw = (Math.abs(twI * Math.cos(a)) + Math.abs(thI * Math.sin(a))) / 2 + padPx;
            const hh = (Math.abs(twI * Math.sin(a)) + Math.abs(thI * Math.cos(a))) / 2 + padPx;
            return { x: s0.sx - hw, y: s0.sy - hh, w: hw * 2, h: hh * 2, a, cx: s0.sx, cy: s0.sy };
          };
          /** 碰撞检查（只查不占位；重复/逐字的占位在选定布局后统一做） */
          const place = (items: LabelItemAt[], union: boolean): boolean => {
            const bs = items.map(boxOf);
            if (union && bs.length > 1) {
              let x0 = Infinity;
              let y0 = Infinity;
              let x1 = -Infinity;
              let y1 = -Infinity;
              for (const b of bs) {
                if (b.x < x0) x0 = b.x;
                if (b.y < y0) y0 = b.y;
                if (b.x + b.w > x1) x1 = b.x + b.w;
                if (b.y + b.h > y1) y1 = b.y + b.h;
              }
              return !boxes.hits(x0, y0, x1 - x0, y1 - y0);
            }
            for (const b of bs) if (boxes.hits(b.x, b.y, b.w, b.h)) return false;
            return true;
          };
          for (const r of d.regions) {
            const raw = d.labelMode === 'coreLabel' && (r.coreLabel ?? r.centerLabel)
              ? (r.coreLabel ?? r.centerLabel)!
              : r.name;
            if (!raw) continue;
            const name = labelTextOf(raw, spec); // 拉丁全大写（汉字原样，混排=地图常见样）
            const dp = pieceOf.get(`${d.layer.id}:${r.id}`);
            if (!dp) {
              noPiece++;
              continue; // 未合成/未显示 → 不画
            }
            if (placedIds.has(r.id)) continue; // 帧内已画（跨副本 pass 去重）
            const geom = labelGeomOf(env, dp);
            if (!geom) {
              cold++;
              continue; // 冷件：补热后再出现（与元素层渐现同语义）
            }
            const bb = geom.bbox;
            if (bb.maxX < vL || bb.minX > vR || bb.maxY < vB || bb.minY > vT) {
              off++;
              continue; // 视口外
            }
            const tw = widthOf(name);
            // 选排布（包4）：非狭长=水平直排；狭长=沿轴重复 → 逐字弯曲 → 退回水平
            const layout = pickLabelLayout(geom, name, tw, spec.size, padPx, cam.scale, widthOf, place, spec.spacing);
            if (!layout.mode) {
              hid++;
              if (layout.blocked) hidCollide++;
              else hidNoFit++;
              continue;
            }
            // 副本 pass 的保守视口判定会略微多收（视口盒按 offset 区间取并集）：
            // 屏外的既不画也不占位（否则会凭空挤掉真正可见的标签）
            // 出屏判定用**盒中心**（而非「完全在外」）：贴边被截一半的名字不画，
            // 也让后一个副本 pass 有机会画完整那条（配合帧级防重 = 屏内唯一且不截断）
            const drawn = layout.items
              .map((it) => ({ it, b: boxOf(it) }))
              .filter((o) => {
                const cx2 = o.b.x + o.b.w / 2;
                const cy2 = o.b.y + o.b.h / 2;
                return cx2 >= 0 && cx2 <= w && cy2 >= 0 && cy2 <= h;
              });
            if (!drawn.length) {
              off++;
              continue;
            }
            // 选定后统一占位（探索阶段只查不占，避免失败布局留下残余）
            for (const o of drawn) boxes.add(o.b.x, o.b.y, o.b.w, o.b.h);
            // 逐字（弯曲）模式：字距已由弧长推进承担 → 临时归零，画完恢复
            const perChar = layout.mode === 'curve';
            if (perChar && hasLetterSpacing) ctx.letterSpacing = '0px';
            for (const o of drawn) {
              const b = o.b;
              const ls = o.it.ls ?? 0;
              if (ls > 0 && hasLetterSpacing) ctx.letterSpacing = `${ls}em`;
              // 尾距补偿：letterSpacing 在**每个字符后**都加（含尾），居中会左偏半格 → 右移 ls/2·字号
              const tail = ls > 0 ? (ls * spec.size) / 2 : 0;
              const drawOne = (tx: number, ty: number, text: string) => {
                if (spec.halo) {
                  ctx.lineWidth = haloW;
                  ctx.strokeStyle = spec.halo;
                  ctx.strokeText(text, tx, ty);
                }
                ctx.fillStyle = spec.color;
                ctx.fillText(text, tx, ty);
              };
              if (Math.abs(b.a) < 1e-3) {
                drawOne(b.cx + tail, b.cy, o.it.text); // 水平：与旧行为完全一致（tail=0）
              } else {
                ctx.save();
                ctx.translate(b.cx, b.cy);
                ctx.rotate(b.a);
                drawOne(tail, 0, o.it.text);
                ctx.restore();
              }
              if (ls > 0 && hasLetterSpacing) ctx.letterSpacing = `${spec.spacing}em`;
            }
            if (perChar && hasLetterSpacing) ctx.letterSpacing = `${spec.spacing}em`;
            placed += drawn.length;
            placedIds.add(r.id);
            if (debugInfo.length < 16) {
              const first = drawn[0];
              debugInfo.push({
                id: r.id,
                name: layout.mode === 'curve' ? name : first.it.text,
                tier: spec.tier,
                mode: layout.mode,
                angle: Math.round((first.b.a * 180) / Math.PI),
                el: Math.round(geom.elongation * 100) / 100,
                n: layout.mode === 'curve' ? layout.items.length : 1,
                ls: Math.round((layout.items[0]?.ls ?? 0) * 1000) / 1000,
                sx: Math.round(first.b.cx),
                sy: Math.round(first.b.cy),
              });
            }
          }
        }
        ctx.restore();
      }
    }
    {
      const frameNo = globalThis.__drawCount ?? 0;
      if (!labelFrameAcc || labelFrameAcc.frame !== frameNo) {
        globalThis.__labelMs = 0; // 帧起始清零，末尾统一累加本 pass 耗时
        labelFrameAcc = {
          frame: frameNo,
          placed: 0,
          hid: 0,
          hidNoFit: 0,
          hidCollide: 0,
          noPiece: 0,
          cold: 0,
          off: 0,
          syms: 0,
          marks: 0,
          symbols: [],
          items: [],
          view: [vL, vR, vB, vT],
        };
      }
      labelFrameAcc.placed += placed;
      labelFrameAcc.hid += hid;
      labelFrameAcc.hidNoFit += hidNoFit;
      labelFrameAcc.hidCollide += hidCollide;
      labelFrameAcc.noPiece += noPiece;
      labelFrameAcc.cold += cold;
      labelFrameAcc.off += off;
      if (labelFrameAcc.items.length < 16) labelFrameAcc.items.push(...debugInfo);
      labelFrameAcc.view = [vL, vR, vB, vT];
      labelFrameAcc.syms = labelFrameAcc.syms + symPlan.length;
      labelFrameAcc.marks = world.cellMarks?.length ?? 0;
      // 符号读数（验收：屏幕坐标 + 视觉半径，配 getImageData 做像素级独立验证）
      if (labelFrameAcc.symbols.length < 16) {
        for (const sy of symPlan) {
          if (sy.sx < 0 || sy.sx > w || sy.sy < 0 || sy.sy > h) continue;
          labelFrameAcc.symbols.push({ sym: sy.sym, sx: Math.round(sy.sx), sy: Math.round(sy.sy), r: Math.round(sy.r * 10) / 10 });
          if (labelFrameAcc.symbols.length >= 16) break;
        }
      }
      labelFrameAcc.geom = { ...labelGeomStat };
      globalThis.__labelStat = labelFrameAcc;
      // 注记段耗时（含逐副本 pass 累加）：验收「注记不抢帧预算」的读数
      globalThis.__labelMs = (globalThis.__labelMs ?? 0) + (performance.now() - labelT0);
    }

    // —— ③ 核心符号 + 逐 cell 装饰 + cell 标记（世界空间绘制，压在名称之上）——
    for (const sym of symPlan) {
      const x = pcache.centers[sym.coreId * 2];
      const y = pcache.centers[sym.coreId * 2 + 1];
      // 屏幕视觉半径（随字号 × 主题缩放）→ 世界半径（drawCoreSymbol 画在世界空间）
      const rPx = coreSymbolRadiusPx(sym.sym, sym.size) * sc;
      const wx = x + (offAt?.(y) ?? 0);
      const wr = rPx / cam.scale;
      drawCoreSymbol(ctx, sym.sym, wx, y, wr, sym.color, style);
    }
    for (const d of decors) {
      if (!decorFloor && d.cellSym === 'tree') {
        for (const r of d.regions) {
          for (const id of r.cells) {
            const cell = world.cells[id];
            if (!cell || !inView(id)) continue;
            const x = pcache.centers[id * 2];
            const y = pcache.centers[id * 2 + 1];
            drawTree(ctx, x + (offAt?.(y) ?? 0), y, (0.55 * sc) / cam.scale, ((id * 9973) % 100) / 100);
          }
        }
      }

      if (!decorFloor && d.cellMarker !== 'none') {
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = `${Math.max(8, font.size - 4)}px ${font.family}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // baseMesh 标记所有 cell；普通层标记所属元素的 cell
        // baseMesh 全量 cell 走惰性迭代（不每帧建 10 万级数组）
        const cellIds: Iterable<number> = d.layer.baseMesh
          ? (function* () {
              for (const c of world.cells) yield c.id;
            })()
          : decorMarkerIdsOf(world, d.layer.id, d.regions);
        for (const id of cellIds) {
          const cell = world.cells[id];
          if (!cell || !inView(id)) continue;
          const x = pcache.centers[id * 2];
          const y = pcache.centers[id * 2 + 1];
          const label = d.cellMarker === 'id' ? String(id) : String(Math.round(cell.height));
          const sp = toScreen(x, y);
          if (sp.sx < -20 || sp.sx > w + 20 || sp.sy < -20 || sp.sy > h + 20) continue;
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.fillText(label, sp.sx, sp.sy);
        }
        ctx.restore();
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
  pathsLayer,
  decorationsLayer,
  frameLayer,
];
