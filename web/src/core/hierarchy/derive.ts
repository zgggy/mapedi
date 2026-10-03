/**
 * 层级派生层——**读取侧唯一入口**（HIERARCHY 设计 §4，2026-10-03 包1）。
 *
 * 全库（compose / 面板 / 命令 / 校验）只准从这里取树形派生物；
 * 原 core/layer/tree.ts 并入此处（O2 单源再收敛，避免第二入口）。
 *
 * 不变量（写入闸 gate 强制，读侧护栏降级为便宜防御）：
 * - 层森林：parent 指针指向存在的层；无环；**每层 ≤1 子（链）**；
 * - 元素森林：parentId 指向存在的元素；无环；桥不变量 I-bridge
 *   （元素父边恰好跨到层的父层）；
 * - 兄弟序 = 数组序（层顶=数组首、元素顶=数组末，方向差只在消费端换算）。
 *
 * 为何不加 rev 记忆化缓存：所有写入都**原地改 parent 指针不换数组**，
 * 数组身份失效判据不成立；树规模 15~60，纯函数 O(n) 即可，
 * UI 侧由 Svelte $derived 自行缓存（AGENTS 热路径红线针对的是每帧全量扫描）。
 */
import type { LayerDef, Region, World } from '../types';

// ── 层森林 ──────────────────────────────────────────────────────────────

export interface LayerTreeRow {
  id: string;
  /** 有效父；根或父指向失效 → null（读侧对悬空的便宜防御，写入/读档已双闸） */
  parentId: string | null;
  depth: number;
  /** 祖先链面包屑（根在前，含直接父，不含自身；'' = 顶层），' › ' 连接 */
  chain: string;
}

/** 层树前序 DFS（一次 walk 产出 parentId/depth/chain；兄弟序 = layers 数组序） */
export function layerTreeOf(
  world: Pick<World, 'layers'> | undefined | null,
): LayerTreeRow[] {
  const layers = world?.layers ?? [];
  const exists = new Set<string>(layers.map((l) => l.id));
  const children = new Map<string | null, LayerDef[]>();
  for (const l of layers) {
    const key = l.parentLayerId && exists.has(l.parentLayerId) ? l.parentLayerId : null;
    let arr = children.get(key);
    if (!arr) children.set(key, (arr = []));
    arr.push(l);
  }
  const out: LayerTreeRow[] = [];
  /** chainOfPid = walk(pid) 入参链（含 pid 自身名）；子行 chain 即此链 */
  const walk = (pid: string | null, depth: number, chainOfPid: string) => {
    for (const l of children.get(pid) ?? []) {
      out.push({ id: l.id, parentId: pid, depth, chain: chainOfPid });
      const own = l.name || l.id;
      walk(l.id, depth + 1, chainOfPid ? `${chainOfPid} › ${own}` : own);
    }
  };
  walk(null, 0, '');
  return out;
}

/** 该层的第一个子层（数组序；无 → null）。链约束下至多一个。原 regionOps.childLayerIdOf 收编。 */
export function childLayerIdOf(
  world: Pick<World, 'layers'>,
  layerId: string,
): string | null {
  return world.layers.find((l) => l.parentLayerId === layerId)?.id ?? null;
}

/** 祖先链（近→远，不含自身；悬空/环由 seen 终止——写入闸后为便宜防御） */
export function layerAncestors(world: Pick<World, 'layers'>, layerId: string): string[] {
  const byId = new Map(world.layers.map((l) => [l.id, l]));
  const out: string[] = [];
  const seen = new Set<string>([layerId]);
  let cur = byId.get(layerId)?.parentLayerId;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.parentLayerId;
  }
  return out;
}

/** I6 有效显隐：自身 visible ∧ 祖先链全可见（读时派生，永不落盘、自愈旧档） */
export function effectiveVisible(
  world: Pick<World, 'layers'>,
  layerId: string,
): boolean {
  const byId = new Map(world.layers.map((l) => [l.id, l]));
  const seen = new Set<string>();
  let cur: string | undefined = layerId;
  while (cur && !seen.has(cur)) {
    const l = byId.get(cur);
    if (!l) return false; // 悬空（读档已修，防御）
    if (!(l.visible ?? false)) return false;
    seen.add(cur);
    cur = l.parentLayerId;
  }
  return true;
}

/** 是否 a 是 b 的祖先（含链上任意层；防环 seen 终止） */
export function isAncestor(
  world: Pick<World, 'layers'>,
  a: string,
  b: string,
): boolean {
  return layerAncestors(world, b).includes(a);
}

// ── 元素森林 ────────────────────────────────────────────────────────────

/** 有序兄弟：同 layerId + 同 parentId（null/undefined 视为顶层）。原 regionOps.siblingRegions 收编。 */
export function siblingRegions(
  world: Pick<World, 'regions'>,
  layerId: string,
  parentId: string | null | undefined,
): Region[] {
  const pid = parentId ?? null;
  return world.regions.filter(
    (r) => r.layerId === layerId && (r.parentId ?? null) === pid,
  );
}
