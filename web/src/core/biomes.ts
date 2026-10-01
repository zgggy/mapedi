import type { BiomeId, Region, World } from './types';
import { createRng, hashSeed } from './rng';
import { ensureClimate } from './climate';
import { heightRev } from './rev';

export const BIOME_META: Record<
  BiomeId,
  { name: string; emoji: string; color: string }
> = {
  ocean: { name: '海洋', emoji: '🌊', color: '#1a3348' },
  coast: { name: '海岸', emoji: '🏖️', color: '#c2b280' },
  ice: { name: '冰盖', emoji: '🧊', color: '#e8f4ff' },
  snow: { name: '雪地', emoji: '❄️', color: '#d8e8f0' },
  tundra: { name: '冻土', emoji: '🥶', color: '#8a9a8a' },
  taiga: { name: '针叶林', emoji: '🌲', color: '#2d5a3d' },
  temperate_forest: { name: '温带森林', emoji: '🌳', color: '#3d7a4a' },
  grassland: { name: '草原', emoji: '🌾', color: '#8fad5a' },
  desert: { name: '沙漠', emoji: '🏜️', color: '#d2b48c' },
  savanna: { name: '稀树草原', emoji: '🦒', color: '#c4a35a' },
  rainforest: { name: '雨林', emoji: '🌴', color: '#1f6b3a' },
  wetland: { name: '湿地', emoji: '🐸', color: '#4a7a6a' },
  mountain: { name: '高山', emoji: '⛰️', color: '#7a7a72' },
};

/** Whittaker 近似 + 用户点名项 */
export function classifyBiome(
  tC: number,
  precip: number,
  height: number,
  coastDist: number,
): BiomeId {
  if (height <= 0) return 'ocean';
  if (height > 0.75) return 'mountain';
  if (tC < -12) return 'ice';
  if (tC < -6) return 'snow';
  if (tC < 4) return precip < 0.45 ? 'tundra' : 'taiga';
  if (tC < 10) return precip > 0.5 ? 'taiga' : 'tundra';
  if (tC < 16) {
    if (precip > 0.55) return 'temperate_forest';
    if (precip > 0.28) return 'grassland';
    return 'desert';
  }
  // 暖
  if (precip > 0.7) return 'rainforest';
  if (precip > 0.45) return tC > 24 ? 'savanna' : 'temperate_forest';
  if (precip > 0.25) return tC > 24 ? 'savanna' : 'grassland';
  return 'desert';
}

/** 群系派生缓存的"算毕于"修订号（与气候同款模块级戳，单活世界） */
let biomeAtRev = -1;

/** 纯分类：写 world.biome（需要气候已算），**不碰 Region**——区域同步归 generateBiomes */
export function computeBiomes(world: World): Map<number, BiomeId> {
  if (!world.cellClimate) {
    throw new Error('generateBiomes requires computeClimate first');
  }
  const biome = new Map<number, BiomeId>();
  for (const cell of world.cells) {
    const cl = world.cellClimate.get(cell.id)!;
    let b = classifyBiome(
      cl.temperatureC,
      cl.precipitation,
      cell.height,
      cl.coastDist,
    );
    // 沿海陆地给 coast
    if (cell.height > 0 && cl.coastDist <= 1 && b !== 'ice' && b !== 'desert') {
      if (cl.temperatureC > 8) b = 'coast';
    }
    // 邻接海洋的低地湿地
    if (cell.height > 0 && cell.height < 0.08 && cl.precipitation > 0.65 && cl.coastDist <= 2) {
      b = 'wetland';
    }
    biome.set(cell.id, b);
  }
  world.biome = biome;
  biomeAtRev = heightRev();
  return biome;
}

/** 生成/刷新 world.biome，并重建 environment 层 Region 聚合 */
export function generateBiomes(world: World): Map<number, BiomeId> {
  const biome = computeBiomes(world);
  syncEnvironmentRegions(world, biome);
  return biome;
}

/**
 * 群系按需重算入口（还债步骤 4，真缓存语义）：气候与群系戳任一落后 heightRev 即重算。
 * biome 不落盘（serializeWorld 已删）——跨会话首读必算，会话内高度变更下一读即新地形。
 * 读方（河网代价/GeoJSON 导出）批量前调一次，禁止逐 cell 循环内调用。
 */
export function ensureBiome(world: World): Map<number, BiomeId> {
  ensureClimate(world);
  if (!world.biome || biomeAtRev !== heightRev()) computeBiomes(world);
  return world.biome!;
}

/** 把群系聚成 environment 层 Region（每个群系一个大陆连通块可多 Region，P5 先整类一个） */
export function syncEnvironmentRegions(world: World, biome: Map<number, BiomeId>): void {
  world.regions = world.regions.filter((r) => r.layerId !== 'environment');
  const groups = new Map<BiomeId, number[]>();
  for (const [id, b] of biome) {
    const arr = groups.get(b);
    if (arr) arr.push(id);
    else groups.set(b, [id]);
  }
  let i = 0;
  for (const [b, cells] of groups) {
    if (!cells.length) continue;
    const meta = BIOME_META[b];
    world.regions.push({
      id: `env-${b}-${i++}`,
      layerId: 'environment',
      name: meta.name,
      cells,
      color: meta.color,
      attributes: { biome: b, emoji: meta.emoji },
    });
  }
}

export function biomeAt(world: World, cellId: number): BiomeId {
  return world.biome?.get(cellId) ?? (world.cells[cellId]?.height > 0 ? 'grassland' : 'ocean');
}

export function environmentRegions(world: World): Region[] {
  return world.regions.filter((r) => r.layerId === 'environment');
}

/** 供生成参数随机用 */
export function sampleBiomeSeed(seed: number): number {
  return hashSeed(seed, 777) || createRng(seed)() * 1e9;
}
