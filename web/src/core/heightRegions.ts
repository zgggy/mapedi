/**
 * 高度色阶 API（12 档）+ 笔刷时陆海拓扑辅助。
 * 海陆元素重建见 core/layer/landSea.ts。
 */
import type { CellId, World } from './types';
import { HEIGHT_MIN, HEIGHT_MAX } from './layer/heightIntervals';
import {
  rebuildLandSeaRegions,
  landSeaKindOf,
  heightKindEmoji,
  lakeMaxCells,
  type LandSeaKind as HeightRegionKind,
} from './layer/landSea';

export { rebuildLandSeaRegions, landSeaKindOf, heightKindEmoji, lakeMaxCells };
export type { HeightRegionKind };
export const heightKindOf = landSeaKindOf;
export const rebuildHeightRegions = rebuildLandSeaRegions;

export const LAND_BASE_COLOR = '#C4A882';

const OCEAN_STOPS: [number, string][] = [
  [0.0, '#0A1A3A'],
  [0.125, '#1A3A6B'],
  [0.25, '#2A6A9B'],
  [0.375, '#4A8AB0'],
];

const LAND_STOPS: [number, string][] = [
  [0.4375, '#2A5A1A'],
  [0.5, '#4A7A3A'],
  [0.5625, '#8B8B2A'],
  [0.6875, '#C0C020'],
  [0.75, '#C0A040'],
  [0.8125, '#A0A0A0'],
  [0.875, '#C0C0C0'],
  [1.0, '#F5F0E0'],
];

const HEIGHT_STOPS: [number, string][] = [...OCEAN_STOPS, ...LAND_STOPS];

const HEIGHT_BINS: [number, number][] = [
  [-63, -55], [-54, -40], [-39, -25], [-24, 0],
  [1, 3], [4, 12], [13, 24], [25, 36],
  [37, 46], [47, 54], [55, 60], [61, 64],
];

const LEVEL_NAMES = [
  '深海', '远海', '近海', '浅滩',
  '海岸', '低地', '平原', '高平原',
  '丘陵', '山地', '高山', '顶峰',
];

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [128, 128, 128];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function heightToLevel(h: number): number {
  const clamped = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.round(h)));
  for (let i = 0; i < 12; i++) {
    if (clamped >= HEIGHT_BINS[i][0] && clamped <= HEIGHT_BINS[i][1]) return i;
  }
  return clamped <= 0 ? 3 : 4;
}

export function levelToRange(level: number): [number, number] {
  return HEIGHT_BINS[Math.min(11, Math.max(0, level))];
}

export function levelToName(level: number): string {
  return LEVEL_NAMES[Math.min(11, Math.max(0, level))];
}

export function levelToColor(level: number): string {
  return HEIGHT_STOPS[Math.min(11, Math.max(0, level))][1];
}

export function heightGradientColor(h: number): string {
  return levelToColor(heightToLevel(h));
}

/** 连续高度 → 0..11 的连续档位（档内线性，供色带插值） */
function heightToLevelF(h: number): number {
  const clamped = Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, h));
  for (let i = 0; i < 12; i++) {
    const [lo, hi] = HEIGHT_BINS[i];
    if (clamped >= lo && clamped <= hi) return i + (clamped - lo) / (hi - lo + 1e-9);
  }
  return clamped <= 0 ? 3 : 4;
}

/** 连续色带：12 档色之间线性插值（等高线是量化，这是平滑） */
export function heightRampColor(h: number): string {
  const lf = heightToLevelF(h);
  const i0 = Math.min(11, Math.max(0, Math.floor(lf)));
  const i1 = Math.min(11, i0 + 1);
  const t = lf - i0;
  const a = hexToRgb(HEIGHT_STOPS[i0][1]);
  const b = hexToRgb(HEIGHT_STOPS[i1][1]);
  const r = Math.round(a[0] + (b[0] - a[0]) * t);
  const g = Math.round(a[1] + (b[1] - a[1]) * t);
  const bl = Math.round(a[2] + (b[2] - a[2]) * t);
  return `rgb(${r},${g},${bl})`;
}

/** 区间边界内连续渐变：竖直方向 hMin→hMax。steps 个色标平滑过渡。 */
export function heightRampGradient(
  ctx: CanvasRenderingContext2D,
  x0: number, y0: number, x1: number, y1: number,
  hMin: number, hMax: number,
  steps = 16,
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  const span = hMax - hMin;
  if (Math.abs(span) < 1e-6) {
    g.addColorStop(0, heightRampColor(hMin));
    g.addColorStop(1, heightRampColor(hMin));
    return g;
  }
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    g.addColorStop(t, heightRampColor(hMin + t * span));
  }
  return g;
}

export const HEIGHT_COLOR_STOPS = HEIGHT_STOPS;

export function heightColor(_h: number): string {
  return LAND_BASE_COLOR;
}

/** 笔刷前后是否改变了陆地/海洋拓扑 */
export function heightTopologyChanged(samples: { h0: number; h1: number }[]): boolean {
  for (const s of samples) {
    if (s.h0 > 0 !== s.h1 > 0) return true;
  }
  return false;
}

/** 绘制中：陆地 cell 并入邻接大陆（多数票） */
export function absorbLandCell(world: World, cellId: CellId): boolean {
  const c = world.cells[cellId];
  if (!c || c.height <= 0) return false;
  const votes = new Map<number, number>();
  for (const n of c.neighbors) {
    const nc = world.cells[n];
    if (!nc || nc.height <= 0) continue;
    if (nc.continentId === undefined || nc.continentId < 0) continue;
    votes.set(nc.continentId, (votes.get(nc.continentId) ?? 0) + 1);
  }
  if (!votes.size) {
    if (c.continentId === undefined || c.continentId < 0) c.continentId = -1;
    return false;
  }
  let best = -1;
  let bn = -1;
  for (const [id, n] of votes) {
    if (n > bn || (n === bn && id < best)) {
      bn = n;
      best = id;
    }
  }
  c.continentId = best;
  return true;
}

/** 海洋 cell：清除大陆归属 */
export function releaseOceanCell(world: World, cellId: CellId): void {
  const c = world.cells[cellId];
  if (!c) return;
  if (c.height <= 0) c.continentId = undefined;
}
