/**
 * 结构操作——**写入侧唯一入口**（HIERARCHY 设计 §5.1，2026-10-03 包1）。
 *
 * 纯 core 计算：给定计划（plan*）→ 闸校验 → 返回写入计划；
 * `history.run`、status、`touch*` 失效由 commandService 负责（§6.5）。
 * 一次结构操作 = 一条命令。
 *
 * parent 关系写（缩进/提升/换父/复制）与兄弟序写（moveAmongSiblings，
 * 原 regionOps 收编）都在此；paths 序仍在 commandService.withPaths（路径编辑域）。
 */
import type { LayerDef, Region, World } from '../types';
import { checkElementReparent, checkLayerReparent } from './gate';
import { siblingRegions } from './derive';

export interface ReparentPlan {
  id: string;
  before: string | undefined;
  after: string | undefined;
}

export type PlanResult =
  | { ok: true; plan: ReparentPlan; status: string }
  | { ok: false; status: string };

/**
 * 缩进：成为**视觉上一行**（anchorId，由面板按过滤后 rows 给出——D3 同源）的子。
 * 位置零漂移（前序不变量）；链约束下上一行按构造必为叶子父，闸仍断言。
 */
export function planIndent(
  world: Pick<World, 'layers'>,
  id: string,
  anchorId: string | null,
): PlanResult {
  const l = world.layers.find((x) => x.id === id);
  if (!l) return { ok: false, status: '缩进只适用于图层' };
  if (!anchorId) return { ok: false, status: '已是第一个图层，无处缩进' };
  if (!world.layers.some((x) => x.id === anchorId)) {
    return { ok: false, status: '缩进目标不存在（列表已变化）' };
  }
  if ((l.parentLayerId ?? null) === anchorId) {
    return { ok: false, status: '已在上一个图层之下' };
  }
  const err = checkLayerReparent(world, id, anchorId);
  if (err) return { ok: false, status: `无法缩进：${err}` };
  return {
    ok: true,
    plan: { id, before: l.parentLayerId, after: anchorId },
    status: '已缩进（Ctrl+Z 可撤销）',
  };
}

/** 提升：parent 置空，一次到顶层（不做循环逐跳） */
export function planPromote(world: Pick<World, 'layers'>, id: string): PlanResult {
  const l = world.layers.find((x) => x.id === id);
  if (!l) return { ok: false, status: '提升只适用于图层' };
  const hasParent = !!l.parentLayerId && world.layers.some((x) => x.id === l.parentLayerId);
  if (!hasParent) return { ok: false, status: '已是顶层图层，无处提升' };
  const err = checkLayerReparent(world, id, null);
  if (err) return { ok: false, status: `无法提升：${err}` };
  return {
    ok: true,
    plan: { id, before: l.parentLayerId, after: undefined },
    status: '已提升至顶层（Ctrl+Z 可撤销）',
  };
}

/**
 * 复制图层 = **副本成为根**（D5）：继承父会造成一父二子违链，
 * 成根 + status 说明（元素/样式不随复制）。
 */
export function layerCopyAsRoot(layer: LayerDef, nid: string): LayerDef {
  return { ...layer, id: nid, name: `${layer.name || layer.id} 副本`, parentLayerId: undefined };
}

/**
 * 元素换父（生成兜底 / 吞并 / 未来手动挂靠入口共用）：
 * 闸校验 I3/I4 后就地写；调用方负责 history 与 touchRegions（物化）。
 * 返回 null = 成功，否则为拒绝原因。
 */
export function reparentElement(
  world: World,
  elementId: string,
  newParentId: string | null,
): string | null {
  const err = checkElementReparent(world, elementId, newParentId);
  if (err) return err;
  const r = world.regions.find((x) => x.id === elementId);
  if (!r) return '元素不存在';
  r.parentId = newParentId ?? undefined;
  return null;
}

/**
 * 在**同父兄弟列表**中把 regionId 插到 relativeId 的前/后
 * （relativeId=null → 列表最前）。只改同 (layerId, parentId) 的相对顺序，
 * 不换父、不换层。原 regionOps.moveAmongSiblings 收编（regionOps 已整体溶解）。
 */
export function moveAmongSiblings(
  world: World,
  regionId: string,
  relativeId: string | null,
  position: 'before' | 'after' = 'after',
): boolean {
  const from = world.regions.find((r) => r.id === regionId);
  if (!from) return false;
  const layerId = from.layerId;
  const parentId = from.parentId ?? null;

  const siblings = siblingRegions(world, layerId, parentId);
  const others = siblings.filter((r) => r.id !== regionId);

  let ordered: Region[];
  if (relativeId === null) {
    ordered = [from, ...others];
  } else {
    const idx = others.findIndex((r) => r.id === relativeId);
    if (idx < 0) return false;
    ordered = [...others];
    ordered.splice(position === 'after' ? idx + 1 : idx, 0, from);
  }

  let oi = 0;
  for (let i = 0; i < world.regions.length; i++) {
    const r = world.regions[i];
    if (r.layerId === layerId && (r.parentId ?? null) === parentId) {
      world.regions[i] = ordered[oi++];
    }
  }
  return oi === ordered.length;
}

/**
 * 候选集中与 element 共享邻接边最多者（挂靠打分，D4/生成兜底共用——单源）。
 * 打分 = element 每个 cell 的邻居中落在候选 cells 里的数量和。
 */
export function bestParentAmong(
  world: World,
  elementId: string,
  candidates: Region[],
): Region | null {
  const el = world.regions.find((r) => r.id === elementId);
  if (!el || !candidates.length) return null;
  let best: Region | null = null;
  let bestScore = -1;
  for (const cand of candidates) {
    if (cand.id === el.id) continue;
    const candCells = new Set(cand.cells);
    let score = 0;
    for (const c of el.cells) {
      for (const nb of world.cells[c]?.neighbors ?? []) {
        if (candCells.has(nb)) score++;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }
  return best;
}

/**
 * 孤儿手动挂靠候选（D4，§6.4）：父层元素中共享邻接最多者。
 * 无父层 / 父层无元素 / 本元素已有父 → null（UI 不显示挂靠入口）。
 */
export function bestParentFor(world: World, elementId: string): Region | null {
  const el = world.regions.find((r) => r.id === elementId);
  if (!el || el.parentId) return null;
  const parentLayer = world.layers.find((l) => l.id === el.layerId)?.parentLayerId;
  if (!parentLayer) return null;
  const cands = world.regions.filter((r) => r.layerId === parentLayer);
  if (!cands.length) return null;
  return bestParentAmong(world, elementId, cands);
}
