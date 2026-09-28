/// <reference lib="webworker" />
import { createWorld, serializeWorld } from '../world';
import { runCascade, CASCADE_LABELS } from './registry';
import { defaultClimate } from '../types';

export interface GenRequest {
  seed: number;
  count: number;
  /** profile 面板参数（layerId → params）；缺省用生成器默认 */
  profileParams?: Record<string, Record<string, number | string | boolean>>;
}

self.onmessage = (ev: MessageEvent<GenRequest>) => {
  const { seed, count, profileParams } = ev.data;
  const post = (label: string, progress: number) => {
    self.postMessage({ type: 'progress', label, progress });
  };

  try {
    // 0–45%：Voronoi + 拓扑（createWorld 内部分段）
    const world = createWorld({ seed, count }, (label, frac) => {
      post(label, Math.min(45, Math.round(frac * 45)));
    });
    world.climate = { ...defaultClimate(), ...world.climate };

    // 45–98%：级联生成
    runCascade(world, seed, undefined, (id, i, n) => {
      const p = 45 + Math.round((i / n) * 53);
      post(CASCADE_LABELS[id] ?? id, p);
    }, profileParams);

    post('完成', 100);
    // 不传 sharedEdges：主线程按固定顺序重建，JSON 体积小一个数量级
    self.postMessage({ type: 'done', json: serializeWorld(world, { stripSharedEdges: true }) });
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
