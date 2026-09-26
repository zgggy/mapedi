import type { Region, World } from './types';
import { defaultExclusiveColor } from './layer/style';
import { scrubRegionDiplomacy } from './diplomacy';

/** 列表拖放提示（与 ui/shell/dnd 对齐） */
export type DropHint =
  | { kind: 'gap'; afterId: string | null; parentId: string | null; highlightParentId: string | null }
  | { kind: 'nest-first'; targetId: string }
  | { kind: 'nest'; targetId: string }
  | { kind: 'promote' };

export interface RegionSnapshot {
  regions: Region[];
}

export function snapshotRegions(world: World): RegionSnapshot {
  return {
    regions: world.regions.map((r) => ({
      ...r,
      cells: [...r.cells],
      weights: r.weights ? new Map(r.weights) : undefined,
      endpointOverrides: r.endpointOverrides
        ? new Map(r.endpointOverrides)
        : undefined,
      attributes: { ...r.attributes },
    })),
  };
}

export function restoreRegions(world: World, snap: RegionSnapshot): void {
  world.regions = snap.regions.map((r) => ({
    ...r,
    cells: [...r.cells],
    weights: r.weights ? new Map(r.weights) : undefined,
    endpointOverrides: r.endpointOverrides
      ? new Map(r.endpointOverrides)
      : undefined,
    attributes: { ...r.attributes },
  }));
}

/**
 * 删除元素：只删本 Region；子层元素 parentId 清空（进「未分配」）。
 * 返回是否找到并删除。
 */
export function deleteRegionKeepChildren(world: World, regionId: string): boolean {
  const idx = world.regions.findIndex((r) => r.id === regionId);
  if (idx < 0) return false;
  const target = world.regions[idx];
  for (const r of world.regions) {
    if (r.parentId === regionId) r.parentId = undefined;
  }
  scrubRegionDiplomacy(world, regionId);
  world.regions.splice(idx, 1);
  void target;
  return true;
}

/**
 * 吞并：targetId 的 cell 并入 attackerId；删除 target；其子改挂到 attacker。
 */
export function annexRegion(
  world: World,
  attackerId: string,
  targetId: string,
): boolean {
  if (attackerId === targetId) return false;
  const attacker = world.regions.find((r) => r.id === attackerId);
  const target = world.regions.find((r) => r.id === targetId);
  if (!attacker || !target) return false;
  if (attacker.layerId !== target.layerId) return false;

  const have = new Set(attacker.cells);
  for (const c of target.cells) {
    if (!have.has(c)) {
      attacker.cells.push(c);
      have.add(c);
    }
  }
  for (const r of world.regions) {
    if (r.parentId === targetId) r.parentId = attackerId;
  }
  world.regions = world.regions.filter((r) => r.id !== targetId);
  return true;
}

export function createRegion(world: World, region: Region): Region {
  world.regions.push({
    ...region,
    cells: [...region.cells],
  });
  return region;
}

export function renameRegion(world: World, regionId: string, name: string): void {
  const r = world.regions.find((x) => x.id === regionId);
  if (r) r.name = name;
}

export function setRegionColor(world: World, regionId: string, color: string): void {
  const r = world.regions.find((x) => x.id === regionId);
  if (r) r.color = color;
}

/** 该 region 所属层是否存在子层 */
export function layerHasChildLayer(world: World, layerId: string): boolean {
  return world.layers.some((l) => l.parentLayerId === layerId);
}

export function childLayerIdOf(world: World, layerId: string): string | null {
  return world.layers.find((l) => l.parentLayerId === layerId)?.id ?? null;
}

export function parentLayerIdOf(world: World, layerId: string): string | null {
  return world.layers.find((l) => l.id === layerId)?.parentLayerId ?? null;
}

/**
 * 降级：把同层元素 A 拖到 B 上 → A 变为 B 所在层的子层元素。
 * 例：国家 A → 国家 B 的行省。
 * - A 原有子元素先并入 A 再删除（国家的行省消失，地块归 A）
 * - A.layerId 改为子层；A.parentId = B
 * - A.centerCellId 保留（首府 → 省会）
 * - A.cells 不变
 */
export function demoteRegionAsChild(
  world: World,
  regionId: string,
  newParentId: string,
): { ok: boolean; message: string } {
  if (regionId === newParentId) return { ok: false, message: '不能拖到自己' };
  const a = world.regions.find((r) => r.id === regionId);
  const b = world.regions.find((r) => r.id === newParentId);
  if (!a || !b) return { ok: false, message: '元素不存在' };
  if (a.layerId !== b.layerId) return { ok: false, message: '只能拖到同层元素上降级' };

  const childLayer = childLayerIdOf(world, a.layerId);
  if (!childLayer) return { ok: false, message: '该图层没有子图层，无法降级' };

  // A 的原子元素（若有）并入 A 后删除
  const kids = world.regions.filter((r) => r.parentId === a.id);
  const cellSet = new Set(a.cells);
  for (const k of kids) {
    for (const c of k.cells) cellSet.add(c);
  }
  a.cells = [...cellSet];
  world.regions = world.regions.filter((r) => r.parentId !== a.id);

  a.layerId = childLayer;
  a.parentId = b.id;
  // 降级为子元素：基本色跟随父元素，专属色保证有内阴影
  a.color = b.color;
  if (!a.exclusiveColor) a.exclusiveColor = defaultExclusiveColor(b.color);
  return {
    ok: true,
    message: `「${a.name}」已成为「${b.name}」的子元素（${childLayer}）`,
  };
}

/**
 * 升级：把子层元素拖到父层层级 → 升为父层元素。
 * 例：行省 A → 国家。
 * - 新建一个与 A 同地块的子层元素挂到 A 下（默认仅含一个子元素）
 * - A.layerId 改为父层；A.parentId 清空
 * - 原父国失去该行省
 */
export function promoteRegionToParentLayer(
  world: World,
  regionId: string,
): { ok: boolean; message: string } {
  const a = world.regions.find((r) => r.id === regionId);
  if (!a) return { ok: false, message: '元素不存在' };
  const prevLayer = a.layerId;
  const parentLayer = parentLayerIdOf(world, prevLayer);
  if (!parentLayer) return { ok: false, message: '该图层没有父图层，无法升级' };

  const cells = [...a.cells];
  const center = a.centerCellId;
  const color = a.color;

  a.layerId = parentLayer;
  a.parentId = undefined;
  a.cells = cells;

  const childId = `${prevLayer}-${Date.now().toString(36)}`;
  world.regions.push({
    id: childId,
    layerId: prevLayer,
    name: `${a.name} · 1`,
    cells,
    centerCellId: center,
    parentId: a.id,
    color: a.color,
    exclusiveColor: a.exclusiveColor ?? defaultExclusiveColor(a.color),
    attributes: { promoted: true },
  });

  return {
    ok: true,
    message: `「${a.name}」已升级为 ${parentLayer}，并默认含 1 个${prevLayer}子元素`,
  };
}

/** 有序兄弟：同 layerId + 同 parentId（null/undefined 视为顶层） */
export function siblingRegions(
  world: World,
  layerId: string,
  parentId: string | null | undefined,
): Region[] {
  const pid = parentId ?? null;
  return world.regions.filter(
    (r) => r.layerId === layerId && (r.parentId ?? null) === pid,
  );
}

/**
 * 在**同父兄弟列表**中把 regionId 插到 relativeId 的前/后。
 * relativeId=null → 插到列表最前。
 * 只改同 (layerId, parentId) 的相对顺序，不换父、不换层。
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

/** 在同 parent 列表中把 from 插到 afterId 之后（afterId=null 表示插到最前） */
export function insertRegionAfter(
  world: World,
  regionId: string,
  afterId: string | null,
  parentId: string | null,
): boolean {
  const from = world.regions.find((r) => r.id === regionId);
  if (!from) return false;
  const fromParent = from.parentId ?? null;
  const fromLayer = from.layerId;

  // 目标层：若 parentId 对应某 region 的子层，则 from 应改 layer/parent
  const parentRegion = parentId ? world.regions.find((r) => r.id === parentId) : null;
  if (parentRegion) {
    const childLayer = childLayerIdOf(world, parentRegion.layerId);
    if (!childLayer) return false;
    // 可改父：from 的层须是 childLayer，或 from 与 parent 同层可 demote
    if (from.layerId === parentRegion.layerId && fromParent !== parentRegion.id) {
      const d = demoteRegionAsChild(world, regionId, parentRegion.id);
      return d.ok;
    }
    if (from.layerId === childLayer || parentLayerIdOf(world, from.layerId) === parentRegion.layerId) {
      from.parentId = parentRegion.id;
      from.layerId = childLayer;
    } else {
      return false;
    }
  } else if (fromParent !== null && parentId === null) {
    // 插到顶层：仅当 from 本就在该层顶层，或提升
    // 若 from 是子层且 after 是同层顶层 → 先提升会改 layer，排序场景通常已是顶层
    if (parentLayerIdOf(world, from.layerId) && afterId) {
      const after = world.regions.find((r) => r.id === afterId);
      if (after && after.layerId === parentLayerIdOf(world, from.layerId)) {
        const p = promoteRegionToParentLayer(world, regionId);
        return p.ok;
      }
    }
  }

  // 同 parent 重排
  const targetParent = parentRegion ? parentRegion.id : null;
  if (afterId === null) {
    // 插到同 parent 列表最前
    const list = world.regions.filter((r) => r.layerId === from.layerId && (r.parentId ?? null) === targetParent);
    const first = list.find((r) => r.id !== regionId);
    if (first) return moveAmongSiblings(world, regionId, first.id, 'before');
    return true;
  }
  if ((from.parentId ?? null) === targetParent && from.layerId === (parentRegion?.layerId === from.layerId ? from.layerId : from.layerId)) {
    if ((from.parentId ?? null) === targetParent) {
      return moveAmongSiblings(world, regionId, afterId, 'after');
    }
  }
  if ((from.parentId ?? null) === targetParent) {
    return moveAmongSiblings(world, regionId, afterId, 'after');
  }
  // 改父后再排
  from.parentId = targetParent ?? undefined;
  return moveAmongSiblings(world, regionId, afterId, 'after');
}

/**
 * 拖放统一入口。
 * 排序语义：afterId 是**同父兄弟**中的插入参考点（插到它后面），不是「挪到列表末尾」。
 */
export function applyRegionDrop(
  world: World,
  fromId: string,
  hint: DropHint,
): { ok: boolean; message: string } {
  if (hint.kind === 'promote') {
    return promoteRegionToParentLayer(world, fromId);
  }
  const from = world.regions.find((r) => r.id === fromId);
  if (!from) return { ok: false, message: '元素不存在' };

  if (hint.kind === 'nest' || hint.kind === 'nest-first') {
    const target = world.regions.find((r) => r.id === hint.targetId);
    if (!target) return { ok: false, message: '目标不存在' };
    if (from.id === target.id) return { ok: false, message: '不能拖到自己' };

    const childLayer = childLayerIdOf(world, target.layerId);
    const parentOfFrom = parentLayerIdOf(world, from.layerId);

    if (from.layerId === target.layerId && childLayer) {
      const r = demoteRegionAsChild(world, fromId, target.id);
      if (!r.ok) return r;
      if (hint.kind === 'nest-first') {
        moveAmongSiblings(world, fromId, null, 'before');
      }
      return r;
    }

    if (parentOfFrom === target.layerId || (childLayer && from.layerId === childLayer && target.layerId === parentOfFrom)) {
      from.parentId = target.id;
      from.color = target.color;
      if (!from.exclusiveColor) from.exclusiveColor = defaultExclusiveColor(target.color);
      if (hint.kind === 'nest-first') moveAmongSiblings(world, fromId, null, 'before');
      return { ok: true, message: `「${from.name}」→「${target.name}」的子元素` };
    }

    return { ok: false, message: '无法挂到该元素下（层关系不匹配）' };
  }

  // —— gap：同父兄弟插入 ——
  const afterId = hint.afterId;
  let targetParentId = hint.highlightParentId ?? hint.parentId ?? null;

  // 线在「某父的子级带」：先把 from 挂成该父的子层元素
  if (hint.highlightParentId) {
    const pr = world.regions.find((r) => r.id === hint.highlightParentId);
    if (pr) {
      const cl = childLayerIdOf(world, pr.layerId);
      const cur = world.regions.find((r) => r.id === fromId)!;
      if (cl && cur.layerId === cl) {
        cur.parentId = pr.id;
        cur.color = pr.color;
      } else if (cur.layerId === pr.layerId && cl) {
        const d = demoteRegionAsChild(world, fromId, pr.id);
        if (!d.ok) return d;
      }
      targetParentId = pr.id;
    }
  } else if (afterId) {
    const after0 = world.regions.find((r) => r.id === afterId);
    if (after0) targetParentId = after0.parentId ?? null;
  }

  const cur = world.regions.find((r) => r.id === fromId)!;

  // 插到列表最前（同父）
  if (afterId === null) {
    // 若 from 不在 targetParent 下且同层，先改父
    if ((cur.parentId ?? null) !== targetParentId && cur.layerId === (world.regions.find((r) => r.id === targetParentId)?.layerId ?? cur.layerId)) {
      // targetParent 为空 → 顶层；from 若是子层需 promote，此处仅同层改 parent
      if (!targetParentId) {
        const pl = parentLayerIdOf(world, cur.layerId);
        if (pl) return promoteRegionToParentLayer(world, fromId);
      }
      cur.parentId = targetParentId ?? undefined;
    }
    const ok = moveAmongSiblings(world, fromId, null, 'before');
    return { ok, message: ok ? '已插入到最前' : '无法插入' };
  }

  const after = world.regions.find((r) => r.id === afterId);
  if (!after) return { ok: false, message: '插入点无效' };
  if (after.id === fromId) return { ok: false, message: '不能插到自己' };

  const childLayerOfAfter = childLayerIdOf(world, after.layerId);

  // 同层同父 → 兄弟插入
  if (cur.layerId === after.layerId && (cur.parentId ?? null) === (after.parentId ?? null)) {
    const ok = moveAmongSiblings(world, fromId, afterId, 'after');
    return { ok, message: ok ? '已插入该位置' : '排序失败' };
  }

  // 同层不同父：改到 after 的父下再插（仍在同一层）
  if (cur.layerId === after.layerId) {
    cur.parentId = after.parentId;
    const ok = moveAmongSiblings(world, fromId, afterId, 'after');
    return { ok, message: ok ? '已插入该位置' : '排序失败' };
  }

  // from 是 after 子层 → 挂到 after 下（子级末尾由数组序决定，新挂靠在末）
  if (childLayerOfAfter && cur.layerId === childLayerOfAfter) {
    cur.parentId = after.id;
    cur.color = after.color;
    if (!cur.exclusiveColor) cur.exclusiveColor = defaultExclusiveColor(after.color);
    return { ok: true, message: `「${cur.name}」已插到「${after.name}」子级` };
  }

  return { ok: false, message: '无法插入该位置（层级不匹配）' };
}
