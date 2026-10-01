import type { BiomeId, World } from './types';
import { ensureClimate } from './climate';
import { heightRev } from './rev';



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








