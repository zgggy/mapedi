import type { LayerId, World } from '../types';
import { DEFAULT_WORLD_SHAPE } from '../layer/genTypes';

export interface GenerationProfile {
  layerId: LayerId;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
  dependsOn: LayerId[];
}

export const CASCADE_ORDER: LayerId[] = [
  'height',
  'province',
  'country',
  'environment',
  'vegetation',
  'fauna',
  'race',
  'culture',
  'religion',
  'military',
  'river',
  'road',
  'route',
];

export function defaultProfiles(): GenerationProfile[] {
  return [
    {
      layerId: 'height',
      enabled: true,
      params: { ...DEFAULT_WORLD_SHAPE },
      dependsOn: [],
    },
    {
      layerId: 'province',
      enabled: true,
      params: { count: 15 },
      dependsOn: ['height'],
    },
    {
      layerId: 'country',
      enabled: true,
      params: { count: 8, fromLayerCount: 3, allowOcean: false },
      dependsOn: ['province'],
    },
    {
      layerId: 'environment',
      enabled: true,
      params: { count: 8 },
      dependsOn: ['height'],
    },
    {
      layerId: 'vegetation',
      enabled: true,
      params: { count: 8 },
      dependsOn: ['height'],
    },
    {
      layerId: 'fauna',
      enabled: true,
      params: { count: 6 },
      dependsOn: ['height'],
    },
    {
      layerId: 'race',
      enabled: true,
      params: { count: 5 },
      dependsOn: ['height'],
    },
    {
      layerId: 'culture',
      enabled: true,
      params: { count: 8, allowOcean: true },
      dependsOn: ['height'],
    },
    {
      layerId: 'religion',
      enabled: true,
      params: { count: 5 },
      dependsOn: ['height'],
    },
    {
      layerId: 'military',
      enabled: true,
      params: { count: 6 },
      dependsOn: ['height'],
    },
    {
      layerId: 'river',
      enabled: true,
      params: {},
      dependsOn: ['height'],
    },
    {
      layerId: 'road',
      enabled: true,
      params: { k: 3, slopeCost: 2, forestCost: 1.2 },
      dependsOn: ['country'],
    },
    {
      layerId: 'route',
      enabled: true,
      params: { maxPorts: 8 },
      dependsOn: ['country'],
    },
  ];
}

export function profileFor(
  profiles: GenerationProfile[],
  layerId: LayerId,
): GenerationProfile | undefined {
  return profiles.find((p) => p.layerId === layerId);
}

export function cascadeEnabled(profiles: GenerationProfile[]): LayerId[] {
  return CASCADE_ORDER.filter((id) => profileFor(profiles, id)?.enabled !== false);
}
