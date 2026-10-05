/**
 * 元素核心格（首府 / 省会 / 文化中心）选取 —— **单源**（LABEL_DESIGN_2026-10-04 包3 · R16/P7）。
 *
 * 生成期（`generate/unified` 按 `GenConfig.coreSelector`）与用户期（检查区「设中心」按钮）
 * 共用这一个函数，禁止在消费点各写一套。
 *
 * `visualCenter`（P7 推荐默认）= **面内到边界最远的格子**（最大内接处的格级近似）：
 *  - 为什么不是质心：凹形/狭长时质心会落到面外，「离质心最近的格」会退化成边缘格；
 *  - 为什么是距离场：我们的格是 Voronoi——过中点的边就是两心连线的中垂线，所以
 *    边界格到自己边界的距离 = `|pq|/2`（p、q = 相邻两心），内部格由**多源 Dijkstra**
 *    从边界传播（路径 ≥ 直线 ⇒ 得到的是**上界**，排序方向正确：越深的内部越靠前）；
 *  - 空间用 mercator（与 `centermost` 同域）：核心格是**数据**不是显示，必须投影无关。
 */
import type { CellId, Region, World } from './types';
import type { CoreSelector } from './layer/genTypes';
import { projectMercator } from './project/mercator';

function heightAt(world: World, id: CellId): number {
  return world.cells[id]?.height ?? 0;
}

/** 最小堆（键 = 距离）：Dijkstra 用，k ≤ 数千格，O(k log k) */
interface HeapItem {
  id: CellId;
  d: number;
}
function heapPush(h: HeapItem[], it: HeapItem): void {
  h.push(it);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p].d <= h[i].d) break;
    const t = h[p];
    h[p] = h[i];
    h[i] = t;
    i = p;
  }
}
function heapPop(h: HeapItem[]): HeapItem | undefined {
  const top = h[0];
  const last = h.pop();
  if (h.length && last) {
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = i * 2 + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && h[l].d < h[m].d) m = l;
      if (r < h.length && h[r].d < h[m].d) m = r;
      if (m === i) break;
      const t = h[m];
      h[m] = h[i];
      h[i] = t;
      i = m;
    }
  }
  return top;
}

/** 面内到边界最远的格子 = 视觉中心（核心格的 P7 推荐默认） */
function visualCenterCell(world: World, cells: CellId[]): CellId {
  if (cells.length <= 2) return cells[0];
  const set = new Set(cells);
  const pts = new Map<CellId, { x: number; y: number }>();
  for (const id of cells) pts.set(id, projectMercator(world.cells[id].center));
  const dist = new Map<CellId, number>();
  const heap: HeapItem[] = [];
  // 边界格种子：到自己那条中垂边的距离 = |pq|/2（Voronoi 性质）
  for (const id of cells) {
    const a = pts.get(id)!;
    let r = Infinity;
    for (const nb of world.cells[id]?.neighbors ?? []) {
      if (set.has(nb)) continue;
      const b = projectMercator(world.cells[nb].center);
      const d = Math.hypot(a.x - b.x, a.y - b.y) / 2;
      if (d < r) r = d;
    }
    if (r < Infinity) {
      dist.set(id, r);
      heapPush(heap, { id, d: r });
    }
  }
  // 元素没有外部邻居（= 全域件）→ 无边界可言，退回质心最近格
  if (!heap.length) {
    let cx = 0;
    let cy = 0;
    for (const id of cells) {
      const p = pts.get(id)!;
      cx += p.x;
      cy += p.y;
    }
    cx /= cells.length;
    cy /= cells.length;
    let best = cells[0];
    let bestD = Infinity;
    for (const id of cells) {
      const p = pts.get(id)!;
      const d = (p.x - cx) ** 2 + (p.y - cy) ** 2;
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }
  const done = new Set<CellId>();
  let best = cells[0];
  let bestD = -1;
  while (heap.length) {
    const top = heapPop(heap);
    if (!top || done.has(top.id)) continue;
    done.add(top.id);
    // 弹出即定值（Dijkstra）；按弹出序单调不减 → 最后弹出的即最大
    if (top.d > bestD) {
      bestD = top.d;
      best = top.id;
    }
    const a = pts.get(top.id)!;
    for (const nb of world.cells[top.id]?.neighbors ?? []) {
      if (!set.has(nb) || done.has(nb)) continue;
      const b = pts.get(nb)!;
      const nd = top.d + Math.hypot(a.x - b.x, a.y - b.y);
      const cur = dist.get(nb);
      if (cur === undefined || nd < cur) {
        dist.set(nb, nd);
        heapPush(heap, { id: nb, d: nd });
      }
    }
  }
  return best;
}

/**
 * 核心格选取（生成期 + 检查区「设中心」共用；`rng` 只有 random/nearBoundary 用）。
 */
export function selectCoreCell(
  world: World,
  cells: CellId[],
  selector: CoreSelector,
  rng: () => number,
): CellId {
  if (!cells.length) return 0;
  switch (selector) {
    case 'visualCenter':
      return visualCenterCell(world, cells);
    case 'centermost': {
      const pts = cells.map((id) => projectMercator(world.cells[id].center));
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      let best = cells[0];
      let bestD = Infinity;
      for (let i = 0; i < cells.length; i++) {
        const d = (pts[i].x - cx) ** 2 + (pts[i].y - cy) ** 2;
        if (d < bestD) {
          bestD = d;
          best = cells[i];
        }
      }
      return best;
    }
    case 'highElevation': {
      let best = cells[0];
      let bestH = -Infinity;
      for (const id of cells) {
        const h = heightAt(world, id);
        if (h > bestH) {
          bestH = h;
          best = id;
        }
      }
      return best;
    }
    case 'lowElevation': {
      let best = cells[0];
      let bestH = Infinity;
      for (const id of cells) {
        const h = heightAt(world, id);
        if (h < bestH) {
          bestH = h;
          best = id;
        }
      }
      return best;
    }
    case 'nearBoundary': {
      const set = new Set(cells);
      const border: CellId[] = [];
      for (const id of cells) {
        if (world.cells[id].neighbors.some((n) => !set.has(n))) border.push(id);
      }
      if (border.length) return border[Math.floor(rng() * border.length)];
      return visualCenterCell(world, cells);
    }
    case 'random':
    default:
      return cells[Math.floor(rng() * cells.length)];
  }
}

/** 视觉中心（无随机性；检查区「设中心=视觉中心」按钮直接用这个） */
export function visualCoreCell(world: World, cells: CellId[]): CellId {
  return selectCoreCell(world, cells, 'visualCenter', () => 0.5);
}

/**
 * 元素**核心格**单源（选项1 · 两形态互斥）：
 *  - `coreRegionId`（核心=子元素）→ 取该子元素的核心格（子元素自己的核心也可能是子元素，
 *    限一层：`child.coreRegionId ?? child.centerCellId ?? cells[0]`，读侧不递归，
 *    写侧由 repairHierarchy 保证子元素不会再指向孙元素）；
 *  - 否则 `centerCellId`（核心=本层地块）。
 * 悬空 `coreRegionId` → 回退 centerCellId（便宜自愈；写侧在 gate.repairHierarchy 清除）。
 */
export function coreCellOf(
  world: World,
  r: Pick<Region, 'coreRegionId' | 'centerCellId' | 'cells'>,
): CellId | undefined {
  if (r.coreRegionId) {
    const child = world.regions.find((x) => x.id === r.coreRegionId);
    if (!child) return r.centerCellId;
    // 子元素自身也可能是「核心=孙元素」→ 限一层取孙元素的地块核心（写侧 repair 禁止无限深）
    if (child.coreRegionId) {
      const grand = world.regions.find((x) => x.id === child.coreRegionId);
      if (grand) return grand.centerCellId ?? grand.cells[0];
    }
    return child.centerCellId ?? child.cells[0];
  }
  return r.centerCellId;
}
