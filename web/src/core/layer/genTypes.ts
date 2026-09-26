/** 生成配置枚举（与 layer.ts 的 GenConfig 对齐，避免环依赖） */
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
