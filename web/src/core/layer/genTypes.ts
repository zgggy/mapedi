/**
 * 生成配置：形状与枚举（单源）。
 * 各层默认值见 layer.ts 的 defaultGenConfig；消费见 generate/unified.ts。
 */
import type { LayerId } from '../types';

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

export interface GenConfig {
  method: GenMethod;
  scope: GenScope;
  pattern: GenPattern;
  coreSelector: CoreSelector;
  count: number;
  seed: number;
  /** method=diffusion 时的径向参数（高度场） */
  diffusion?: { falloff: number; radius: number; roughness: number; peakHeight: number };
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
