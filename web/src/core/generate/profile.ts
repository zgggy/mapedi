import type { LayerId, World } from '../types';
import { DEFAULT_WORLD_SHAPE } from '../layer/genTypes';
// 顺序与数据依赖单源归 registry（HIERARCHY §6.3 包3）：CASCADE 数组已删、
// profiles 的依赖字段移除（落盘本就只存 {layerId, params}，零迁移）。
import { cascadeEnabled } from './registry';

export { cascadeEnabled };

export interface GenerationProfile {
  layerId: LayerId;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
}

export function defaultProfiles(): GenerationProfile[] {
  return [
    {
      layerId: 'height',
      enabled: true,
      params: {
        landRatio: DEFAULT_WORLD_SHAPE.landRatio,
        relief: DEFAULT_WORLD_SHAPE.relief,
        flatness: DEFAULT_WORLD_SHAPE.flatness,
        continentScale: DEFAULT_WORLD_SHAPE.continentScale,
        coastBreak: DEFAULT_WORLD_SHAPE.coastBreak,
        mountain: DEFAULT_WORLD_SHAPE.mountain,
        detail: DEFAULT_WORLD_SHAPE.detail,
        seaRugged: DEFAULT_WORLD_SHAPE.seaRugged,
        latBias: DEFAULT_WORLD_SHAPE.latBias,
        erosion: DEFAULT_WORLD_SHAPE.erosion,
      },
    },
    {
      layerId: 'province',
      enabled: true,
      params: { count: 15 },
    },
    {
      layerId: 'country',
      enabled: true,
      params: { count: 8, fromLayerCount: 3, allowOcean: false },
    },
    {
      layerId: 'environment',
      enabled: true,
      params: { count: 8 },
    },
    {
      layerId: 'vegetation',
      enabled: true,
      params: { count: 8 },
    },
    {
      layerId: 'fauna',
      enabled: true,
      params: { count: 6 },
    },
    {
      layerId: 'race',
      enabled: true,
      params: { count: 5 },
    },
    {
      layerId: 'culture',
      enabled: true,
      params: { count: 8, allowOcean: true },
    },
    {
      layerId: 'religion',
      enabled: true,
      params: { count: 5 },
    },
    {
      layerId: 'military',
      enabled: true,
      params: { count: 6 },
    },
    {
      layerId: 'river',
      enabled: true,
      params: {},
    },
    {
      layerId: 'road',
      enabled: true,
      params: { k: 3, slopeCost: 2, forestCost: 1.2 },
    },
    {
      layerId: 'route',
      enabled: true,
      params: { maxPorts: 8 },
    },
  ];
}

export function profileFor(
  profiles: GenerationProfile[],
  layerId: LayerId,
): GenerationProfile | undefined {
  return profiles.find((p) => p.layerId === layerId);
}
