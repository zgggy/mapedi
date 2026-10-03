/**
 * 显示层合成：仅影响绘制，不改 cell/Region 数据。
 * - 显示父子 = Layer.parentLayerId（禁环，无包含校验）
 * - 子 Region 被父 Region 切成碎片：标签 name(parent)；父外 name(—)
 * - 多级祖先：r(c(A))（子名在左，祖先自内向外）
 */
import type { CellId, LayerDef, Region, World } from './types';
import { dataRev } from './rev';
import { displayCellsOfInterval } from './layer/heightElements';

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
  exclusiveColor?: string;
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
  let cur = byId.get(layerId)?.parentLayerId;
  while (cur && !seen.has(cur)) {
    out.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.parentLayerId;
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
    const p = l.parentLayerId;
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
    const p = l.parentLayerId;
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
 * 父 Region 的 cells **必须已物化**为子并集（生成/改归属后调用 materializeParentCells）。
 * 显示切分直接读 `region.cells`，不再现场并集。
 */
export function materializeParentCells(world: World): void {
  const childrenOf = new Map<string, Region[]>();
  for (const r of world.regions) {
    if (!r.parentId) continue;
    let arr = childrenOf.get(r.parentId);
    if (!arr) {
      arr = [];
      childrenOf.set(r.parentId, arr);
    }
    arr.push(r);
  }
  const seen = new Set<string>();
  const write = (r: Region) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    for (const k of childrenOf.get(r.id) ?? []) write(k);
    const kids = childrenOf.get(r.id);
    if (!kids?.length) return;
    // 精确派生：父 ≡ ∪子（AGENTS §3「父 cells 必须已物化子并集」字面语义）。
    // 旧实现从父现有 cells 起并 = **只加不减** → 撤销回滚子层后父层残留（步骤7 修复；
    // 2026-10-01 实测 7 对父子中 6 对恒等，唯一 extra 全为历史残留本身 → 从空重建自愈）。
    const set = new Set<number>();
    for (const k of kids) for (const id of k.cells) set.add(id);
    r.cells = [...set];
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
 * 图层是否在地图上展示元素。两层语义（2026-10-02 用户原话「选中既显示，不影响
 * 显隐状态按钮」）：
 * - **存储显隐** = `layer.visible`，只有眼睛钮写它；
 * - **选中即显示** = 焦点层读时强制显示——不写 visible、不动眼睛状态与按钮，
 *   焦点走完自动回到存储态。（替代 2026-09-28「焦点不改显示」旧判——该判造成
 *   选中了却看不见；实现为读时派生，不是恢复当年的写入方案。）
 */
export function isLayerShown(
  world: World,
  layerId: string,
  focusLayerId?: string | null,
): boolean {
  const l = world.layers.find((x) => x.id === layerId);
  if (!l) return false;
  // baseMesh（地块网格）单独走 cells 门；自由层（路/航线）不再短路——
  if (l.baseMesh) return false;
  // 选中即显示：焦点层（且仅焦点层本身）读时强制显示
  if (focusLayerId && layerId === focusLayerId) return true;
  return isVisible(l, defaultLayerVisible(l));
}

/**
 * 所有「已展示」层的显示碎片（同一套：边界内填色 + 后续描边）。
 *
 * 叠放（后画 = 高），**与具体图层名无关**：
 * 1. **焦点图层** > 列表上层第一层级 > 列表下层第一层级
 * 2. 同一树内：**子图层 > 父图层 > 父父…**（先画祖先，后画后代）
 * 3. **工作区选中的元素** 最后画（跨层最顶）
 */
// 记忆化：dataRev + focusLayer + highlightRegionId
let composeCache: { key: string; result: DisplayPiece[] } | null = null;

export function composeShownPieces(
  world: World,
  focusLayerId?: string | null,
  highlightRegionId?: string | null,
): DisplayPiece[] {
  const cacheKey = `${dataRev()}|${focusLayerId ?? ''}|${highlightRegionId ?? ''}`;
  if (composeCache && composeCache.key === cacheKey) return composeCache.result;
  const result = composeShownPiecesUncached(world, focusLayerId, highlightRegionId);
  composeCache = { key: cacheKey, result };
  return result;
}

function composeShownPiecesUncached(
  world: World,
  focusLayerId?: string | null,
  highlightRegionId?: string | null,
): DisplayPiece[] {
  const focus = focusLayerId || null;
  const byId = new Map(world.layers.map((l) => [l.id, l]));
  const listIndex = new Map<string, number>();
  world.layers.forEach((l, i) => listIndex.set(l.id, i));

  /** 沿 parentLayerId 爬到第一层级根 */
  const rootOf = (id: string): string => {
    let cur = id;
    for (let g = 0; g < 16; g++) {
      const p = byId.get(cur)?.parentLayerId;
      if (!p || !byId.has(p)) break;
      cur = p;
    }
    return cur;
  };
  /** 树深度：0 = 第一层级，越大越「子」 */
  const depthOf = (id: string): number => {
    let d = 0;
    let cur = id;
    for (let g = 0; g < 16; g++) {
      const p = byId.get(cur)?.parentLayerId;
      if (!p || !byId.has(p)) break;
      cur = p;
      d++;
    }
    return d;
  };

  const shown = world.layers
    .filter((l) => isLayerShown(world, l.id, focus))
    .map((l) => l.id);

  // 先画：非焦点；同组内列表下层根 → 列表上层根；同根内 父 → 子
  shown.sort((a, b) => {
    const fa = a === focus ? 1 : 0;
    const fb = b === focus ? 1 : 0;
    if (fa !== fb) return fa - fb;
    const ra = listIndex.get(rootOf(a)) ?? 0;
    const rb = listIndex.get(rootOf(b)) ?? 0;
    // 列表 index 小 = 列表更靠上 = 更高 z = 后画 → 先画 index 大者
    if (ra !== rb) return rb - ra;
    return depthOf(a) - depthOf(b);
  });

  const selRegion = highlightRegionId
    ? world.regions.find((r) => r.id === highlightRegionId)
    : undefined;
  const out: DisplayPiece[] = [];
  for (const layerId of shown) {
    const layer = byId.get(layerId);
    if (!layer) continue;
    const anc = displayAncestors(world, layerId);
    const rootId = rootOf(layerId);
    const tree = displayTree(world, rootId);
    const treeIds = new Set(tree.map((t) => t.layerId));
    const regions = world.regions.filter((r) => r.layerId === layerId && !r.hidden);
    if (!regions.length) continue;
    const opacity = layer.opacity ?? 0.88;
    const ancIds = displayAncestors(world, layerId).filter((id) => treeIds.has(id));
    const ancestorRegionLists = ancIds.map((pid) => regionsWithCells(world, pid));

    for (const reg of regions) {
      // 区间型元素（高度档）：显示归属 = 累积（直接 ∪ 更高，h ≥ lo，2026-09-30 用户定）。
      // 数据仍是精确档；单源派生 = displayCellsOfInterval（件环 Δ 补丁同一谓词）。
      const ownCells =
        reg.attributes?.kind === 'interval' ? displayCellsOfInterval(world, reg) : reg.cells;
      if (!ownCells.length) continue;
      const slices = splitRegionForDisplay(
        ownCells === reg.cells ? reg : { ...reg, cells: ownCells },
        ancestorRegionLists,
      );
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
          exclusiveColor: reg.exclusiveColor,
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
