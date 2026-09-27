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
import { worldCopyDxs } from './space';
import { composeShownPieces } from '../core/displayCompose';
import { ringPath2D } from '../core/ring/path2d';
import { drawPeriodicStatic } from './staticLayerCache';

/** cellId → 国家色（RegionIndex 缓存） */
export function buildCountryFill(world: World): Map<number, string> {
  return getRegionIndex(world).fillMap(world, 'country');
}

/** cellId → 重叠成员列表 */
export function buildOverlapMembers(
  world: World,
  layerId: string,
): Map<number, { id: string; color: string; weight: number }[]> {
  return getRegionIndex(world).overlapMap(world, layerId);
}

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
  const period = projectionWorldPeriod(proj);
  const pcache = getProjCache(world, proj, pp);
  const rawDxs = opts?.singleWorldCopy || period === null
    ? [contentOffsetX]
    : worldCopyDxs(contentOffsetX, cam, w, period, pcache.worldBBox);
  const padX = 4 / Math.max(cam.scale, 1e-6);
  const padY = 4 / Math.max(cam.scale, 1e-6);
  const bb = pcache.worldBBox;
  const halfW = w / 2 / Math.max(cam.scale, 1e-6);
  const halfH = h / 2 / Math.max(cam.scale, 1e-6);
  let dxs = rawDxs.filter((dx) => {
    const viewL = cam.x - dx - halfW - padX;
    const viewR = cam.x - dx + halfW + padX;
    const viewT = cam.y + halfH + padY;
    const viewB = cam.y - halfH - padY;
    return !(bb.maxX < viewL || bb.minX > viewR || bb.maxY < viewB || bb.minY > viewT);
  });
  if (!dxs.length) dxs = [rawDxs.length ? rawDxs[0] : contentOffsetX];
  return {
    ctx,
    world,
    cam,
    hoverId,
    dpr,
    w,
    h,
    warmQueue: [],
    style,
    focus: opts?.focusLayer ?? 'height',
    proj,
    pp,
    smooth: opts?.reliefSmooth ?? 0,
    pcache,
    showLabels: opts?.showLabels,
    contentOffsetX,
    drawDx: contentOffsetX,
    worldDxs: dxs,
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
    reliefSmooth?: number;
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
    /** P1 静态层合成缓存（默认开；路径编辑关；GL 直绘时不走烘焙） */
    staticCache?: boolean;
    /** 平移/缩放中：跳过脏区域重烘焙（贴图 1:1 显示，不拉伸） */
    isDragging?: boolean;
    /** 冷件补热就绪回调（渐现：触发重绘让元素出现） */
    onGeometryReady?: () => void;
    /** GL 直绘场景（bg/cellsMesh/elements 三通道）；返回 true = 已绘，2D 只画余下层（透明底） */
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
  const period = projectionWorldPeriod(proj);
  const pcache = getProjCache(world, proj, pp);
  // Non-cylindrical projections have no horizontal world copies.
  const rawDxs = opts?.singleWorldCopy || period === null
    ? [contentOffsetX]
    : worldCopyDxs(
        contentOffsetX,
        cam,
        w,
        period,
        // 全图包围盒收紧副本（小地图/zoom in 时少画空 pass）
        pcache.worldBBox,
      );
  const padX = 4 / Math.max(cam.scale, 1e-6);
  const padY = 4 / Math.max(cam.scale, 1e-6);
  const bb = pcache.worldBBox;
  const halfW = w / 2 / Math.max(cam.scale, 1e-6);
  const halfH = h / 2 / Math.max(cam.scale, 1e-6);
  let dxs = rawDxs.filter((dx) => {
    const viewL = cam.x - dx - halfW - padX;
    const viewR = cam.x - dx + halfW + padX;
    const viewT = cam.y + halfH + padY;
    const viewB = cam.y - halfH - padY;
    return !(bb.maxX < viewL || bb.minX > viewR || bb.maxY < viewB || bb.minY > viewT);
  });
  if (!dxs.length) dxs = [rawDxs.length ? rawDxs[0] : contentOffsetX];
  const env = buildRenderEnv(ctx, world, cam, hoverId, dpr, opts);

  const pipeline = opts?.pipeline ?? defaultPipeline;
  const staticNames = new Set(['bg', 'cellsMesh', 'elements']);
  // GL 直绘：bg/cellsMesh/elements 由 GL 画布逐帧直绘（相机 uniform，无烘焙/无 drawImage）；
  // 返回 true 时 2D 画布只画余下层（透明底），底色在 GL 画布上
  const glReady = opts?.glScene
    ? opts.glScene.render(env, {
        cellsMesh: pipeline.some((l) => l.name === 'cellsMesh'),
        elements: pipeline.some((l) => l.name === 'elements'),
      })
    : false;
  // 每帧先清屏：贴图/图层未覆盖处不得留上一帧残影
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.restore();
  if (!glReady) {
    ctx.fillStyle = style.ocean;
    ctx.fillRect(0, 0, w, h);
  }

  // A cylindrical map bakes one complete period; non-periodic/oversized views draw directly.
  // 周期贴图：bg + cellsMesh + elements → drawImage 显示（缩放/拖动/平移用；GL 直绘不烘焙）
  // 局部重绘：样式/动作用，只更新贴图脏区域（不破坏周期贴图）
  const useStatic = !glReady && opts?.staticCache !== false && !opts?.singleWorldCopy;
  const staticLayers = useStatic
    ? pipeline.filter((l) => staticNames.has(l.name))
    : [];
  const rest = useStatic || glReady
    ? pipeline.filter((l) => !staticNames.has(l.name))
    : pipeline;

  if (staticLayers.length) {
    const tiled = period !== null &&
      drawPeriodicStatic(env, staticLayers, w, h, period);
    if (!tiled) {
      for (const layer of staticLayers) {
        if (!layer.repeat) {
          env.drawDx = contentOffsetX;
          layer.draw(env);
        } else {
          for (const dx of dxs) {
            env.drawDx = dx;
            layer.draw(env);
          }
        }
      }
    }
  }
  const restT0 = performance.now();
  for (const layer of rest) {
    if (!layer.repeat) {
      env.drawDx = contentOffsetX;
      layer.draw(env);
      continue;
    }
    for (const dx of dxs) {
      env.drawDx = dx;
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
      if (i >= cold.length) {
        opts?.onGeometryReady?.();
        return;
      }
      buildPieceParams({ ...env, displayPieces: [cold[i++]], warmQueue: undefined });
      opts?.onGeometryReady?.();
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
