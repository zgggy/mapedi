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
export type CoreSelector =
  | 'visualCenter'
  | 'centermost'
  | 'nearBoundary'
  | 'highElevation'
  | 'lowElevation'
  | 'random';

/**
 * 世界形状（height 层生成参数，单源）——**由 Perlin-FBM 算法一一导出**（见 core/terrain.ts）：
 * 大陆尺度→噪声频率；海岸破碎度→域扭曲；山脉强度→ridged-FBM 幅度；
 * 细节量→高频 FBM；海底起伏→海床/海沟噪声；占比/落差/平整率/侵蚀→后处理。
 */
export interface WorldShape {
  /** 期望陆地占比 0–1（UI：小 0.08 / 中 0.15 / 大 0.25 / 特大 0.40） */
  landRatio: number;
  /** 落差：生成后 max − min（20–127） */
  relief: number;
  /** 平整率 0–1：越大越多 cell 贴海平面 */
  flatness: number;
  /** 大陆尺度 0–1：越大越少越大（噪声频率越低） */
  continentScale: number;
  /** 海岸破碎度 0–1（域扭曲强度） */
  coastBreak: number;
  /** 山脉强度 0–1（ridged FBM 幅度） */
  mountain: number;
  /** 细节量 0–1（高频 FBM 幅度） */
  detail: number;
  /** 海底起伏 0–1（海床/海沟噪声） */
  seaRugged: number;
  /** 中低纬大陆倾向 0–1（越大越偏中低纬；高纬大陆墨卡托下拉伸难看） */
  latBias: number;
  /** 热侵蚀迭代 0–6 */
  erosion: number;
}

export const DEFAULT_WORLD_SHAPE: WorldShape = {
  landRatio: 0.15,
  relief: 127,
  flatness: 0,
  continentScale: 0.5,
  coastBreak: 0.55,
  mountain: 0.7,
  detail: 0.5,
  seaRugged: 0.8,
  latBias: 0.55,
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
  // 源层已改由层树派生（HIERARCHY D1，包3）——原 fromLayerId 字段退役
  /** method=fromLayer 时每个新元素聚合几个源元素 */
  fromLayerCount?: number;
  /** 元素名池（缺省用通用名） */
  names?: string[];
  /** 元素色池 */
  colors?: string[];
  /** 勾选才生成海上元素（海国等） */
  allowOcean?: boolean;
}
