/**
 * MembershipDraw：cell ↔ 元素归属。
 * placement 闸 + overwrite（emptyOnly / replace）。（splitPolicy 词汇已于 2026-10-06 包 D 删除——
 * 唯一实现只认 'newElement' 而全表无层声明它，事实恒为「保留飞地」=默认行为。）
 */
import type { CellId, Region, World } from '../types';
import type { PlacementRule } from '../layer/config';
import { placementAllows } from '../layer/config';
import { writeCells } from '../occupy';

export type OverwriteMode = 'emptyOnly' | 'replace';

export interface DrawActor {
  layerId: string;
  elementId: string;
  overwrite: OverwriteMode;
  placement: PlacementRule;
}

export interface DrawInput {
  cellIds: CellId[];
  pointer: 'left' | 'right';
  shift: boolean;
  alt: boolean;
}

export type BlockReason = 'landOnly' | 'oceanOnly' | 'heightRange' | 'notEmpty' | 'missing';

export interface DrawGate {
  allowed: CellId[];
  blocked: Map<CellId, BlockReason>;
}

export interface MembershipChange {
  cellId: CellId;
  fromElementId: string | null;
  toElementId: string | null;
}

export interface DrawResult {
  membershipChanges: MembershipChange[];
}

function ownersOnLayer(world: World, layerId: string, cellId: CellId): Region[] {
  return world.regions.filter((r) => r.layerId === layerId && r.cells.includes(cellId));
}

export function membershipGate(
  world: World,
  actor: DrawActor,
  input: DrawInput,
  addMode: boolean,
): DrawGate {
  const allowed: CellId[] = [];
  const blocked = new Map<CellId, BlockReason>();
  for (const id of input.cellIds) {
    if (!world.cells[id]) {
      blocked.set(id, 'missing');
      continue;
    }
    if (!placementAllows(world, actor.placement, id)) {
      const h = Math.round(world.cells[id].height);
      const land = h > 0;
      const ls = actor.placement.landSea;
      blocked.set(id, ls === 'landOnly' && !land ? 'landOnly' : ls === 'oceanOnly' && land ? 'oceanOnly' : 'heightRange');
      continue;
    }
    if (addMode && actor.overwrite === 'emptyOnly') {
      const others = ownersOnLayer(world, actor.layerId, id).filter((r) => r.id !== actor.elementId);
      if (others.length) {
        blocked.set(id, 'notEmpty');
        continue;
      }
    }
    allowed.push(id);
  }
  return { allowed, blocked };
}

export function membershipDrawStroke(
  world: World,
  actor: DrawActor,
  input: DrawInput,
): DrawResult {
  const addMode = input.pointer === 'left' && !input.shift;
  const removeMode = input.pointer === 'right' || (input.pointer === 'left' && input.shift);
  // Alt+左：吸色（把 cell 现属元素设为绘制目标——此处为取元素色，由 UI 层处理；本函数仅归属）
  const target = world.regions.find((r) => r.id === actor.elementId && r.layerId === actor.layerId);
  const changes: MembershipChange[] = [];
  if (!target) return { membershipChanges: changes };

  const gate = membershipGate(world, actor, input, addMode);
  const set = new Set(target.cells);

  if (addMode) {
    const addedToTarget: CellId[] = [];
    for (const id of gate.allowed) {
      const prevOwners = ownersOnLayer(world, actor.layerId, id).filter((r) => r.id !== target.id);
      if (!set.has(id)) {
        set.add(id);
        addedToTarget.push(id);
        changes.push({
          cellId: id,
          fromElementId: prevOwners[0]?.id ?? null,
          toElementId: target.id,
        });
      }
      if (actor.overwrite === 'replace') {
        for (const o of prevOwners) {
          const removed: CellId[] = o.cells.includes(id) ? [id] : [];
          writeCells(o, o.cells.filter((c) => c !== id), 'paint', { delta: { added: [], removed } });
          changes.push({ cellId: id, fromElementId: o.id, toElementId: target.id });
        }
      }
    }
    writeCells(target, [...set], 'paint', { delta: { added: addedToTarget, removed: [] } });
  } else if (removeMode) {
    const removedFromTarget: CellId[] = [];
    for (const id of input.cellIds) {
      if (set.has(id)) {
        set.delete(id);
        removedFromTarget.push(id);
        changes.push({ cellId: id, fromElementId: target.id, toElementId: null });
        }
    }
    writeCells(target, [...set], 'paint', { delta: { added: [], removed: removedFromTarget } });
  }

  return { membershipChanges: changes };
}

