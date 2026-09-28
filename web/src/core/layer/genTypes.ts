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

/**
 * 世界形状（height 层生成参数，单源）。
 * 平整率语义：越大越「平」——更多 cell 贴近海平面 0；0 = 高度分位正态铺开。
 */
export interface WorldShape {
  /** 期望陆地占比 0–1（UI：小 0.08 / 中 0.15 / 大 0.25 / 特大 0.40） */
  landRatio: number;
  /** 落差：生成后 max − min（20–127，模型整数域内） */
  relief: number;
  /** 平整率 0–1：越大越多 cell 贴 0 */
  flatness: number;
  /** 附加大陆个数（不含穿极大陆） */
  continentCount: number;
  /** 穿极大陆（产品默认开：默认大陆穿极且至少一端贴极） */
  polar: boolean;
  /** 山脉崎岖 0–1（域扭曲/山脊掩码强度） */
  roughness: number;
  /** 海底起伏 0–1（海沟/陆架波动） */
  seaRugged: number;
  /** 热侵蚀迭代 0–4 */
  erosion: number;
}

export const DEFAULT_WORLD_SHAPE: WorldShape = {
  landRatio: 0.15,
  relief: 127,
  flatness: 0,
  continentCount: 5,
  polar: true,
  roughness: 0.8,
  seaRugged: 1,
  erosion: 2,
};


export interface GenConfig {
  method: GenMethod;
  scope: GenScope;
  pattern: GenPattern;
  coreSelector: CoreSelector;
  count: number;
  seed: number;
  /** method=diffusion 时的径向参数（高度场） */
  diffusion?: { falloff: number; radius: number; roughness: number; peakHeight: number };
  /** height 层：世界形状（大陆占比/落差/平整率等，见 WorldShape） */
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
