/**
 * 双模式相机记忆：「球面展示 ↔ 平面绘制」各自保留视角（设计稿 §2.1-2）。
 *
 * 两个视图是**互斥挂载**的（App 里 `{#if viewMode}`，切换即卸载重建），组件内状态
 * 会随卸载丢掉——所以存在组件外的模块单例里。换世界时清空（App 在 projectEpoch
 * 变化时调 clearViewMemory），避免把旧世界的取景带到新世界。
 */
import type { Camera } from '../render/map2d';

export interface GlobePose {
  pos: [number, number, number];
  target: [number, number, number];
}

export const viewMemory: {
  plane: { cam: Camera; contentOffsetX: number } | null;
  globe: GlobePose | null;
} = {
  plane: null,
  globe: null,
};

export function clearViewMemory(): void {
  viewMemory.plane = null;
  viewMemory.globe = null;
}
