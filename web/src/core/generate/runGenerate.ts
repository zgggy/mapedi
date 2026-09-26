import { deserializeWorld } from '../world';
import type { World } from '../types';

export type GenProgress = { label: string; progress: number };

/**
 * 在 Worker 中级联生成；主线程只收进度与最终 JSON。
 * 无 Worker 环境时回退同步（小地图）。
 */
export function generateWorldAsync(
  seed: number,
  count: number,
  onProgress?: (p: GenProgress) => void,
): Promise<World> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') {
      reject(new Error('Worker unavailable'));
      return;
    }
    const worker = new Worker(new URL('./worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (
      ev: MessageEvent<
        | { type: 'progress'; label: string; progress: number }
        | { type: 'done'; json: string }
        | { type: 'error'; message: string }
      >,
    ) => {
      const d = ev.data;
      if (d.type === 'progress') {
        onProgress?.({ label: d.label, progress: d.progress });
        return;
      }
      if (d.type === 'done') {
        try {
          const world = deserializeWorld(d.json);
          worker.terminate();
          resolve(world);
        } catch (e) {
          worker.terminate();
          reject(e);
        }
        return;
      }
      worker.terminate();
      reject(new Error(d.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(e.error ?? new Error(e.message));
    };
    worker.postMessage({ seed, count });
  });
}
