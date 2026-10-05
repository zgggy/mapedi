/**
 * 统一图层元素 + 各层生成默认配置。
 * 元素数据 = Region；行为/能力见 core/layer/config.ts（实例+参数）；
 * 生成配置形状（GenConfig/枚举）见 core/layer/genTypes.ts。
 */
import type { LayerId, World } from './types';

export type { ElementOverlap } from './types';
import { DEFAULT_WORLD_SHAPE, type GenConfig, type GenMethod, type GenScope, type GenPattern, type CoreSelector, type WorldShape } from './layer/genTypes';
export type {
  LayerConfig,
  PlacementRule,
  SplitPolicy,
  LandSeaRule,
  ElementSource,
} from './layer/config';
export {
  defaultLayerConfigs,
  defaultLayerConfig,
  placementAllows,
} from './layer/config';
export type { ElementStyle } from './layer/style';
export { HEIGHT_INTERVALS, heightToIntervalIndex, intervalById, intervalByIndex } from './layer/heightIntervals';

/** 各图层默认生成配置（唯一真相，registry 只引用此处） */
// 色池已删（2026-10-04 用户定）：缺省取色 = core/layer/palette 彩虹板 24 色轮转；
// 子图层元素 = 父元素色 tintOf 微调（生成聚合与缩进两路共用）。
export function defaultGenConfig(layerId: LayerId, seed: number): GenConfig {
  const base: GenConfig = {
    method: 'randomConnected', scope: 'unlimited', pattern: 'scattered',
    coreSelector: 'random', count: 6, seed,
  };
  switch (layerId) {
    case 'height':
      return {
        ...base,
        method: 'diffusion', scope: 'unlimited', pattern: 'cluster',
        coreSelector: 'random', count: 6,
        diffusion: { falloff: 2.0, radius: 0.6, roughness: 0.8, peakHeight: 0.8 },
      };
    case 'province':
      return {
        ...base,
        method: 'randomConnected', scope: 'noCrossLandSea', pattern: 'partitionLand',
        // 省会默认 = 视觉中心（P7：面内最宽阔处；用户可在检查区改「设中心」）
        coreSelector: 'visualCenter', count: 15,
        names: ['甲郡', '乙道', '丙州', '丁都', '戊府', '己县', '庚乡', '辛里', '壬亭', '癸邑'],
      };
    case 'country':
      return {
        ...base,
        method: 'fromLayer', scope: 'landOnly', pattern: 'partitionLand',
        // 首都默认 = 视觉中心（P7：凹形/狭长时质心会偏，最大内接处不会）
        coreSelector: 'visualCenter', count: 8,
        fromLayerCount: 3, // 源层从层树派生（D1），原 province 常量退役
        names: ['华夏', '罗马', '波斯', '埃及', '印度', '希腊', '腓尼基', '阿拉伯'],
      };
    case 'ecosystem':
      return {
        ...base,
        method: 'randomConnected', scope: 'landOnly', pattern: 'cluster',
        coreSelector: 'random', count: 12,
        names: ['阔叶林', '针叶林', '草原', '灌丛', '竹林', '苔原', '红树林', '高山草甸', '鹿群', '狼群', '狮群', '象群', '鹰群', '鱼群', '雨林', '沙漠', '冻原', '湿地'],
      };
    case 'race':
      return {
        ...base,
        method: 'randomConnected', scope: 'landOnly', pattern: 'partitionLand',
        coreSelector: 'random', count: 5,
        names: ['山民', '平原民', '林民', '海民', '雪民'],
      };
    case 'culture':
      return {
        ...base,
        method: 'randomConnected', scope: 'landOnly', pattern: 'cluster',
        coreSelector: 'highElevation', count: 8,
        names: ['阿尔泰', '瓦兰', '赛里斯', '努米底亚', '维京', '高棉', '玛雅', '波斯'],
      };
    default:
      // 自定义层：走 base（散布 · 随机核心 · count6）
      return base;
  }
}

/** 从 params 覆盖 GenConfig（profile 面板写入的 count 等） */
export function genConfigFromParams(
  layerId: LayerId,
  seed: number,
  params?: Record<string, number | string | boolean>,
): GenConfig {
  const cfg = defaultGenConfig(layerId, seed);
  if (!params) return cfg;
  if (typeof params.count === 'number') cfg.count = params.count;
  if (typeof params.method === 'string') cfg.method = params.method as GenMethod;
  if (typeof params.scope === 'string') cfg.scope = params.scope as GenScope;
  if (typeof params.pattern === 'string') cfg.pattern = params.pattern as GenPattern;
  if (typeof params.coreSelector === 'string') cfg.coreSelector = params.coreSelector as CoreSelector;
  // 原 params.fromLayerId 覆盖已删（D1 派生单源；旧档草稿里的同名键被忽略）
  if (typeof params.fromLayerCount === 'number') cfg.fromLayerCount = params.fromLayerCount;
  if (typeof params.allowOcean === 'boolean') cfg.allowOcean = params.allowOcean;
  // height：世界形状（大陆占比/落差/平整率/大陆数/穿极/崎岖/海底起伏/侵蚀）
  const shape: WorldShape = { ...DEFAULT_WORLD_SHAPE };
  let hasShape = false;
  if (typeof params.landRatio === 'number') { shape.landRatio = params.landRatio; hasShape = true; }
  if (typeof params.relief === 'number') { shape.relief = params.relief; hasShape = true; }
  if (typeof params.flatness === 'number') { shape.flatness = params.flatness; hasShape = true; }
  if (typeof params.continentScale === 'number') { shape.continentScale = params.continentScale; hasShape = true; }
  if (typeof params.coastBreak === 'number') { shape.coastBreak = params.coastBreak; hasShape = true; }
  if (typeof params.mountain === 'number') { shape.mountain = params.mountain; hasShape = true; }
  if (typeof params.detail === 'number') { shape.detail = params.detail; hasShape = true; }
  if (typeof params.seaRugged === 'number') { shape.seaRugged = params.seaRugged; hasShape = true; }
  if (typeof params.latBias === 'number') { shape.latBias = params.latBias; hasShape = true; }
  if (typeof params.erosion === 'number') { shape.erosion = params.erosion; hasShape = true; }
  if (hasShape) cfg.worldShape = shape;
  return cfg;
}

/** 允许重叠（LayerDef.allowOverlap，缺省 false） */
export function layerAllowsOverlap(world: World, layerId: LayerId): boolean {
  return world.layers.find((l) => l.id === layerId)?.allowOverlap ?? false;
}

/** 元素是否要求核心（LayerDef.requireCenter） */
export function layerRequiresCenter(world: World, layerId: LayerId): boolean {
  return world.layers.find((l) => l.id === layerId)?.requireCenter ?? false;
}
