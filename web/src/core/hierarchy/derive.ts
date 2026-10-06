/**
 * 层级派生层——**读取侧唯一入口**（HIERARCHY 设计 §4；2026-10-06 受限架构换底）。
 *
 * 两套结构，**概念不同、都从这里取**：
 * - **显示树**（`displayParent`，视图：叠放序/件切片/标签归属/显隐链）——必须是树，**可多子**；
 * - **受限声明**（`LayerDef.constraints`，语义：集合判定+数量范围+反受限）——可为菱形/DAG；
 *   元素级归属 = `Region.parents[]`（多值）。「父子/游离/多归属」都只是受限参数的取值分支。
 *
 * 全库（compose / 面板 / 命令 / 校验）只准从这里取树形派生物。
 * 不变量（写入闸 gate 强制，读侧护栏降级为便宜防御）：指针指向存在的对象；无环；
 * 兄弟序 = 数组序（层顶=数组首、元素顶=数组末，方向差只在消费端换算）。
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
    const key = l.displayParent && exists.has(l.displayParent) ? l.displayParent : null;
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

/** 显示子层（数组序，**可多子**） */
export function childrenOf(world: Pick<World, 'layers'>, layerId: string): string[] {
  return world.layers.filter((l) => l.displayParent === layerId).map((l) => l.id);
}

/** 该层的第一个显示子层（数组序；无 → null）。**单源便利**：生成/清壳等按链语义消费；
 *  多子语义待需要时另行定义（受限架构下多子层是合法形态）。 */
export function childLayerIdOf(
  world: Pick<World, 'layers'>,
  layerId: string,
): string | null {
  return world.layers.find((l) => l.displayParent === layerId)?.id ?? null;
}

// ── 受限声明（语义）────────────────────────────────────────────────────

/** 满足「集合判定 = contained」的约束目标层（元素级归属 parents 的合法目标层集合） */
export function containmentTargets(
  world: Pick<World, 'layers'>,
  layerId: string,
): string[] {
  return (world.layers.find((l) => l.id === layerId)?.constraints ?? [])
    .filter((c) => c.set === 'contained')
    .map((c) => c.of);
}

/** 本层是否声明了「被包含」受限（= 旧语义「是子层」；绘制目标解析用） */
export function hasContainingConstraint(
  world: Pick<World, 'layers'>,
  layerId: string,
): boolean {
  return containmentTargets(world, layerId).length > 0;
}

/** 哪些层以 backPropagate 反受限指向 targetLayerId（= 聚合来源层） */
export function backPropSourcesOf(
  world: Pick<World, 'layers'>,
  targetLayerId: string,
): string[] {
  return world.layers
    .filter((l) => (l.constraints ?? []).some(
      (c) => c.of === targetLayerId && c.set === 'contained' && c.backPropagate,
    ))
    .map((l) => l.id);
}

/** 元素级归属读取（多归属=数组；缺省空数组） */
export function parentsOf(r: Pick<Region, 'parents'>): string[] {
  return r.parents ?? [];
}

/** 元素级归属写入（COW：换新数组；空 → 清字段） */
export function setParents(r: Region, ids: string[] | undefined): void {
  r.parents = ids && ids.length ? [...new Set(ids)] : undefined;
}

/** 祖先链（近→远，不含自身；悬空/环由 seen 终止——写入闸后为便宜防御） */
export function layerAncestors(world: Pick<World, 'layers'>, layerId: string): string[] {
  const byId = new Map(world.layers.map((l) => [l.id, l]));
  const out: string[] = [];
  const seen = new Set<string>([layerId]);
  let cur = byId.get(layerId)?.displayParent;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.displayParent;
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
    cur = l.displayParent;
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

/** 爬根（写入闸已禁环；byId 由调用方持有，避免重复建表） */
function rootOfIn(byId: Map<string, LayerDef>, id: string): string {
  let cur = id;
  let p = byId.get(cur)?.displayParent;
  while (p && byId.has(p)) {
    cur = p;
    p = byId.get(cur)?.displayParent;
  }
  return cur;
}

/** 树深度：0 = 第一层级（无跳数上限——闸已禁环） */
function depthOfIn(byId: Map<string, LayerDef>, id: string): number {
  let d = 0;
  let cur = id;
  let p = byId.get(cur)?.displayParent;
  while (p && byId.has(p)) {
    cur = p;
    d++;
    p = byId.get(cur)?.displayParent;
  }
  return d;
}

/** 第一层级根 id（compose 取根单源） */
export function layerRootOf(world: Pick<World, 'layers'>, layerId: string): string {
  return rootOfIn(new Map(world.layers.map((l) => [l.id, l])), layerId);
}

/** 树深度：0 = 第一层级 */
export function layerDepthOf(world: Pick<World, 'layers'>, layerId: string): number {
  return depthOfIn(new Map(world.layers.map((l) => [l.id, l])), layerId);
}

/**
 * 层叠放比较器（HIERARCHY §6.1，包2——替换 compose 内联比较器）：
 * 1. inFocusSubtree(L) ? 1 : 0 —— **焦点整段**（焦点+全部后代）最后画（修 P5）；
 * 2. rootIdx 升序（非焦点组：列表上层根 → 先画；列表序 = 地图自下而上，2026-10-06 用户定）；
 * 3. depth 升序（同树：父 → 子）；
 * 4. 数组序稳定（层内兄弟：数组后 = 画上）。
 * 焦点为深层子层时其祖先/旁支留非焦点组（契约=整段=子树，不是整棵树）。
 *
 * rootIdx **升序**（2026-10-06 用户定「图层的顺序和列表的顺序相反」：列表自上而下 =
 * 低→高 = 地图自下而上——列表首行（地块）最底、末行最顶；旧判 rootIdx 降序 =
 * 列表上层根画在最上，与本契约相反，已翻向）。
 */
export function layerStackComparator(
  world: Pick<World, 'layers'>,
  focus: string | null,
): (a: string, b: string) => number {
  const layers = world.layers;
  const listIndex = new Map<string, number>();
  layers.forEach((l, i) => listIndex.set(l.id, i));
  const byId = new Map(layers.map((l) => [l.id, l]));
  const rootOf = (id: string) => rootOfIn(byId, id);
  const depthOf = (id: string) => depthOfIn(byId, id);
  const inSeg = (id: string): boolean => !!focus && (id === focus || isAncestor(world, focus, id));
  return (a, b) => {
    const fa = inSeg(a) ? 1 : 0;
    const fb = inSeg(b) ? 1 : 0;
    if (fa !== fb) return fa - fb;
    const ra = listIndex.get(rootOf(a)) ?? 0;
    const rb = listIndex.get(rootOf(b)) ?? 0;
    if (ra !== rb) return ra - rb;
    return depthOf(a) - depthOf(b);
  };
}

// ── 元素森林 ────────────────────────────────────────────────────────────

/** 有序兄弟：同 layerId + 同归属目标（null/undefined 视为游离/顶层）。原 regionOps.siblingRegions 收编。
 *  多归属语义：父 id 在 `parents` 中即算该父的兄弟（同一元素可出现在多组）。 */
export function siblingRegions(
  world: Pick<World, 'regions'>,
  layerId: string,
  parentId: string | null | undefined,
): Region[] {
  const pid = parentId ?? null;
  return world.regions.filter(
    (r) => r.layerId === layerId && (pid === null ? !r.parents?.length : !!r.parents?.includes(pid)),
  );
}
