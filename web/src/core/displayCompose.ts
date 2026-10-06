/**
 * 显示层合成：仅影响绘制，不改 cell/Region 数据。
 * - 显示树 = Layer.displayParent（禁环，无包含校验；受限关系见 constraints）
 * - 子 Region 被父 Region 切成碎片：标签 name(parent)；父外 name(—)
 * - 多级祖先：r(c(A))（子名在左，祖先自内向外）
 */
import type { CellId, LayerDef, Region, World } from './types';
import { dataRev } from './rev';
import { writeCells } from './occupy';
import { effectiveVisible, layerRootOf, layerStackComparator } from './hierarchy/derive';

export const VIRTUAL_PARENT = '—';

export interface DisplayPiece {
  key: string;
  layerId: string;
  regionId: string;
  rootLayerId: string;
  depth: number;
  cellIds: CellId[];
  label: string;
  color: string;
  opacity: number;
  /** 工作区选中的元素 → 渲染置顶 */
  regionSelected?: boolean;
}

export function isFreeLayer(layer: Pick<LayerDef, 'kind' | 'id'>): boolean {
  return layer.kind === 'road' || layer.kind === 'route' || layer.kind === 'river';
}

/** 按 id 查是否自由路径层（kind 单源的 lookup 版；未知层/无 world = false——消费点禁写 id 三连比较） */
export function isFreeLayerId(
  world: Pick<World, 'layers'> | null | undefined,
  layerId: string,
): boolean {
  const l = world?.layers.find((x) => x.id === layerId);
  return !!l && isFreeLayer(l);
}

/** 默认全部图层隐藏（含自由层）；选中层仍可显示（选中 ≡ 显示） */
export function defaultLayerVisible(_layer: Pick<LayerDef, 'kind' | 'id'>): boolean {
  return false;
}

function isVisible(l: LayerDef | undefined, defaultVisible: boolean): boolean {
  if (!l) return false;
  return l.visible ?? defaultVisible;
}

export function displayAncestors(world: World, layerId: string): string[] {
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

export function displayTree(
  world: World,
  rootLayerId: string,
): { layerId: string; depth: number }[] {
  const byId = new Map(world.layers.map((l) => [l.id, l]));
  const kids = new Map<string, string[]>();
  for (const l of world.layers) {
    const p = l.displayParent;
    if (!p || !byId.has(p)) continue;
    let arr = kids.get(p);
    if (!arr) {
      arr = [];
      kids.set(p, arr);
    }
    arr.push(l.id);
  }
  const out: { layerId: string; depth: number }[] = [];
  // 去 depth>8 截断（HIERARCHY §7，包1）：写入闸/读档修复已禁环，上爬/下探无界安全
  const walk = (id: string, depth: number) => {
    out.push({ layerId: id, depth });
    for (const k of kids.get(id) ?? []) walk(k, depth + 1);
  };
  walk(rootLayerId, 0);
  return out;
}

/** 可见颜色根树（列表顺序 = 自下而上）。父+子占 1 名额；自由层不占。 */
export function visibleColorRoots(world: World, maxRoots = 3): string[] {
  const visibleSet = new Set(
    world.layers.filter((l) => isVisible(l, defaultLayerVisible(l))).map((l) => l.id),
  );
  const roots: string[] = [];
  for (const l of world.layers) {
    if (isFreeLayer(l)) continue;
    if (!visibleSet.has(l.id)) continue;
    const p = l.displayParent;
    if (p && visibleSet.has(p)) continue;
    roots.push(l.id);
    if (roots.length >= maxRoots) break;
  }
  return roots;
}

/**
 * 层序：列表最上 = 地图最上（后画）。
 * 列表最下不透明，越往上越透；列表最上颜色对比最鲜明。
 * listIndex: 0 = 列表最上。
 */
/**
 * 归属唯一真相 = `region.cells`。
 * 目标层元素的 cells **必须已物化**（自持 ∪ 聚合；生成/改归属后调用 materializeBackPropagate）。
 * 显示切分直接读 `region.cells`，不再现场并集。
 */
export function materializeBackPropagate(world: World): void {
  // 受限架构（2026-10-06 换底）：**反受限聚合** = 目标层元素.cells = 自持(selfCells) ∪ ⋃(被包含子元素.cells)。
  // 子元素关系 = 元素级归属 `parents[]`（多归属天然支持：一个元素可进多个目标的并集）。
  // 目标层 = 被某条 `contained + backPropagate` 约束指向的层（不再有"父子图层"概念）。
  const childrenOf = new Map<string, Region[]>();
  for (const r of world.regions) {
    for (const pid of r.parents ?? []) {
      let arr = childrenOf.get(pid);
      if (!arr) childrenOf.set(pid, (arr = []));
      arr.push(r);
    }
  }
  const targetLayers = new Set<string>();
  for (const l of world.layers) {
    for (const c of l.constraints ?? []) {
      if (c.set === 'contained' && c.backPropagate) targetLayers.add(c.of);
    }
  }
  const seen = new Set<string>();
  const write = (r: Region) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    for (const k of childrenOf.get(r.id) ?? []) write(k);
    if (!targetLayers.has(r.layerId)) return;
    const kids = childrenOf.get(r.id);
    // 首次物化：把「直接绑定的格」固化为自持输入（幂等；迁移与新建约束同一路径）
    if (r.selfCells === undefined) {
      const union = new Set<CellId>();
      for (const k of kids ?? []) for (const id of k.cells) union.add(id);
      r.selfCells = r.cells.filter((id) => !union.has(id));
    }
    // 无子：**仅在从未建立自持（非聚合形态）时不动**；已建立自持的目标必须重写——
    // 否则移除最后一个子元素后 cells 残留旧并集（E2 实测踩到：争议区解绑后疆域不清）。
    if (!kids?.length && r.selfCells === undefined) return;
    const set = new Set<CellId>(r.selfCells ?? []);
    for (const k of kids ?? []) for (const id of k.cells) set.add(id);
    const prev = new Set(r.cells);
    const added: CellId[] = [];
    const removed: CellId[] = [];
    for (const id of set) if (!prev.has(id)) added.push(id);
    for (const id of prev) if (!set.has(id)) removed.push(id);
    writeCells(r, [...set], 'materialize', { delta: { added, removed } });
  };
  for (const r of world.regions) write(r);
}

function regionsWithCells(world: World, layerId: string): { name: string; set: Set<CellId> }[] {
  return world.regions
    .filter((r) => r.layerId === layerId)
    .map((r) => ({ name: r.name, set: new Set(r.cells) }));
}

function contrastAtDepth(depth: number, isFocus: boolean): number {
  const base = depth <= 0 ? 1 : depth === 1 ? 0.75 : 0.55;
  return isFocus ? base : base * 0.45;
}

function mulColor(hex: string, contrast: number): string {
  if (contrast >= 0.99) return hex;
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const mid = 140;
  const mix = (c: number) => {
    const x = mid + (c - mid) * contrast;
    return Math.max(0, Math.min(255, Math.round(x)));
  };
  return `#${[mix((v >> 16) & 255), mix((v >> 8) & 255), mix(v & 255)]
    .map((n) => n.toString(16).padStart(2, '0'))
    .join('')}`;
}

type Slice = { label: string; cells: CellId[] };

/** 父表达式：c → c(A) → c(A(G)) */
function wrapParentExpr(expr: string, ancestorName: string): string {
  if (!expr.includes('(')) return `${expr}(${ancestorName})`;
  const i = expr.indexOf('(');
  const base = expr.slice(0, i);
  const inner = expr.slice(i + 1, -1);
  return `${base}(${inner}(${ancestorName}))`;
}

function sliceByRegions(
  name: string,
  cells: CellId[],
  regions: { name: string; set: Set<CellId> }[],
  baseParentExpr: string | null,
): Slice[] {
  const labelOf = (parentName: string) =>
    baseParentExpr === null
      ? `${name}(${parentName})`
      : `${name}(${wrapParentExpr(baseParentExpr, parentName)})`;
  const out: Slice[] = [];
  const inAny = new Set<CellId>();
  for (const p of regions) {
    const hit = cells.filter((c) => p.set.has(c));
    if (!hit.length) continue;
    for (const c of hit) inAny.add(c);
    out.push({ label: labelOf(p.name), cells: hit });
  }
  const rest = cells.filter((c) => !inAny.has(c));
  if (rest.length) out.push({ label: labelOf(VIRTUAL_PARENT), cells: rest });
  return out;
}

function parentExprOf(label: string, name: string): string {
  if (label.startsWith(`${name}(`) && label.endsWith(')')) {
    return label.slice(name.length + 1, -1);
  }
  return VIRTUAL_PARENT;
}

/**
 * 自近父向远祖切割。
 * ancestorRegionLists[0] = 父层有效 Region（含数据子 cell）；[1] = 祖父层…
 */
export function splitRegionForDisplay(
  region: Region,
  ancestorRegionLists: { name: string; set: Set<CellId> }[][],
): Slice[] {
  const cells = [...region.cells];
  if (!ancestorRegionLists.length) {
    return [{ label: region.name, cells }];
  }
  let slices = sliceByRegions(region.name, cells, ancestorRegionLists[0], null);
  for (let i = 1; i < ancestorRegionLists.length; i++) {
    const next: Slice[] = [];
    for (const s of slices) {
      const expr = parentExprOf(s.label, region.name);
      next.push(...sliceByRegions(region.name, s.cells, ancestorRegionLists[i], expr));
    }
    slices = next;
  }
  return slices;
}

/**
 * 图层是否在地图上展示元素。**显隐唯一真相 = `layer.visible`（眼睛钮）**（2026-10-06
 * 用户定「显隐这个图层是对这个图层的所有内容进行控制的」——填充/描边/标签/核心符号/
 * 装饰全走本谓词；**隐藏优先于焦点**：焦点层被眼睛隐藏后同样全隐，替代 2026-10-02
 * 「焦点层读时强制显示」旧判——该判使焦点层的显隐按钮整体失效（实测焦点+隐藏时
 * placed=3/symbols=7 全残留））。
 * I6 有效显隐：自身 ∧ 祖先链——读时派生，旧档「父隐子显」自愈。
 */
export function isLayerShown(world: World, layerId: string, forceLayerId?: string | null): boolean {
  const l = world.layers.find((x) => x.id === layerId);
  if (!l) return false;
  // baseMesh（地块网格）单独走 cells 门（不进元素合成；其装饰在 decorationsLayer 直判 visible）
  if (l.baseMesh) return false;
  // **绘制模式例外**（2026-10-06 用户定「绘制模式下，选中的图层要强制显示」——
  // 否则画了看不见；替代 2026-10-02 旧「选中即显示」的仅此场景）：force = 绘制
  // 模式下的焦点层 → 读时强制显示（不写 visible、眼睛状态不变）。
  if (forceLayerId && layerId === forceLayerId) return true;
  return effectiveVisible(world, layerId);
}

/**
 * 所有「已展示」层的显示碎片（同一套：边界内填色 + 后续描边）。
 *
 * 叠放（后画 = 高），**与具体图层名无关**（2026-10-06 用户定：列表自上而下 = 地图自下而上）：
 * 1. **焦点图层** > 列表下层第一层级 > 列表上层第一层级
 * 2. 同一树内：**子图层 > 父图层 > 父父…**（先画祖先，后画后代）
 * 3. **工作区选中的元素** 最后画（跨层最顶）
 */
// 记忆化：dataRev + focusLayer + highlightRegionId
let composeCache: { key: string; result: DisplayPiece[] } | null = null;

export function composeShownPieces(
  world: World,
  focusLayerId?: string | null,
  highlightRegionId?: string | null,
  forceLayerId?: string | null,
): DisplayPiece[] {
  const cacheKey = `${dataRev()}|${focusLayerId ?? ''}|${highlightRegionId ?? ''}|${forceLayerId ?? ''}`;
  if (composeCache && composeCache.key === cacheKey) return composeCache.result;
  const result = composeShownPiecesUncached(world, focusLayerId, highlightRegionId, forceLayerId);
  composeCache = { key: cacheKey, result };
  return result;
}

function composeShownPiecesUncached(
  world: World,
  focusLayerId?: string | null,
  highlightRegionId?: string | null,
  forceLayerId?: string | null,
): DisplayPiece[] {
  const focus = focusLayerId || null;
  const byId = new Map(world.layers.map((l) => [l.id, l]));

  const shown = world.layers
    .filter((l) => isLayerShown(world, l.id, forceLayerId))
    .map((l) => l.id);

  // 叠放键 = derive 层叠放比较器单源（HIERARCHY §6.1 包2：焦点整段最后画）
  shown.sort(layerStackComparator(world, focus));

  const selRegion = highlightRegionId
    ? world.regions.find((r) => r.id === highlightRegionId)
    : undefined;
  const out: DisplayPiece[] = [];
  for (const layerId of shown) {
    const layer = byId.get(layerId);
    if (!layer) continue;
    const anc = displayAncestors(world, layerId);
    const rootId = layerRootOf(world, layerId);
    const tree = displayTree(world, rootId);
    const treeIds = new Set(tree.map((t) => t.layerId));
    const regions = world.regions.filter((r) => r.layerId === layerId && !r.hidden);
    if (!regions.length) continue;
    const opacity = layer.opacity ?? 0.88;
    const ancIds = displayAncestors(world, layerId).filter((id) => treeIds.has(id));
    const ancestorRegionLists = ancIds.map((pid) => regionsWithCells(world, pid));

    for (const reg of regions) {
      // 区间型高度档：cells 即**累积**（h ≥ lo，规则期产物）——显示归属 = region.cells 单真相
      // （2026-10-06 包 B：原 displayCellsOfRegion 渲染期派生退役）。
      const ownCells = reg.cells;
      if (!ownCells.length) continue;
      const slices = splitRegionForDisplay(reg, ancestorRegionLists);
      for (const [sliceIndex, s] of slices.entries()) {
        if (!s.cells.length) continue;
        out.push({
          key: `${layerId}:${reg.id}:${sliceIndex}`,
          layerId,
          regionId: reg.id,
          rootLayerId: rootId,
          depth: ancIds.length,
          cellIds: s.cells,
          label: s.label,
          color: mulColor(reg.color, 1),
          opacity,
          regionSelected: selRegion?.id === reg.id,
        });
      }
    }
  }
  // 选中元素碎片一定最顶
  out.sort((a, b) => Number(!!a.regionSelected) - Number(!!b.regionSelected));
  return out;
}
