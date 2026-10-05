/**
 * 写入闸 + 读档修复（HIERARCHY 设计 §3.2/§5.3，2026-10-03 包1）。
 *
 * 写入侧：结构操作（缩进/提升/换父/复制）在落地前过闸——悬空 / 成环 /
 * 链违例 / 桥违例被**拒绝**，读侧护栏只做防御不再代偿（S2）。
 * 读档侧：`repairHierarchy` 对旧档做确定性修复 + 计数报告（S8），
 * **不动 cells / 邻接**——只修层级指针。
 */
import type { World } from '../types';

/** I1/I2：把 childId 的父设为 newParentId 是否合法 */
export function checkLayerReparent(
  world: Pick<World, 'layers'>,
  childId: string,
  newParentId: string | null,
): string | null {
  const layers = world.layers;
  const child = layers.find((l) => l.id === childId);
  if (!child) return '图层不存在';
  if (newParentId === null || newParentId === childId) {
    if (newParentId === childId) return '图层不能是自己的父';
    return null;
  }
  if (!layers.some((l) => l.id === newParentId)) return '父图层不存在（悬空）';
  // I2 无环：目标不能是自己/自己的子孙…… 即 newParent 不得以 child 为祖先
  const byId = new Map(layers.map((l) => [l.id, l]));
  let cur: string | undefined = newParentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === childId) return '会成环';
    seen.add(cur);
    cur = byId.get(cur)?.parentLayerId;
  }
  // I2 链：每层 ≤1 子——目标已有别的子 → 拒绝
  const existing = layers.find((l) => l.parentLayerId === newParentId && l.id !== childId);
  if (existing) return '目标图层已有子层（每层至多一个子图层）';
  return null;
}

/** I3/I4：把 elementId 的父设为 newParentId 是否合法（存在 + 桥不变量） */
export function checkElementReparent(
  world: World,
  elementId: string,
  newParentId: string | null,
): string | null {
  const child = world.regions.find((r) => r.id === elementId);
  if (!child) return '元素不存在';
  if (newParentId === null) return null;
  if (newParentId === elementId) return '元素不能是自己的父';
  const parent = world.regions.find((r) => r.id === newParentId);
  if (!parent) return '父元素不存在（悬空）';
  // 环：沿 parent 链上爬
  let cur: string | undefined = newParentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === elementId) return '会成环';
    seen.add(cur);
    cur = world.regions.find((r) => r.id === cur)?.parentId;
  }
  // I-bridge：layer(parent) ≡ parentLayer(layer(child))
  const layerOf = (id: string) => world.regions.find((r) => r.id === id)?.layerId;
  const parentLayerOf = (lid: string | undefined) =>
    lid ? world.layers.find((l) => l.id === lid)?.parentLayerId : undefined;
  if (layerOf(parent.id) !== parentLayerOf(child.layerId)) {
    return '桥不变量：父元素的层必须恰为本层的父层';
  }
  return null;
}

// ── 读档修复（S8）──────────────────────────────────────────────────────

export interface RepairReport {
  fixed: number;
  notes: string[];
}

/**
 * 层级指针确定性修复（deserializeWorld 收尾调用）：
 * ① 层父悬空/层环 → 提升为根；② 一父二子 → 数组序保首个、其余提升为根（D6）；
 * ③ 元素父缺失/环 → 清为未分配；④ 桥违例 → 清父。
 * 不动 cells / 邻接 / 数组序。
 */
export function repairHierarchy(world: World): RepairReport {
  const notes: string[] = [];
  let fixed = 0;

  const ids = new Set(world.layers.map((l) => l.id));
  // ① 悬空层父 → 根
  for (const l of world.layers) {
    if (l.parentLayerId && !ids.has(l.parentLayerId)) {
      notes.push(`层「${l.name || l.id}」父指向已不存在的层 → 提升为顶层`);
      l.parentLayerId = undefined;
      fixed++;
    }
  }
  // ①' 层环 → 沿数组序首发现者断开为根（seen 上爬；确定性）
  for (const l of world.layers) {
    if (!l.parentLayerId) continue;
    const byId = new Map(world.layers.map((x) => [x.id, x]));
    let cur: string | undefined = l.parentLayerId;
    const seen = new Set<string>([l.id]);
    while (cur) {
      if (seen.has(cur)) {
        notes.push(`层「${l.name || l.id}」所在父链成环 → 断开提升为顶层`);
        l.parentLayerId = undefined;
        fixed++;
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.parentLayerId;
    }
  }
  // ② 一父二子 → 数组序保首个（其余提升为根）
  const firstChild = new Map<string, string>();
  for (const l of world.layers) {
    if (!l.parentLayerId) continue;
    const kept = firstChild.get(l.parentLayerId);
    if (kept === undefined) {
      firstChild.set(l.parentLayerId, l.id);
      continue;
    }
    notes.push(`层「${l.name || l.id}」与「${kept}」同父 → 保留首个，本层提升为顶层`);
    l.parentLayerId = undefined;
    fixed++;
  }

  // ③ 元素父悬空/环 → 清为未分配
  const regionIds = new Set(world.regions.map((r) => r.id));
  // ③' 核心第二形态（选项1）：coreRegionId 必须指向**本元素的子元素**，否则清除
  //    （跨层/悬空/指向孙辈 → 回退 centerCellId 形态；不动 cells/邻接）
  for (const r of world.regions) {
    if (!r.coreRegionId) continue;
    const c = world.regions.find((x) => x.id === r.coreRegionId);
    if (!c || c.parentId !== r.id) {
      notes.push(`元素「${r.name || r.id}」核心子元素无效 → 清除（回退地块核心）`);
      r.coreRegionId = undefined;
      fixed++;
    }
  }
  for (const r of world.regions) {
    if (!r.parentId) continue;
    if (!regionIds.has(r.parentId)) {
      notes.push(`元素「${r.name || r.id}」父指向已删除的元素 → 置为未分配`);
      r.parentId = undefined;
      fixed++;
      continue;
    }
    let cur: string | undefined = r.parentId;
    const seen = new Set<string>([r.id]);
    while (cur) {
      if (seen.has(cur)) {
        notes.push(`元素「${r.name || r.id}」父链成环 → 置为未分配`);
        r.parentId = undefined;
        fixed++;
        break;
      }
      seen.add(cur);
      cur = world.regions.find((x) => x.id === cur)?.parentId;
    }
  }
  // ④ 桥违例 → 清父（layer(parent) ≠ parentLayer(layer(child))）
  const byR = new Map(world.regions.map((r) => [r.id, r]));
  const byL = new Map(world.layers.map((l) => [l.id, l]));
  for (const r of world.regions) {
    if (!r.parentId) continue;
    const p = byR.get(r.parentId);
    if (!p) continue;
    const expect = byL.get(r.layerId)?.parentLayerId;
    if (p.layerId !== expect) {
      notes.push(`元素「${r.name || r.id}」父子跨层违例（I-bridge） → 置为未分配`);
      r.parentId = undefined;
      fixed++;
    }
  }
  return { fixed, notes };
}
