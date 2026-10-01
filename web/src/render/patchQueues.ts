/**
 * 渲染补丁队列（还债步骤 5-a）：原为 store 私有字段，渲染侧曾反向 import store 消费——
 * 抽为独立模块单例（与 core/rev.ts 同款先例：单活世界/单渲染器）。
 * 写方 = store / 派生管线；读方 = Viewport（消费后打件环补丁）。
 *
 * 不变量（2026-10-01 速修包 ②）：同键 Δ 合成入列——球面视图不消费队列时
 * 「键数 = 上界」，杜绝无限增长。
 */
import type { HeightIntervalDelta } from '../core/layer/heightElements';

export type PiecePatch = { setKey: string; added: number[]; removed: number[] };

/** 提交后需定向失效的件前缀（渲染侧消费；守「全清/补丁」不变量） */
let pieceInvalidations: string[] = [];
/** 二期：笔刷 tick 的区间增减队列（渲染侧消费后打件环补丁） */
let heightDeltas: HeightIntervalDelta[] = [];
/** landsea 件环补丁队列：rebuild 前后 diff 出增减格（提交/撤销走补丁，不删缓存） */
let piecePatches: PiecePatch[] = [];

export function queuePieceInvalidation(key: string): void {
  if (!pieceInvalidations.includes(key)) pieceInvalidations.push(key);
}

export function consumePieceInvalidations(): string[] | null {
  if (!pieceInvalidations.length) return null;
  const out = pieceInvalidations;
  pieceInvalidations = [];
  return out;
}

export function consumeHeightDeltas(): HeightIntervalDelta[] | null {
  if (!heightDeltas.length) return null;
  const out = heightDeltas;
  heightDeltas = [];
  return out;
}

/** 同键 Δ 合成入列：键数 = 上界 */
export function queuePiecePatch(setKey: string, added: number[], removed: number[]): void {
  const same = piecePatches.find((p) => p.setKey === setKey);
  if (!same) {
    piecePatches.push({ setKey, added: [...added], removed: [...removed] });
    return;
  }
  const add = new Set(same.added);
  const rem = new Set(same.removed);
  for (const c of added) { rem.delete(c); add.add(c); }
  for (const c of removed) { add.delete(c); rem.add(c); }
  same.added = [...add];
  same.removed = [...rem];
}

/** 高度区间 Δ 同键（layerId+regionId）合成入列 */
export function queueHeightDelta(d: HeightIntervalDelta): void {
  const same = heightDeltas.find((x) => x.layerId === d.layerId && x.regionId === d.regionId);
  if (!same) {
    heightDeltas.push({ layerId: d.layerId, regionId: d.regionId, added: [...d.added], removed: [...d.removed] });
    return;
  }
  const add = new Set(same.added);
  const rem = new Set(same.removed);
  for (const c of d.added) { rem.delete(c); add.add(c); }
  for (const c of d.removed) { add.delete(c); rem.add(c); }
  same.added = [...add];
  same.removed = [...rem];
}

export function consumePiecePatches(): PiecePatch[] | null {
  if (!piecePatches.length) return null;
  const out = piecePatches;
  piecePatches = [];
  return out;
}
