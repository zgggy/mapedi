/**
 * 写入闸 + 读档修复（HIERARCHY 设计 §3.2/§5.3，2026-10-03 包1）。
 *
 * 写入侧：结构操作（缩进/提升/换父/复制）在落地前过闸——悬空 / 成环 / 桥违例被**拒绝**。
 * 2026-10-06 受限架构换底：显示树（displayParent）与受限声明（constraints）分开校验；
 * 「每层≤1子」限制随父子概念一并取消（多子层是受限架构下的合法形态）。
 * 读档侧：`repairHierarchy` 对旧档做确定性修复 + 计数报告（S8），
 * **不动 cells / 邻接**——只修层级指针。
 */
import type { World } from '../types';
import { containmentTargets } from './derive';

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
    if (newParentId === childId) return '图层不能是自己的显示父';
    return null;
  }
  if (!layers.some((l) => l.id === newParentId)) return '父图层不存在（悬空）';
  // 显示树无环：newParent 不得以 child 为祖先
  const byId = new Map(layers.map((l) => [l.id, l]));
  let cur: string | undefined = newParentId;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === childId) return '会成环';
    seen.add(cur);
    cur = byId.get(cur)?.displayParent;
  }
  return null;
}

/** 受限图：把 from 层的 contained+反受限约束改为指向 to（含取消）；循环受限（互相反受限）拒绝 */
export function checkConstraintRewire(
  world: Pick<World, 'layers'>,
  from: string,
  to: string | null,
): string | null {
  if (to === null) return null;
  if (to === from) return '不能受限于自身';
  const layers = world.layers;
  if (!layers.some((l) => l.id === to)) return '目标图层不存在（悬空）';
  // 沿「反受限指向」上爬：to 若经反受限链回到 from → 循环受限（§10 冲突形态）
  const bpTargets = (id: string) =>
    (layers.find((l) => l.id === id)?.constraints ?? [])
      .filter((c) => c.set === 'contained' && c.backPropagate)
      .map((c) => c.of);
  const seen = new Set<string>([from]);
  const stack = [to];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === from) return '循环受限（双方反受限会互锁）';
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...bpTargets(cur));
  }
  return null;
}

/** I3/I4：把 elementId 的父设为 newParentId 是否合法（存在 + 桥不变量） */
export function checkElementReparent(
  world: World,
  elementId: string,
  newParentId: string | null,
): string | null {
  // 换父（单父流程：父笔刷收编/挂靠/生成兜底）= 加父；清空 = 去全部父（过 Min）
  if (newParentId === null) {
    const child = world.regions.find((r) => r.id === elementId);
    for (const p of child?.parents ?? []) {
      const err = checkParentRemove(world, elementId, p);
      if (err) return err;
    }
    return null;
  }
  const child = world.regions.find((r) => r.id === elementId);
  if (child?.parents?.includes(newParentId)) return null; // 已归属 = 幂等通过
  return checkParentAdd(world, elementId, newParentId);
}

/** 本层对某目标层的「被包含」约束（无 → undefined） */
export function containmentConstraint(
  world: Pick<World, 'layers'>,
  layerId: string,
  targetLayerId: string,
) {
  return (world.layers.find((l) => l.id === layerId)?.constraints ?? [])
    .find((c) => c.set === 'contained' && c.of === targetLayerId);
}

/** 归属目标计数（同一目标层；多归属按目标层分别计） */
function parentCountInLayer(world: World, child: { parents?: string[] }, targetLayerId: string): number {
  return (child.parents ?? []).filter(
    (p) => world.regions.find((r) => r.id === p)?.layerId === targetLayerId,
  ).length;
}

/**
 * 归属增删（受限架构 E2 · 多归属）：加父需过 环 / 桥 / **Max**；去父需过 **Min**。
 * 数量按「同一目标层」计（每条 contained 约束各自一对 min/max）——Max=N 即争议区。
 * 返回 null = 合法。
 */
export function checkParentAdd(world: World, elementId: string, parentId: string): string | null {
  const child = world.regions.find((r) => r.id === elementId);
  if (!child) return '元素不存在';
  if (parentId === elementId) return '元素不能是自己的父';
  const parent = world.regions.find((r) => r.id === parentId);
  if (!parent) return '父元素不存在（悬空）';
  if (child.parents?.includes(parentId)) return '已归属该元素';
  // 环：沿 parents DAG 上爬
  const seen = new Set<string>([elementId]);
  const stack = [parentId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === elementId) return '会成环';
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...(world.regions.find((x) => x.id === cur)?.parents ?? []));
  }
  // 桥不变量 + Max
  const c = containmentConstraint(world, child.layerId, parent.layerId);
  if (!c) return '桥不变量：本层未声明对该层的「被包含」约束';
  if (c.max !== null) {
    const n = parentCountInLayer(world, child, parent.layerId);
    if (n >= c.max) return `上限 ${c.max} 个「${parent.layerId}」元素（当前 ${n}）`;
  }
  return null;
}

export function checkParentRemove(world: World, elementId: string, parentId: string): string | null {
  const child = world.regions.find((r) => r.id === elementId);
  if (!child) return '元素不存在';
  if (!child.parents?.includes(parentId)) return '未归属该元素';
  const parent = world.regions.find((r) => r.id === parentId);
  const parentLayerId = parent?.layerId;
  if (!parentLayerId) return null;
  const c = containmentConstraint(world, child.layerId, parentLayerId);
  if (c && c.min > 0) {
    const n = parentCountInLayer(world, child, parentLayerId);
    if (n - 1 < c.min) return `至少需归属 ${c.min} 个「${parentLayerId}」元素`;
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
  // ① 悬空显示父 → 根
  for (const l of world.layers) {
    if (l.displayParent && !ids.has(l.displayParent)) {
      notes.push(`层「${l.name || l.id}」显示父指向已不存在的层 → 提升为顶层`);
      l.displayParent = undefined;
      fixed++;
    }
  }
  // ①' 显示树环 → 沿数组序首发现者断开为根（seen 上爬；确定性）
  for (const l of world.layers) {
    if (!l.displayParent) continue;
    const byId = new Map(world.layers.map((x) => [x.id, x]));
    let cur: string | undefined = l.displayParent;
    const seen = new Set<string>([l.id]);
    while (cur) {
      if (seen.has(cur)) {
        notes.push(`层「${l.name || l.id}」所在显示父链成环 → 断开提升为顶层`);
        l.displayParent = undefined;
        fixed++;
        break;
      }
      seen.add(cur);
      cur = byId.get(cur)?.displayParent;
    }
  }
  // ①'' 受限声明修复：悬空目标删约束；循环受限（互相反受限）→ 断后发现的 backPropagate（确定性）
  {
    const bpTargets = (l: { constraints?: { of: string; set: string; backPropagate: boolean }[] }) =>
      (l.constraints ?? []).filter((c) => c.set === 'contained' && c.backPropagate).map((c) => c.of);
    for (const l of world.layers) {
      if (!l.constraints?.length) continue;
      const kept = l.constraints.filter((c) => ids.has(c.of) && c.of !== l.id);
      if (kept.length !== l.constraints.length) {
        notes.push(`层「${l.name || l.id}」有指向不存在/自身的目标约束 → 移除`);
        l.constraints = kept.length ? kept : undefined;
        fixed++;
      }
    }
    const byId = new Map(world.layers.map((x) => [x.id, x]));
    for (const l of world.layers) {
      for (const c of l.constraints ?? []) {
        if (!c.backPropagate) continue;
        // 该反受限边是否会回到自身
        const seen = new Set<string>([l.id]);
        const stack = [c.of];
        let cyc = false;
        while (stack.length) {
          const cur = stack.pop()!;
          if (cur === l.id) { cyc = true; break; }
          if (seen.has(cur)) continue;
          seen.add(cur);
          stack.push(...bpTargets(byId.get(cur) ?? {}));
        }
        if (cyc) {
          notes.push(`层「${l.name || l.id}」与「${c.of}」循环受限 → 断开本层反受限`);
          c.backPropagate = false;
          fixed++;
        }
      }
    }
  }

  // ③ 元素父悬空/环 → 清为未分配
  const regionIds = new Set(world.regions.map((r) => r.id));
  // ③' 核心第二形态（选项1）：coreRegionId 必须指向**本元素的子元素**，否则清除
  //    （跨层/悬空/指向孙辈 → 回退 centerCellId 形态；不动 cells/邻接）
  for (const r of world.regions) {
    if (!r.coreRegionId) continue;
    const c = world.regions.find((x) => x.id === r.coreRegionId);
    if (!c || !c.parents?.includes(r.id)) {
      notes.push(`元素「${r.name || r.id}」核心子元素无效 → 清除（回退地块核心）`);
      r.coreRegionId = undefined;
      fixed++;
    }
  }
  for (const r of world.regions) {
    if (!r.parents?.length) continue;
    const kept = r.parents.filter((p) => regionIds.has(p));
    if (kept.length !== r.parents.length) {
      notes.push(`元素「${r.name || r.id}」有指向已删除元素的归属 → 移除该归属`);
      r.parents = kept.length ? kept : undefined;
      fixed++;
      if (!r.parents?.length) continue;
    }
    // 环（多父 DAG）：沿 parents 上爬，回到自身即断开该边
    for (const seed of [...r.parents]) {
      const seen = new Set<string>([r.id]);
      let cur: string | undefined = seed;
      while (cur) {
        if (cur === r.id) {
          notes.push(`元素「${r.name || r.id}」归属链成环 → 移除成环归属`);
          r.parents = r.parents.filter((p) => p !== seed);
          if (!r.parents.length) r.parents = undefined;
          fixed++;
          break;
        }
        if (seen.has(cur)) break;
        seen.add(cur);
        cur = world.regions.find((x) => x.id === cur)?.parents?.[0];
      }
      if (!r.parents?.length) break;
    }
  }
  // ④ 桥违例 → 移除该归属（父元素的层必须在本层「被包含」约束的目标层集合内）
  const byR = new Map(world.regions.map((r) => [r.id, r]));
  for (const r of world.regions) {
    if (!r.parents?.length) continue;
    const targets = containmentTargets(world, r.layerId);
    const kept = r.parents.filter((pid) => {
      const p = byR.get(pid);
      return !!p && targets.includes(p.layerId);
    });
    if (kept.length !== r.parents.length) {
      notes.push(`元素「${r.name || r.id}」有跨层违例的归属（I-bridge） → 移除`);
      r.parents = kept.length ? kept : undefined;
      fixed++;
    }
  }
  return { fixed, notes };
}
