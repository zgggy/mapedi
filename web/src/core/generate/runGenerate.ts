import { deserializeWorld, rebuildSharedEdgesFromCells } from '../world';
import type { World } from '../types';
import type { ProjCache } from '../../render/projCache';

export type GenProgress = { label: string; progress: number };

type DonePayload = { type: 'done'; world: World; projCache: ProjCache };
export type WorldWithCache = { world: World; projCache?: ProjCache };

function runWorker(
  req: {
    seed: number;
    count: number;
    profileParams?: Record<string, Record<string, number | string | boolean>>;
    loadJson?: string;
    /** 启用生成器白名单（撒点=仅地块传 []）；缺省 = 全部 */
    enabled?: string[];
  },
  onProgress?: (p: GenProgress) => void,
): Promise<WorldWithCache> {
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
        | DonePayload
        | { type: 'error'; message: string }
      >,
    ) => {
      const d = ev.data;
      if (d.type === 'progress') {
        onProgress?.({ label: d.label, progress: d.progress });
        return;
      }
      if (d.type === 'done') {
        worker.terminate();
        // Worker 侧剥离 sharedEdges（省克隆体积）：主线程按固定顺序重建（同 deserializeWorld）
        const world = d.world;
        if (!world.sharedEdges?.size && world.cells?.length) {
          world.sharedEdges = rebuildSharedEdgesFromCells(world);
        }
        resolve({ world, projCache: d.projCache });
        return;
      }
      worker.terminate();
      reject(new Error(d.message));
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(e.error ?? new Error(e.message));
    };
    worker.postMessage(req);
  });
}

/**
 * 在 Worker 中级联生成；主线程只收进度与结构化世界 + 预建投影缓存。
 * 无 Worker 环境时回退同步（小地图）。
 */
export function generateWorldAsync(
  seed: number,
  count: number,
  onProgress?: (p: GenProgress) => void,
  profileParams?: Record<string, Record<string, number | string | boolean>>,
  enabled?: string[],
): Promise<WorldWithCache> {
  return runWorker({ seed, count, profileParams, enabled }, onProgress);
}

/** 恢复路径：JSON → Worker 反序列化 + 预建投影缓存（主线程免双卡顿） */
export function loadWorldAsync(
  json: string,
  onProgress?: (p: GenProgress) => void,
): Promise<WorldWithCache> {
  return runWorker({ seed: 0, count: 0, loadJson: json }, onProgress);
}

/** 无 Worker 回退：主线程同步反序列化（无 projCache 预建） */
export function loadWorldSync(json: string): World {
  return deserializeWorld(json);
}
