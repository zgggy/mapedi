/** 圆柱投影的静态层只合成一个周期；平移仅平铺已合成的像素。 */
import { dataRev } from '../core/rev';
import type { RenderEnv, RenderLayer } from './layers.js';
import { MapTransform, worldCopyDxs } from './space.js';

type PeriodicState = {
  key: string;
  /** 布局指纹（窗口/分辨率/投影/样式）：同布局才可作增量烘焙的底图 */
  layoutSig: string;
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

/** 脏矩形（纹理坐标）。window = 纹理覆盖的内容窗口（period 模式=世界跨度，viewport 模式=取景窗口） */
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
  window?: { minX: number; maxX: number; minY: number; maxY: number },
): DirtyRect[] {
  // 全量重绘标记
  if (dirtyCells.has(-1)) {
    return [{ x: 0, y: 0, w: texW, h: texH }];
  }

  const bb = window ?? {
    minX: pcache.worldBBox.minX - Math.PI,
    maxX: pcache.worldBBox.maxX + Math.PI,
    minY: pcache.worldBBox.minY,
    maxY: pcache.worldBBox.maxY,
  };
  const minX = bb.minX;
  const maxX = bb.maxX;
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

function periodicCacheKeys(env: RenderEnv, h: number, period: number, pad: number, texScale: number): { full: string; layout: string } {
  const fill = env.fillStyle;
  const fillKey = fill
    ? `${fill.border.enabled ? 1 : 0}${fill.border.width}${fill.border.color}${fill.border.smooth}${fill.shadow.enabled ? 1 : 0}${fill.shadow.width}${fill.shadow.alpha}${fill.fill.enabled ? 1 : 0}${fill.fill.alpha}`
    : '';
  const border = env.borderStyle;
  const layout = [
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
    fillKey,
    jsonOf(border),
  ].join('|');
  const content = [dataRev(), env.highlightRegionId ?? '', pieceSignature(env)].join('|');
  return { full: `${layout}|${content}`, layout };
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
  // 视口模式覆盖的是「可见内容窗口」：中心 = cam.x − 内容偏移（右键平移窗口随内容滑动）
  const viewCenterX = env.cam.x - (env.contentOffsetX ?? 0);
  // 分桶按屏幕像素（内容坐标×比例换算，勿混用单位）；桶宽 = 2×余量 → 滑动出余量必换桶重烘
  const bucketSizeX = Math.max(1, 2 * MARGIN * w);
  const bucketSizeY = Math.max(1, 2 * MARGIN * h);
  const camBucketX = Math.round((viewCenterX * env.cam.scale) / bucketSizeX);
  const camBucketY = Math.round((env.cam.y * env.cam.scale) / bucketSizeY);

  const usePeriod = periodFits;
  const pixelW = usePeriod ? periodPixelW : vpPixelW;
  const pixelH = usePeriod ? periodPixelH : vpPixelH;
  if (pixelW < 2 || pixelH < 2) return false;

  const keys = periodicCacheKeys(env, h, period, pad, TEX_SCALE);
  const vpSuffix = usePeriod ? '' : `|vp|${camBucketX}|${camBucketY}`;
  const key = `${keys.full}${vpSuffix}`;
  const layoutSig = `${keys.layout}${vpSuffix}`;
  state = stateMap.get(key) ?? null;
  // cell 级脏区域：样式/绘制变 → 只重绘脏矩形（环形拆分，不重绘中间空洞）
  const dirty = getDirtyCells();
  const needRebake = !state || (dirty.size > 0 && !env.isDragging);
  if (needRebake) {
    // 增量底图：同布局旧贴图。**有底图才做脏矩形重绘**，并沿用底图的取景锚点
    // （像素坐标系一致；换锚拷贝会让整张贴图错位）。无底图 → 全量重绘。
    let src: PeriodicState | null = null;
    if (dirty.size > 0) {
      for (const s of stateMap.values()) {
        if (s.layoutSig === layoutSig && s.canvas.width === pixelW && s.canvas.height === pixelH) {
          src = s;
          break;
        }
      }
    }
    const anchorX = usePeriod ? 0 : src ? src.proxyX : viewCenterX;
    const anchorY = src ? src.proxyY : env.cam.y;
    const surf = makeSurface(pixelW, pixelH);
    if (!surf.ctx) return false;
    const c = surf.ctx;
    c.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
    const proxyH = pixelH / env.dpr;
    // 脏矩形按纹理实际覆盖窗口映射（viewport 是取景窗口，period 是世界跨度）
    const halfW = pixelW / env.dpr / 2 / Math.max(TEX_SCALE, 1e-6);
    const halfH = proxyH / 2 / Math.max(TEX_SCALE, 1e-6);
    const win = {
      minX: anchorX - halfW,
      maxX: anchorX + halfW,
      minY: anchorY - halfH,
      maxY: anchorY + halfH,
    };
    const dirtyRects = src
      ? computeDirtyRects(env.world, env.pcache, pixelW, pixelH, win)
      : [{ x: 0, y: 0, w: pixelW, h: pixelH }];
    if (src) c.drawImage(src.canvas, 0, 0);
    // 脏矩形 → 内容空间包围盒：元素层据此跳过与脏区不相交的元素（增量关键）
    const spanX = (win.maxX - win.minX) || 1;
    const spanY = (win.maxY - win.minY) || 1;
    const sx = pixelW / spanX;
    const sy = pixelH / spanY;
    const dirtyBoxes = dirtyRects.map((r) => ({
      minX: win.minX + r.x / sx,
      maxX: win.minX + (r.x + r.w) / sx,
      maxY: win.maxY - r.y / sy,
      minY: win.maxY - (r.y + r.h) / sy,
    }));
    const proxy: RenderEnv = {
      ...env,
      ctx: c,
      // period 模式：x=0 画整周期，靠平铺显示；viewport 模式：画取景窗口
      cam: usePeriod
        ? { x: 0, y: anchorY, scale: TEX_SCALE }
        : { x: anchorX, y: anchorY, scale: TEX_SCALE },
      w: pixelW / env.dpr,
      h: proxyH,
      contentOffsetX: 0,
      drawDx: 0,
      // viewport：内容位移折进了相机（cam=viewCenterX），裁剪需补回内容偏移，
      // 否则相邻世界副本被绝对 ±π 裁掉（平移时副本消失）；period：平铺即副本，补偿必须为 0
      clipDxBias: usePeriod ? 0 : env.contentOffsetX ?? 0,
      dirtyBoxes,
      worldDxs: usePeriod
        ? [-period, 0, period]
        : worldCopyDxs(
            0,
            { x: anchorX, y: anchorY, scale: TEX_SCALE },
            pixelW / env.dpr,
            period,
            env.pcache.worldBBox,
          ),
      periodicTilePadX: pad / TEX_SCALE,
      isDragging: false,
    };
    for (const layer of staticLayers) {
      // 增量时底色已在拷贝里；bg 的 clearRect 会抹掉拷贝内容——跳过
      if (src && layer.name === 'bg') continue;
      // 脏矩形合并为单次裁剪，整层只画一遍（不做 矩形×层×元素 的笛卡尔积）
      c.save();
      c.beginPath();
      for (const rect of dirtyRects) {
        c.rect(rect.x / env.dpr, rect.y / env.dpr, rect.w / env.dpr, rect.h / env.dpr);
      }
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
    state = { key, layoutSig, proxyX: usePeriod ? env.cam.x : anchorX, proxyY: anchorY, canvas: surf.canvas };
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
    // 贴图中心对齐烘焙时的可见内容窗口中心（含内容偏移）
    const xOff = w / 2 + (state.proxyX - viewCenterX) * env.cam.scale - texDisplayW / 2;
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
