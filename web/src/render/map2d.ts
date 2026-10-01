import type { World } from '../core/types';
import {
  defaultProjParams,
  projectionWorldPeriod,
  type ProjectionId,
  type ProjectionParams,
} from '../core/project/projections';
import { styleById } from '../core/styles';
import { getProjCache } from './projCache';
import { getRegionIndex } from '../core/index/regionIndex';
import { buildPieceParams, defaultPipeline, type RenderEnv, type RenderLayer } from './layers';
import { contentOffsetAt, worldCopyKs } from './space';
import { composeShownPieces } from '../core/displayCompose';
import { ringPath2D } from '../core/ring/path2d';

/** cellId → 国家色（RegionIndex 缓存） */
export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export function defaultCamera(): Camera {
  return { x: 0, y: 0, scale: 180 };
}

export interface HoverInfo {
  cellId: number;
  lon: number;
  lat: number;
  height: number;
  /** 鼠标所在格从属的元素 id（全部层，Region.cells 反查；C4 悬停归属的稳定数据源） */
  elementIds?: string[];
  /** 与 elementIds 一一对应的元素**名**（状态栏直接显示，点击可跳选） */
  elementNames?: string[];
}

/**
 * 2D 地图绘制编排。
 *
 * 分层约定（解耦「是否穿过地图」与「怎么画几何」）：
 * - 图层只消费 env.drawDx，画连续投影几何，不自行 ±2π、不自行决定是否在框内。
 * - 本函数用 space.worldCopyDxs 决定要画哪些世界副本，组合 contentOffsetX。
 * - 外框/frame 层不参与副本；裁剪只在外框 clip 内发生。
 */
/** 构造渲染环境（drawWorld 与预热共用；内容构建与绘制分离） */
export function buildRenderEnv(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  hoverId: number | null,
  dpr: number,
  opts?: Parameters<typeof drawWorld>[5],
): RenderEnv {
  const w = ctx.canvas.width / dpr;
  const h = ctx.canvas.height / dpr;
  const style = styleById(opts?.styleId ?? 'dark');
  const proj = opts?.projection ?? 'mercator';
  const pp = opts?.projParams ?? defaultProjParams();
  const contentOffsetX = opts?.contentOffsetX ?? 0;
  const pcache = getProjCache(world, proj, pp);
  // 副本 = 整数 k（worldCopyKs 已按 scale(y) 极值判可见）；平移 = Δλ
  const copyKs = opts?.singleWorldCopy
    ? [0]
    : worldCopyKs(contentOffsetX, cam, w, proj, pcache.worldBBox);
  const padX = 4 / Math.max(cam.scale, 1e-6);
  const padY = 4 / Math.max(cam.scale, 1e-6);
  const bb = pcache.worldBBox;
  const halfW = w / 2 / Math.max(cam.scale, 1e-6);
  const halfH = h / 2 / Math.max(cam.scale, 1e-6);
  void padX; void padY; void bb; void halfW; void halfH;
  const env: RenderEnv = {
    ctx,
    world,
    cam,
    hoverId,
    dpr,
    w,
    h,
    // 渐现仅限首启（progressiveBoot）：冷件跳过入队、空闲补热。
    // 活跃期（预热完成后）必须同步重建被失效的件——否则件会"消失"直到下一次空闲（=全图重载观感）
    warmQueue: opts?.progressiveBoot ? [] : undefined,
    style,
    focus: opts?.focusLayer ?? 'height',
    proj,
    pp,
    pcache,
    showLabels: opts?.showLabels,
    contentOffsetX,
    drawDx: contentOffsetX,
    copyKs,
    highlightRegionId: opts?.highlightRegionId,
    hidePathId: opts?.hidePathId,
    displayPieces: opts?.displayPieces,
    showCellMesh: opts?.showCellMesh,
    useDefaultRegions: opts?.useDefaultRegions,
    focusLayerId: opts?.focusLayerId ?? opts?.focusLayer,
    fillStyle: opts?.fillStyle,
    styleOf: opts?.styleOf,
    borderStyle: opts?.borderStyle,
    isDragging: opts?.isDragging,
  };
  // 点级内容位移：投影域 = scale(y)·λ偏移（圆柱族退化常数；非回绕 = λ 即投影域）
  env.offsetAt = (y: number) => contentOffsetAt(proj, y, env.drawDx ?? contentOffsetX);
  return env;
}

/**
 * 切层顺滑：世界就绪后**逐件**预热件几何（环/样条/三角化/Path2D），切层命中缓存不再付一次性重建。
 * 分片纪律：一件一个空闲片（requestIdleCallback，超时 100ms 兜底），任何单件不长时间占住主线程；
 * 失效：dataRev/成员变化后缓存自然 miss（rev 纪律），本预热只是暖启动。
 */
export function warmLayerGeometry(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  dpr: number,
  opts: Parameters<typeof drawWorld>[5],
  layerIds: string[],
  primer?: (pieces: import('./layers').PieceParams[]) => void,
  onDone?: (layerId: string) => void,
): void {
  type Job = { env: RenderEnv; piece: import('../core/displayCompose').DisplayPiece };
  const jobs: Job[] = [];
  for (const layerId of layerIds) {
    try {
      const pieces = composeShownPieces(world, layerId, null);
      const env = buildRenderEnv(ctx, world, cam, null, dpr, {
        ...opts,
        focusLayer: layerId,
        focusLayerId: layerId,
        displayPieces: pieces,
      });
      for (const piece of pieces) jobs.push({ env, piece });
    } catch (e) {
      console.warn('[warm] 层预热装配失败', layerId, e);
    }
  }
  let i = 0;
  // 真空闲才跑（不设 timeout）：切层顺滑靠缓存命中，预热本身不得抢主线程
  const idle: (fn: () => void) => void =
    typeof requestIdleCallback === 'function'
      ? (fn) => requestIdleCallback(() => fn())
      : (fn) => setTimeout(fn, 32);
  const step = (): void => {
    if (i >= jobs.length) return;
    const { env, piece } = jobs[i++];
    try {
      // 逐件：单件参数解析 + 逐件几何（Path2D/GL 缓存）
      const params = buildPieceParams({ ...env, displayPieces: [piece] });
      for (const p of params) {
        for (const ring of p.rings) {
          ringPath2D(ring, p.smooth, 'fill');
          ringPath2D(ring, p.smooth, 'outline');
        }
      }
      primer?.(params);
    } catch (e) {
      console.warn('[warm] 件预热失败', piece.key, e);
    }
    if (i === jobs.length) onDone?.('all');
    idle(step);
  };
  idle(step);
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  world: World,
  cam: Camera,
  hoverId: number | null,
  dpr: number,
  opts?: {
    focusLayer?: string;
    highlightRegionId?: string | null;
    projection?: ProjectionId;
    projParams?: ProjectionParams;
    styleId?: string;
    showLabels?: boolean;
    contentOffsetX?: number;
    hidePathId?: string | null;
    /** 仅一份世界副本（路径编辑等轻量管线） */
    singleWorldCopy?: boolean;
    pipeline?: RenderLayer[];
    displayPieces?: import('../core/displayCompose').DisplayPiece[];
    showCellMesh?: boolean;
    useDefaultRegions?: boolean;
    focusLayerId?: string;
    fillStyle?: import('../core/layer/style').ElementStyle;
    styleOf?: (layerId: string) => import('../core/layer/style').ElementStyle;
    borderStyle?: import('../core/types').LayerRenderConfig;
    /** 平移/缩放中：跳过脏区域重烘焙（贴图 1:1 显示，不拉伸） */
    isDragging?: boolean;
    /** 冷件补热就绪回调（渐现：触发重绘让元素出现） */
    onGeometryReady?: () => void;
    /** 首启渐现：冷件跳过入队（仅世界载入/生成期为 true；之后同步重建） */
    progressiveBoot?: boolean;
    /** GL 直绘场景（bg/cellsMesh/elements 三通道）；返回 true = 已绘，2D 只画余下层（透明底） */
    /** GL 直绘场景（bg/cellsMesh/elements 三通道）；GL 唯一后端——缺席/失败即清屏返回 */
    glScene?: {
      render(env: RenderEnv, channels: { cellsMesh: boolean; elements: boolean }): boolean;
    };
  },
): void {
  const drawT0 = performance.now();
  const w = ctx.canvas.width / dpr;
  const h = ctx.canvas.height / dpr;
  const style = styleById(opts?.styleId ?? 'dark');
  const proj = opts?.projection ?? 'mercator';
  const pp = opts?.projParams ?? defaultProjParams();
  const contentOffsetX = opts?.contentOffsetX ?? 0;
  const pcache = getProjCache(world, proj, pp);
  // 副本 = 整数 k（scale(y) 判可见）；rest 层按 λ 语义逐 pass 取 drawDx
  const copyKs = opts?.singleWorldCopy
    ? [0]
    : worldCopyKs(contentOffsetX, cam, w, proj, pcache.worldBBox);
  const env = buildRenderEnv(ctx, world, cam, hoverId, dpr, opts);

  const pipeline = opts?.pipeline ?? defaultPipeline;
  // GL 唯一后端：bg/cellsMesh/elements 由 GL 画布逐帧直绘（相机 uniform，无烘焙/无 drawImage）；
  // 2D 画布只画余下层（透明底），底色在 GL 画布上。（Canvas2D 后端已归档，无回退）
  const glReady = opts?.glScene ? opts.glScene.render(env, { cellsMesh: true, elements: true }) : false;
  // 每帧先清屏：图层未覆盖处不得留上一帧残影
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  if (!glReady) {
    // GL 缺席（上下文丢失/初始化失败）：铺底色后**仍画 2D 余量层**——
    // 路径/标注/图框不依赖 GL（还债步骤 2）；bg/cells/elements 是 GL 通道，
    // 缺席时由调用方提示条说明（Canvas2D 地图后端已归档，不代画地块）。
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = style.frameVoid ?? '#0b1018';
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.restore();
  }

  const rest = pipeline;
  const restT0 = performance.now();
  for (const layer of rest) {
    if (!layer.repeat) {
      env.drawDx = contentOffsetX;
      layer.draw(env);
      continue;
    }
    for (const k of copyKs) {
      // drawDx = λ 总偏移（Δλ + k·2π）；投影域位移由 offsetAt(y) 点级派生
      env.drawDx = contentOffsetX + k * Math.PI * 2;
      layer.draw(env);
    }
  }
  {
    const g = globalThis as unknown as { __restMs?: number; __restSeg?: number[] };
    const ms = performance.now() - restT0;
    g.__restMs = ms;
    (g.__restSeg ??= []).push(ms);
    if (g.__restSeg.length > 240) g.__restSeg.shift();
  }
  env.drawDx = contentOffsetX;
  // 渐现：冷件（环未预热）已跳过——空闲补热，就绪即重绘（拖缓元素出现，不阻塞交互）
  if (env.warmQueue?.length) {
    const cold = env.warmQueue.slice();
    env.warmQueue.length = 0;
    const idle: (fn: () => void) => void =
      typeof requestIdleCallback === 'function'
        ? (fn) => requestIdleCallback(() => fn(), { timeout: 400 })
        : (fn) => setTimeout(fn, 0);
    let i = 0;
    const warmStep = (): void => {
      // 时间预算批量：每回调 ≤6ms 的件（原 1 件/回调，百件级风暴拖数秒 → 主线程长冻结）
      const t0 = performance.now();
      while (i < cold.length && performance.now() - t0 < 6) {
        buildPieceParams({ ...env, displayPieces: [cold[i++]], warmQueue: undefined });
      }
      opts?.onGeometryReady?.();
      if (i >= cold.length) return;
      idle(warmStep);
    };
    idle(warmStep);
  }
  // 帧计时（两后端同一咽喉点，A/B 可比）：环形样本 + 帧计数常驻 window，验收/回归用
  const g = globalThis as unknown as {
    __drawMs?: number;
    __drawSamples?: number[];
    __drawCount?: number;
  };
  const ms = performance.now() - drawT0;
  g.__drawMs = ms;
  (g.__drawSamples ??= []).push(ms);
  if (g.__drawSamples.length > 240) g.__drawSamples.shift();
  g.__drawCount = (g.__drawCount ?? 0) + 1;
}

export function screenToWorld(
  cam: Camera,
  cssX: number,
  cssY: number,
  cssW: number,
  cssH: number,
): { x: number; y: number } {
  return {
    x: (cssX - cssW / 2) / cam.scale + cam.x,
    // y 翻转：投影 y 向上、屏幕 y 向下
    y: -(cssY - cssH / 2) / cam.scale + cam.y,
  };
}
