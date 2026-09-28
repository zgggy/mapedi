/**
 * 高度生成入口：**统一地形模型的薄封装**（实现见 `core/terrain.ts`）。
 * 保留 `generateDemoContinents` / `assignContinents` 对外签名（生成链与测试同用）。
 */
import type { World } from './types';
import { buildTerrain } from './terrain';
import { DEFAULT_WORLD_SHAPE, type WorldShape } from './layer/genTypes';
import { landContinentsCSR } from './index/cellGraph';

export function assignContinents(world: World): void {
  const continents = landContinentsCSR(world);
  for (let i = 0; i < continents.length; i++) {
    for (const id of continents[i]) world.cells[id].continentId = i;
  }
  // 生成期种子（供笔刷多数票）；landSea rebuild 后以大陆 Region 顺序为准
}

/** 大陆生成：统一地形模型（大陆度/山系/细节 + 侵蚀去尖刺 + 刻度映射） */
export function generateDemoContinents(
  world: World,
  seed: number,
  onProgress?: (label: string, frac: number) => void,
  shape: WorldShape = DEFAULT_WORLD_SHAPE,
): void {
  buildTerrain(world, seed, shape, onProgress);
  onProgress?.('大陆归属', 0.96);
  assignContinents(world);
  onProgress?.('完成', 1);
}
