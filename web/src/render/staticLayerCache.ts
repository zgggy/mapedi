/** 圆柱投影的静态层只合成一个周期；平移仅平铺已合成的像素。 */
import { dataRev } from '../core/rev';
import type { RenderEnv, RenderLayer } from './layers.js';
import { MapTransform } from './space.js';

type PeriodicState = {
  key: string;
  proxyX: number;
  proxyY: number;
  canvas: HTMLCanvasElement;
};

let stateMap = new Map<string, PeriodicState>();
let state: PeriodicState | null = null;

/**
 * cell 级脏区域追踪：
 * 样式/绘制变 → 标记受影响的 cell → 合并成矩形（环形拆分，不重绘中间空洞）。
 */
let dirtyCells = new Set<number>();

export function markDirtyCells(cellIds: Iterable<number> | 'all'): void {
  if (cellIds === 'all') {
    // 标记所有 cell（全量重绘）
    dirtyCells.add(-1); // -1 表示全部
    return;
  }
  for (const id of cellIds) dirtyCells.add(id);
}

export function clearDirtyCells(): void {
  dirtyCells = new Set();
}

export function getDirtyCells(): Set<number> {
  return dirtyCells;
}

/** 脏矩形（纹理坐标） */
export type DirtyRect = { x: number; y: number; w: number; h: number };

/**
 * 从脏 cell 集合计算脏矩形（环形拆分）：
 * 1. 每个脏 cell 的 bbox 作为一个矩形
 * 2. 贪心合并相邻/重叠矩形
 * 3. 环形区域自然拆分成多个矩形（中间空洞不覆盖）
 * 特殊：dirtyCells 含 -1 → 全量重绘（返回整个纹理）
 */
export function computeDirtyRects(
  world: { cells: { id: number; polygon: unknown[] }[] },
  pcache: { polys: Float64Array[]; worldBBox: { minX: number; maxX: number; minY: number; maxY: number } },
  texW: number,
  texH: number,
): DirtyRect[] {
  // 全量重绘标记
  if (dirtyCells.has(-1)) {
    return [{ x: 0, y: 0, w: texW, h: texH }];
  }

  const bb = pcache.worldBBox;
  const padX = Math.PI;
  const minX = bb.minX - padX;
  const maxX = bb.maxX + padX;
  const minY = bb.minY;
  const maxY = bb.maxY;
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const sx = texW / spanX;
  const sy = texH / spanY;

  // 1. 每个脏 cell 的 bbox（纹理坐标）
  const rects: DirtyRect[] = [];
  for (const id of dirtyCells) {
    const poly = pcache.polys[id];
    if (!poly || poly.length < 6) continue;
    let cx0 = Infinity, cx1 = -Infinity, cy0 = Infinity, cy1 = -Infinity;
    for (let i = 0; i < poly.length; i += 2) {
      const tx = (poly[i] - minX) * sx;
      const ty = (maxY - poly[i + 1]) * sy;
      if (tx < cx0) cx0 = tx;
      if (tx > cx1) cx1 = tx;
      if (ty < cy0) cy0 = ty;
      if (ty > cy1) cy1 = ty;
    }
    rects.push({ x: Math.floor(cx0), y: Math.floor(cy0), w: Math.ceil(cx1) - Math.floor(cx0), h: Math.ceil(cy1) - Math.floor(cy0) });
  }

  // 2. 贪心合并相邻/重叠矩形（环形自然拆分，中间空洞不覆盖）
  const merged: DirtyRect[] = [];
  const used = new Array(rects.length).fill(false);
  for (let i = 0; i < rects.length; i++) {
    if (used[i]) continue;
    let cur = { ...rects[i] };
    used[i] = true;
    let changed = true;
    while (changed) {
      changed = false;
      for (let j = 0; j < rects.length; j++) {
        if (used[j]) continue;
        const r = rects[j];
        // 相邻/重叠 → 合并
        if (cur.x <= r.x + r.w + 1 && r.x <= cur.x + cur.w + 1 &&
            cur.y <= r.y + r.h + 1 && r.y <= cur.y + cur.h + 1) {
          const nx = Math.min(cur.x, r.x);
          const ny = Math.min(cur.y, r.y);
          const nx2 = Math.max(cur.x + cur.w, r.x + r.w);
          const ny2 = Math.max(cur.y + cur.h, r.y + r.h);
          cur = { x: nx, y: ny, w: nx2 - nx, h: ny2 - ny };
          used[j] = true;
          changed = true;
        }
      }
    }
    merged.push(cur);
  }

  return merged;
}

export function invalidateStaticLayer(): void {
  state = null;
  stateMap = new Map();
  clearDirtyCells();
}

function pieceSignature(env: RenderEnv): string {
  const ps = env.displayPieces;
  if (!ps?.length) return '0';
  const a = ps[0]?.key ?? '';
  const b = ps[ps.length - 1]?.key ?? '';
  return `${ps.length}:${a}:${b}`;
}

/** 样式/边框对象在帧间不变时，JSON.stringify 是纯浪费——按引用记忆化。 */
const jsonMemo = new WeakMap<object, string>();
function jsonOf(v: unknown): string {
  if (v && typeof v === 'object') {
    const o = v as object;
    const hit = jsonMemo.get(o);
    if (hit !== undefined) return hit;
    const s = JSON.stringify(v);
    jsonMemo.set(o, s);
    return s;
  }
  return JSON.stringify(v);
}

function periodicCacheKey(env: RenderEnv, h: number, period: number, pad: number, texScale: number): string {
  const fill = env.fillStyle;
  const fillKey = fill
    ? `${fill.border.enabled ? 1 : 0}${fill.border.width}${fill.border.color}${fill.border.smooth}${fill.shadow.enabled ? 1 : 0}${fill.shadow.width}${fill.shadow.alpha}${fill.fill.enabled ? 1 : 0}${fill.fill.alpha}`
    : '';
  const border = env.borderStyle;
  return [
    dataRev(),
    env.dpr,
    h,
    texScale,
    period,
    pad,
    env.proj,
    env.pp?.centralMeridian ?? 0,
    env.pp?.aeqdCenter?.lon ?? 0,
    env.pp?.aeqdCenter?.lat ?? 0,
    jsonOf(env.style),
    env.focus,
    env.focusLayerId ?? '',
    env.showCellMesh ? 1 : 0,
    env.useDefaultRegions ? 1 : 0,
    env.highlightRegionId ?? '',
    pieceSignature(env),
    fillKey,
    jsonOf(border),
  ].join('|');
}

function makeSurface(w: number, h: number) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  return { canvas, ctx };
}

export function drawPeriodicStatic(
  env: RenderEnv,
  staticLayers: RenderLayer[],
  w: number,
  h: number,
  period: number,
): boolean {
  /**
   * 贴图分辨率 = 当前 cam.scale，**1:1 显示，不拉伸**。
   * RENDER_LOGIC.md：「不得拉伸低分辨率贴图代替清晰绘制」。
   *
   * 两种烘焙模式：
   * - **period 模式**：贴图覆盖一整个投影周期，平移靠平铺（缩小时适用）
   * - **viewport 模式**：贴图只覆盖视口+余量，平移在余量内滑动、出界重烘焙（放大时适用）
   * 旧实现在 period 贴图超预算时回退矢量直绘（每帧全量重绘，卡）；
   * 现在改用 viewport 模式，同样 1:1 清晰，且重烘焙只覆盖视口。
   */
  const TEX_SCALE = Math.max(1, Math.round(env.cam.scale));
  const pad = Math.max(
    32,
    8 + (env.borderStyle?.border?.width ?? env.style.border.width) * 2 +
      (env.borderStyle?.shadow?.width ?? 18.5) * 2,
  );
  const tileWidth = period * TEX_SCALE;
  const periodPixelW = Math.ceil((tileWidth + 2 * pad) * env.dpr);
  const periodPixelH = Math.min(4096, Math.max(1, Math.round(h * env.dpr * 2)));
  const periodFits = tileWidth >= 2 && periodPixelW <= 8192 && periodPixelH <= 8192 &&
    periodPixelW * periodPixelH <= 16_000_000;

  // viewport 模式：视口 + 30% 余量
  const MARGIN = 0.3;
  const vpPixelW = Math.min(8192, Math.round(w * env.dpr * (1 + MARGIN * 2)));
  const vpPixelH = Math.min(8192, Math.round(h * env.dpr * (1 + MARGIN * 2)));
  // 相机位置分桶：余量内平移不失效
  const bucketSizeX = Math.max(1, w * MARGIN);
  const bucketSizeY = Math.max(1, h * MARGIN);
  const camBucketX = Math.round(env.cam.x / bucketSizeX);
  const camBucketY = Math.round(env.cam.y / bucketSizeY);

  const usePeriod = periodFits;
  const pixelW = usePeriod ? periodPixelW : vpPixelW;
  const pixelH = usePeriod ? periodPixelH : vpPixelH;
  if (pixelW < 2 || pixelH < 2) return false;

  const key = usePeriod
    ? periodicCacheKey(env, h, period, pad, TEX_SCALE)
    : `${periodicCacheKey(env, h, period, pad, TEX_SCALE)}|vp|${camBucketX}|${camBucketY}`;
  state = stateMap.get(key) ?? null;
  // cell 级脏区域：样式/绘制变 → 只重绘脏矩形（环形拆分，不重绘中间空洞）
  const dirty = getDirtyCells();
  const needRebake = !state || (dirty.size > 0 && !env.isDragging);
  if (needRebake) {
    const surf = makeSurface(pixelW, pixelH);
    if (!surf.ctx) return false;
    const c = surf.ctx;
    c.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
    const proxyH = pixelH / env.dpr;
    // 计算脏矩形（环形拆分）
    const dirtyRects = dirty.size > 0
      ? computeDirtyRects(env.world, env.pcache, pixelW, pixelH)
      : [{ x: 0, y: 0, w: pixelW, h: pixelH }];
    // 只重绘脏矩形内的元素
    const proxy: RenderEnv = {
      ...env,
      ctx: c,
      // period 模式：x=0 画整周期，靠平铺显示；viewport 模式：x=cam.x 画视口窗口
      cam: usePeriod
        ? { x: 0, y: env.cam.y, scale: TEX_SCALE }
        : { x: env.cam.x, y: env.cam.y, scale: TEX_SCALE },
      w: pixelW / env.dpr,
      h: proxyH,
      contentOffsetX: 0,
      drawDx: 0,
      worldDxs: usePeriod ? [-period, 0, period] : [0],
      periodicTilePadX: pad / TEX_SCALE,
      isDragging: false,
    };
    for (const layer of staticLayers) {
      for (const rect of dirtyRects) {
        c.save();
        c.beginPath();
        c.rect(rect.x / env.dpr, rect.y / env.dpr, rect.w / env.dpr, rect.h / env.dpr);
        c.clip();
        if (!layer.repeat) {
          proxy.drawDx = 0;
          layer.draw(proxy);
        } else {
          for (const dx of proxy.worldDxs!) {
            proxy.drawDx = dx;
            layer.draw(proxy);
          }
        }
        c.restore();
      }
    }
    state = { key, proxyX: env.cam.x, proxyY: env.cam.y, canvas: surf.canvas };
    stateMap.set(key, state);
    if (stateMap.size > 4) {
      const firstKey = stateMap.keys().next().value;
      if (firstKey && firstKey !== key) stateMap.delete(firstKey);
    }
    clearDirtyCells();
  }

  if (!state) return false;
  const out = env.ctx;
  const zoom = env.cam.scale / TEX_SCALE;
  out.save();
  out.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);

  if (!usePeriod) {
    // viewport 模式：贴图对应视口+余量窗口，按相机偏移滑动
    const texDisplayW = (state.canvas.width / env.dpr) * zoom;
    const texDisplayH = (state.canvas.height / env.dpr) * zoom;
    // 贴图中心对齐烘焙时的 proxy 相机位置
    const xOff = w / 2 + (state.proxyX - env.cam.x) * env.cam.scale - texDisplayW / 2;
    const yOff = h / 2 + (env.cam.y - state.proxyY) * env.cam.scale - texDisplayH / 2;
    out.drawImage(state.canvas, xOff, yOff, texDisplayW, texDisplayH);
    out.restore();
    return true;
  }

  // period 模式：按投影周期平铺
  const displayTileWidth = period * env.cam.scale;
  const offset = w / 2 + ((env.contentOffsetX ?? 0) - env.cam.x - period / 2) * env.cam.scale;
  const left = ((offset % displayTileWidth) + displayTileWidth) % displayTileWidth;
  const texDisplayW = (state.canvas.width / env.dpr) * zoom;
  const texDisplayH = (state.canvas.height / env.dpr) * zoom;
  const actualPad = ((state.canvas.width / env.dpr - tileWidth) / 2) * zoom;
  // 贴图覆盖 2× 视口 → yOff 居中对齐 cam.y
  const yOff = (h - texDisplayH) / 2 + (env.cam.y - state.proxyY) * env.cam.scale;
  const first = Math.floor(-left / displayTileWidth) - 1;
  const last = Math.ceil((w - left) / displayTileWidth) + 1;
  for (let k = first; k <= last; k++) {
    const x0 = Math.max(0, Math.round((left + k * displayTileWidth) * env.dpr) / env.dpr);
    const x1 = Math.min(w, Math.round((left + (k + 1) * displayTileWidth) * env.dpr) / env.dpr);
    if (x1 <= x0) continue;
    out.save();
    out.beginPath();
    out.rect(x0, 0, x1 - x0, h);
    out.clip();
    out.drawImage(
      state.canvas,
      left + k * displayTileWidth - actualPad,
      yOff,
      texDisplayW,
      texDisplayH,
    );
    out.restore();
  }
  out.restore();
  return true;
}
