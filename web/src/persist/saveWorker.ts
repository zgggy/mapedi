/// <reference lib="webworker" />
/**
 * 自动保存 Worker（2026-10-01 还债步骤 3）：
 * world **结构化克隆**进线程 → serializeWorld + idbSave 全程离主线程。
 * 主线程只剩原生 clone（比 JSON.stringify 快数倍且无转义/解析往返）。
 * 协议：{ id, world } → { id, ok, error? }；主线程按 busy/latest-wins 排队。
 */
import { serializeWorld } from '../core/world';
import type { World } from '../core/types';
import { idbSave } from './storage';

interface Req {
  id: number;
  world: World;
}
interface Res {
  id: number;
  ok: boolean;
  error?: string;
}

const ctx = self;
ctx.onmessage = (e: MessageEvent<Req>) => {
  const { id, world } = e.data;
  try {
    const json = serializeWorld(world, { stripSharedEdges: true });
    idbSave(json)
      .then(() => ctx.postMessage({ id, ok: true } satisfies Res))
      .catch((err) => ctx.postMessage({ id, ok: false, error: String(err) } satisfies Res));
  } catch (err) {
    ctx.postMessage({ id, ok: false, error: String(err) } satisfies Res);
  }
};

export {};
