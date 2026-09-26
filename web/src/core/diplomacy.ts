/**
 * 国家间附庸 / 敌对（存 Region.attributes，随序列化走）。
 * - suzerainId：宗主国 region id（空/无 = 独立）
 * - enemies：敌对 region id 列表
 * - allies：同盟 region id 列表（可选展示）
 *
 * 与 parentId 不同：parentId = 行政隶属（国家⊃行省，同树）；
 * 附庸 = 国家层横向关系（仍各自独立 Region，只是外交从属）。
 */
import type { Region, RegionId, World } from './types';

export const SUZERAIN_KEY = 'suzerainId';
export const ENEMIES_KEY = 'enemies';
export const ALLIES_KEY = 'allies';

function asId(v: unknown): RegionId | null {
  return typeof v === 'string' && v ? v : null;
}

function asIdList(v: unknown): RegionId[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && !!x);
}

export function suzerainOf(r: Region): RegionId | null {
  return asId(r.attributes?.[SUZERAIN_KEY]);
}

export function enemiesOf(r: Region): RegionId[] {
  return asIdList(r.attributes?.[ENEMIES_KEY]);
}

export function alliesOf(r: Region): RegionId[] {
  return asIdList(r.attributes?.[ALLIES_KEY]);
}

/** 宗主国名下附庸列表 */
export function vassalsOf(world: World, suzerainId: RegionId): Region[] {
  return world.regions.filter((r) => suzerainOf(r) === suzerainId);
}

function writeAttr(r: Region, key: string, value: unknown): void {
  if (value === null || value === undefined || (Array.isArray(value) && !value.length)) {
    if (!r.attributes) r.attributes = {};
    delete r.attributes[key];
    return;
  }
  r.attributes = { ...r.attributes, [key]: value };
}

/** 是否会成环：vassal → … → suzerain → vassal */
export function wouldCreateVassalCycle(
  world: World,
  vassalId: RegionId,
  suzerainId: RegionId,
): boolean {
  if (vassalId === suzerainId) return true;
  const byId = new Map(world.regions.map((r) => [r.id, r]));
  let cur: RegionId | null = suzerainId;
  const seen = new Set<RegionId>();
  while (cur) {
    if (cur === vassalId) return true;
    if (seen.has(cur)) return true;
    seen.add(cur);
    const r: Region | undefined = byId.get(cur);
    cur = r ? suzerainOf(r) : null;
  }
  return false;
}

/**
 * 设置附庸：vassalId 的宗主 = suzerainId（null 解除）。
 * 仅允许同 layer 的两个 Region；拒绝自环/成环。
 * 成功返回 true。
 */
export function setSuzerain(
  world: World,
  vassalId: RegionId,
  suzerainId: RegionId | null,
): boolean {
  const vassal = world.regions.find((r) => r.id === vassalId);
  if (!vassal) return false;
  if (!suzerainId) {
    writeAttr(vassal, SUZERAIN_KEY, null);
    return true;
  }
  const suz = world.regions.find((r) => r.id === suzerainId);
  if (!suz || suz.id === vassalId) return false;
  if (suz.layerId !== vassal.layerId) return false;
  if (wouldCreateVassalCycle(world, vassalId, suzerainId)) return false;
  writeAttr(vassal, SUZERAIN_KEY, suzerainId);
  return true;
}

/** 切换敌对关系（双向） */
export function toggleEnemy(world: World, aId: RegionId, bId: RegionId): boolean {
  if (aId === bId) return false;
  const a = world.regions.find((r) => r.id === aId);
  const b = world.regions.find((r) => r.id === bId);
  if (!a || !b) return false;
  if (a.layerId !== b.layerId) return false;
  const aHas = enemiesOf(a).includes(bId);
  const bHas = enemiesOf(b).includes(aId);
  const nextA = aHas ? enemiesOf(a).filter((x) => x !== bId) : [...enemiesOf(a), bId];
  const nextB = bHas ? enemiesOf(b).filter((x) => x !== aId) : [...enemiesOf(b), aId];
  writeAttr(a, ENEMIES_KEY, nextA);
  writeAttr(b, ENEMIES_KEY, nextB);
  return true;
}

/** 切换同盟关系（双向） */
export function toggleAlly(world: World, aId: RegionId, bId: RegionId): boolean {
  if (aId === bId) return false;
  const a = world.regions.find((r) => r.id === aId);
  const b = world.regions.find((r) => r.id === bId);
  if (!a || !b) return false;
  if (a.layerId !== b.layerId) return false;
  const aHas = alliesOf(a).includes(bId);
  const nextA = aHas ? alliesOf(a).filter((x) => x !== bId) : [...alliesOf(a), bId];
  const nextB = aHas ? alliesOf(b).filter((x) => x !== aId) : [...alliesOf(b), aId];
  // 敌对与同盟互斥
  if (!aHas) {
    writeAttr(a, ENEMIES_KEY, enemiesOf(a).filter((x) => x !== bId));
    writeAttr(b, ENEMIES_KEY, enemiesOf(b).filter((x) => x !== aId));
  }
  writeAttr(a, ALLIES_KEY, nextA);
  writeAttr(b, ALLIES_KEY, nextB);
  return true;
}

/** 删除 Region 时清理引用 */
export function scrubRegionDiplomacy(world: World, regionId: RegionId): void {
  for (const r of world.regions) {
    if (r.id === regionId) continue;
    if (suzerainOf(r) === regionId) writeAttr(r, SUZERAIN_KEY, null);
    if (enemiesOf(r).includes(regionId)) {
      writeAttr(r, ENEMIES_KEY, enemiesOf(r).filter((x) => x !== regionId));
    }
    if (alliesOf(r).includes(regionId)) {
      writeAttr(r, ALLIES_KEY, alliesOf(r).filter((x) => x !== regionId));
    }
  }
}

/** 信息面板/列表展示用短标签 */
export function diplomacyBadge(world: World, r: Region): string | null {
  const sz = suzerainOf(r);
  if (sz) {
    const s = world.regions.find((x) => x.id === sz);
    return s ? `附庸 · ${s.name}` : '附庸';
  }
  const vassals = vassalsOf(world, r.id);
  if (vassals.length) return `宗主 · ${vassals.length} 附庸`;
  return null;
}
