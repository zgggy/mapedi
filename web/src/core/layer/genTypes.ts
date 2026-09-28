/**
 * 生成配置：形状与枚举（单源）。
 * 各层默认值见 layer.ts 的 defaultGenConfig；消费见 generate/unified.ts。
 */
import type { LayerId } from '../types';
import { DEFAULT_HMF2D, type Hmf2DParams } from '../heightmap2d';

export type GenMethod = 'diffusion' | 'randomConnected' | 'fromLayer';
export type GenScope = 'oceanOnly' | 'landOnly' | 'noCrossLandSea' | 'unlimited' | 'fromLayer';
export type GenPattern =
  | 'partitionLand'
  | 'partitionOcean'
  | 'partitionAll'
  | 'scattered'
  | 'longStrip'
  | 'cluster';
export type CoreSelector = 'centermost' | 'nearBoundary' | 'highElevation' | 'lowElevation' | 'random';

/**
 * 世界形状（height 层生成参数，单源）= **Perlin + HMF + Domain Warp 高度图参数**
 * （见 core/heightmap2d.ts）：scale/octaves/lacunarity/persistence → HMF 频谱；
 * hmfGain/hmfOffset → 多分形高度反馈；warpStrength/warpScale → 域扭曲；
 * seaLevel → 陆海比例阈值。
 */
export type WorldShape = Hmf2DParams;
export const DEFAULT_WORLD_SHAPE = DEFAULT_HMF2D;

export interface GenConfig {
  method: GenMethod;
  scope: GenScope;
  pattern: GenPattern;
  coreSelector: CoreSelector;
  count: number;
  seed: number;
  /** method=diffusion 时的径向参数（高度场） */
  diffusion?: { falloff: number; radius: number; roughness: number; peakHeight: number };
  /** height 层：世界形状（Perlin+HMF 高度图参数，见 WorldShape） */
  worldShape?: WorldShape;
  /** method=fromLayer 时的源图层 */
  fromLayerId?: LayerId;
  /** method=fromLayer 时每个新元素聚合几个源元素 */
  fromLayerCount?: number;
  /** 元素名池（缺省用通用名） */
  names?: string[];
  /** 元素色池 */
  colors?: string[];
  /** 勾选才生成海上元素（海国等） */
  allowOcean?: boolean;
}
