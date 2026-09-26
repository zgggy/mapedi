/**
 * 高度色阶 API + 笔刷时陆海拓扑辅助。
 * 12 档的区间 / 名称 / 色值单源 = core/layer/heightIntervals（本文件不复制表）。
 * 海陆元素重建见 core/layer/landSea.ts。
 */
import type { CellId, World } from './types';
import { heightToIntervalIndex, intervalByIndex } from './layer/heightIntervals';
import {
  rebuildLandSeaRegions,
  landSeaKindOf,
  lakeMaxCells,
} from './layer/landSea';

export { rebuildLandSeaRegions, landSeaKindOf, lakeMaxCells };
export const heightKindOf = landSeaKindOf;
/** @deprecated 旧名，tests 仍引用；新代码用 rebuildLandSeaRegions */
export const rebuildHeightRegions = rebuildLandSeaRegions;

/** 高度 → 12 档离散色 */
export function heightGradientColor(h: number): string {
  return intervalByIndex(heightToIntervalIndex(h)).color;
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
