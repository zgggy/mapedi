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
import { defaultPipeline, type RenderEnv, type RenderLayer } from './layers';
import { worldCopyDxs } from './space';
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
    /** P1 静态层合成缓存（默认开；路径编辑关） */
    staticCache?: boolean;
    /** 平移/缩放中：跳过脏区域重烘焙（贴图 1:1 显示，不拉伸） */
    isDragging?: boolean;
  },
): void {
  const w = ctx.canvas.width / dpr;
  const h = ctx.canvas.height / dpr;
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
  const env: RenderEnv = {
    ctx,
    world,
    cam,
    hoverId,
    dpr,
    w,
    h,
    style: styleById(opts?.styleId ?? 'dark'),
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

  const pipeline = opts?.pipeline ?? defaultPipeline;

  // A cylindrical map bakes one complete period; non-periodic/oversized views draw directly.
  // 周期贴图：bg + cellsMesh + elements → drawImage 显示（缩放/拖动/平移用）
  // 局部重绘：样式/动作用，只更新贴图脏区域（不破坏周期贴图）
  const useStatic = opts?.staticCache !== false && !opts?.singleWorldCopy;
  const staticNames = new Set(['bg', 'cellsMesh', 'elements']);
  const staticLayers = useStatic
    ? pipeline.filter((l) => staticNames.has(l.name))
    : [];
  const rest = useStatic
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
  env.drawDx = contentOffsetX;
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
