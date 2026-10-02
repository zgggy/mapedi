/**
 * MembershipDraw：cell ↔ 元素归属。
 * placement 闸 + overwrite（emptyOnly / replace）+ splitPolicy（end 时拆连通块）。
 */
import type { CellId, Region, World } from '../types';
import type { PlacementRule, SplitPolicy } from '../layer/config';
import { placementAllows } from '../layer/config';
import { markManualSplit, isLandSeaLayer } from '../layer/landSea';

export type OverwriteMode = 'emptyOnly' | 'replace';

export interface DrawActor {
  layerId: string;
  elementId: string;
  overwrite: OverwriteMode;
  placement: PlacementRule;
  splitPolicy: SplitPolicy;
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
  elementSplit?: Array<{ fromId: string; toIds: string[] }>;
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
    for (const id of gate.allowed) {
      const prevOwners = ownersOnLayer(world, actor.layerId, id).filter((r) => r.id !== target.id);
      if (!set.has(id)) {
        set.add(id);
        changes.push({
          cellId: id,
          fromElementId: prevOwners[0]?.id ?? null,
          toElementId: target.id,
        });
      }
      if (actor.overwrite === 'replace') {
        for (const o of prevOwners) {
          o.cells = o.cells.filter((c) => c !== id);
          changes.push({ cellId: id, fromElementId: o.id, toElementId: target.id });
        }
      }
      if (isLandSeaLayer(actor.layerId) && landSeaIsOcean(target)) markManualSplit(target);
    }
    target.cells = [...set];
  } else if (removeMode) {
    for (const id of input.cellIds) {
      if (set.has(id)) {
        set.delete(id);
        changes.push({ cellId: id, fromElementId: target.id, toElementId: null });
        if (isLandSeaLayer(actor.layerId) && landSeaIsOcean(target)) markManualSplit(target);
      }
    }
    target.cells = [...set];
  }

  const split = applySplitPolicy(world, actor, target);
  return { membershipChanges: changes, elementSplit: split };
}

function landSeaIsOcean(r: Region): boolean {
  return r.attributes?.kind === 'ocean';
}

/** splitPolicy: newElement → 断开的额外连通块拆成新元素 */
export function applySplitPolicy(
  world: World,
  actor: DrawActor,
  target: Region,
): Array<{ fromId: string; toIds: string[] }> {
  if (actor.splitPolicy !== 'newElement') return [];
  const set = new Set(target.cells);
  if (set.size < 2) return [];
  const seen = new Set<CellId>();
  const comps: CellId[][] = [];
  for (const start of target.cells) {
    if (seen.has(start)) continue;
    const comp: CellId[] = [];
    const q = [start];
    seen.add(start);
    while (q.length) {
      const id = q.pop()!;
      comp.push(id);
      for (const n of world.cells[id].neighbors) {
        if (set.has(n) && !seen.has(n)) {
          seen.add(n);
          q.push(n);
        }
      }
    }
    comps.push(comp);
  }
  if (comps.length <= 1) return [];
  comps.sort((a, b) => b.length - a.length);
  target.cells = comps[0];
  const toIds = [target.id];
  for (let i = 1; i < comps.length; i++) {
    const id = `${target.id}-split${i}`;
    if (world.regions.some((r) => r.id === id)) continue;
    const clone: Region = {
      ...target,
      id,
      name: `${target.name}·${i + 1}`,
      cells: comps[i],
      attributes: { ...target.attributes, splitFrom: target.id },
    };
    world.regions.push(clone);
    toIds.push(id);
  }
  return [{ fromId: target.id, toIds }];
}
