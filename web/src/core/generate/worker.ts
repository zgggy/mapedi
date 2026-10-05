/// <reference lib="webworker" />
import { createWorld, serializeWorld, deserializeWorld } from '../world';
import { runCascade, CASCADE_LABELS } from './registry';
import { defaultClimate } from '../types';
import { defaultProjParams } from '../project/projections';
import { buildProjCache } from '../../render/projCache';

export interface GenRequest {
  seed: number;
  count: number;
  /** profile 面板参数（layerId → params）；缺省用生成器默认 */
  profileParams?: Record<string, Record<string, number | string | boolean>>;
  /** 恢复路径：传已存 JSON，回 {world, projCache}（免主线程反序列化 + 首建） */
  loadJson?: string;
  /** 启用生成器白名单（2026-10-06 撒点=仅地块：传 [] 跳过全部生成器，世界=cells+空内置层） */
  enabled?: string[];
}

/** 世界按固定顺序重建 sharedEdges（与旧 JSON stripSharedEdges 同语义），projCache 走转移 */
function postDone(world: ReturnType<typeof createWorld>) {
  const projCache = buildProjCache(world, 'mercator', defaultProjParams());
  const plain = { ...world };
  delete (plain as Record<string, unknown>).sharedEdges;
  const transfer: Transferable[] = [];
  for (const p of projCache.polys) if (p.length) transfer.push(p.buffer as ArrayBuffer);
  transfer.push(projCache.centers.buffer as ArrayBuffer, projCache.bboxes.buffer as ArrayBuffer);
  for (const v of projCache.polarOutlines.values()) transfer.push(v.buffer as ArrayBuffer);
  self.postMessage({ type: 'done', world: plain, projCache }, transfer);
}

self.onmessage = (ev: MessageEvent<GenRequest>) => {
  const { seed, count, profileParams, loadJson, enabled } = ev.data;
  const post = (label: string, progress: number) => {
    self.postMessage({ type: 'progress', label, progress });
  };

  try {
    if (loadJson) {
      post('恢复世界', 50);
      const world = deserializeWorld(loadJson);
      world.climate = { ...defaultClimate(), ...world.climate };
      post('预建投影缓存', 80);
      postDone(world);
      return;
    }

    // 0–45%：Voronoi + 拓扑（createWorld 内部分段）
    const world = createWorld({ seed, count }, (label, frac) => {
      post(label, Math.min(45, Math.round(frac * 45)));
    });
    world.climate = { ...defaultClimate(), ...world.climate };

    // 45–90%：级联生成
    runCascade(world, seed, undefined, (id, i, n) => {
      const p = 45 + Math.round((i / n) * 45);
      post(CASCADE_LABELS[id] ?? id, p);
    }, profileParams, enabled ? new Set(enabled) : undefined);

    // 90–100%：顺带建投影缓存（主线程零首建）
    post('预建投影缓存', 92);
    postDone(world);
    post('完成', 100);
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
