/**
 * 删除策略表（HIERARCHY 设计 §5.2，2026-10-03 包1）——四种场景的
 *「子怎么办」是**一张表推出来的**，不是四处各写（S4）。
 * 消费方：core/history.ts 的 DeleteRegionCommand / AnnexCommand / DeleteLayerCommand。
 * 快照（undo 恢复）仍由各命令持有，本模块只提供**纯计算**。
 */
import type { Region, World } from '../types';

export interface ChildParentFlip {
  id: string;
  /** 归属快照（多归属 = 数组；undo 原样恢复） */
  parents: string[] | undefined;
}

/**
 * 场景 1 · 删元素：子元素从归属里移除该 id（多归属只删这一条；空 = 游离，min=0 合法）。
 * undo 经返回的快照恢复（与原 DeleteRegionCommand 内联逻辑同语义）。
 */
export function childrenOnRegionDelete(world: World, regionId: string): ChildParentFlip[] {
  return world.regions
    .filter((r) => r.parents?.includes(regionId))
    .map((r) => ({ id: r.id, parents: r.parents }));
}

export interface AnnexFlip {
  id: string;
  from: string;
  to: string;
}

/**
 * 场景 2 · 吞并：子改挂攻击方（调用方仍须过 checkElementReparent 复核桥不变量——
 * 吞并限定同层，桥天然保持，此处只做重挂表）。
 */
export function childrenOnAnnex(world: World, targetId: string, attackerId: string): AnnexFlip[] {
  return world.regions
    .filter((r) => r.parents?.includes(targetId))
    .map((r) => ({ id: r.id, from: targetId, to: attackerId }));
}

export interface LayerDeletePlan {
  /** 显示子层链拼接：child.displayParent = deleted.displayParent（修 P3 不留悬空） */
  layerFlip: ChildParentFlip | null;
  /** 因删层失去父的元素（归属含被删层任一元素）→ 移除该归属（走「删元素」行） */
  regionFlips: ChildParentFlip[];
}

/**
 * 场景 3 · 删层：
 * ① 该层元素随层删除（由命令本体处理）；
 * ② 子层提升为被删层的父（链拼接）；
 * ③ 因①失去父的元素（其他层中 parentId 指向被删层元素）→ 清父。
 */
export function planLayerDelete(world: World, deletedLayerId: string): LayerDeletePlan {
  const child = world.layers.find((l) => l.displayParent === deletedLayerId);
  const deleted = world.layers.find((l) => l.id === deletedLayerId);
  const layerFlip: ChildParentFlip | null = child
    ? { id: child.id, parents: deleted?.displayParent ? [deleted.displayParent] : undefined }
    : null;
  const doomed = new Set(
    world.regions.filter((r) => r.layerId === deletedLayerId).map((r) => r.id),
  );
  const regionFlips = world.regions
    .filter((r) => r.parents?.some((p) => doomed.has(p)))
    .map((r) => ({ id: r.id, parents: r.parents }));
  return { layerFlip, regionFlips };
}

// 场景 4 · 撤销/重做：全量快照还原 + materializeBackPropagate（step7 已补）
// ——保持在 history 管线，不在本表内重复实现；列为回归点（设计 §5.2）。
