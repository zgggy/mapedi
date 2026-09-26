/**
 * 球面贴图：先把世界按 2D 管线渲染到等距柱状画布，再贴到 Three.js 球体。
 * 与平面视图同一套图层/着色/边界/道路等。
 */
import type { World } from '../core/types';
import { buildFillsForFocus } from './cellColor';
import { defaultProjParams } from '../core/project/projections';
import { drawWorld } from './map2d';

export interface EquirectRenderOpts {
  focusLayer: string;
  styleId: string;
  reliefSmooth: number;
  showLabels?: boolean;
  highlightRegionId?: string | null;
  width?: number;
  height?: number;
}

/** 世界 → equirect 画布（lon → u，lat +90..-90 → v） */
export function renderEquirectMap(
  world: World,
  opts: EquirectRenderOpts,
): HTMLCanvasElement {
  const W = opts.width ?? 2048;
  const H = opts.height ?? 1024;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const scale = W / (2 * Math.PI);
  const cam = { x: 0, y: 0, scale };
  const fills = buildFillsForFocus(world, opts.focusLayer);
  void fills;
  drawWorld(ctx, world, cam, null, 1, {
    focusLayer: opts.focusLayer,
    projection: 'globe',
    projParams: defaultProjParams(),
    styleId: opts.styleId,
    reliefSmooth: opts.reliefSmooth,
    showLabels: opts.showLabels ?? true,
    highlightRegionId: opts.highlightRegionId,
  });
  return canvas;
}
