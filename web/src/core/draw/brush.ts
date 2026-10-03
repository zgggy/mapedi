import type { Cell, CellId, Region, World } from '../types';
import { isLand } from '../types';
import { childLayerIdOf } from '../hierarchy/derive';
import { getCellGrid } from '../index/cellGrid';
import { getRegionIndex, invalidateRegionIndex } from '../index/regionIndex';

/**
 * 工具集（C3 清算 2026-09-30：按「与实际功能相关」裁定）：
 * - `brush` 通用水笔刷（B）；`road` 道路/航线层专用（由 startDraw 按层自动选中）。
 * - `fill` / `center`：**从未接入任何绘制分支**（死值）→ 删；`weight`：用户定
 *   「设置权重的笔刷不再被需要」→ 删。辅助函数（floodFill/setCenter/adjustWeights）
 *   有测试覆盖，作为几何工具保留。
 */
export type DrawTool = 'brush' | 'road';

export interface DrawSession {
  active: boolean;
  /** 真正被绘制的 Region */
  targetRegionId: string | null;
  /** 若有子层，显示「父 · 子」 */
  parentRegionId?: string;
  tool: DrawTool;
  /** 笔刷半径（度，约） */
  radiusDeg: number;
  addMode: boolean;
  /** 权重笔刷步进 0–1 */
  weightStep: number;
  /** 权重方向：+加 −减 */
  weightDir: 1 | -1;
  /** 正在拖动的道路端点 cell */
  draggingEndpointCell?: CellId | null;
}

export function emptyDrawSession(): DrawSession {
  return {
    active: false,
    targetRegionId: null,
    tool: 'brush',
    radiusDeg: 1.5,
    addMode: true,
    weightStep: 0.15,
    weightDir: 1,
  };
}

/** 国家绘制且有子层时，目标改为该国下当前选中/第一个行省，或自动建一个 */
export function resolveDrawTarget(
  world: World,
  session: DrawSession,
): { region: Region; parent?: Region } | 'height' | null {
  if (!session.targetRegionId) return null;
  // 高度层：`__height__` 或 `__height__:hN`
  if (session.targetRegionId === '__height__' || session.targetRegionId.startsWith('__height__')) {
    return 'height';
  }
  const region = world.regions.find((r) => r.id === session.targetRegionId);
  if (!region) return null;
  const layer = world.layers.find((l) => l.id === region.layerId);
  if (layer?.parentLayerId) {
    return { region };
  }
  // 有子层（国家 → 行省）：笔刷画子层
  const childLayerId = childLayerIdOf(world, region.layerId);
  if (!childLayerId) return { region };

  if (session.parentRegionId) {
    const child = world.regions.find(
      (r) => r.id === session.parentRegionId && r.parentId === region.id,
    );
    if (child) return { region: child, parent: region };
  }
  const first = world.regions.find((r) => r.parentId === region.id);
  if (first) return { region: first, parent: region };

  // 自动创建子 Region
  const created: Region = {
    id: `${childLayerId}-${region.id}-auto`,
    layerId: childLayerId,
    name: `${region.name}·行省`,
    cells: [],
    parentId: region.id,
    color: region.color,
    attributes: {},
  };
  world.regions.push(created);
  session.parentRegionId = created.id;
  return { region: created, parent: region };
}

/** 以 cell 中心距离为准收集笔刷命中的 cell（空间网格） */
export function cellsInBrush(
  world: World,
  lon: number,
  lat: number,
  radiusDeg: number,
): CellId[] {
  if (world.cells.length > 800) {
    return getCellGrid(world).queryRadius(world, lon, lat, radiusDeg);
  }
  const r2 = radiusDeg * radiusDeg;
  const hits: CellId[] = [];
  for (const c of world.cells) {
    const dx = c.center.lon - lon;
    const dy = c.center.lat - lat;
    if (dx * dx + dy * dy <= r2) hits.push(c.id);
  }
  return hits;
}

export function addCellsToRegion(region: Region, cells: CellId[]): number {
  const set = new Set(region.cells);
  let n = 0;
  for (const id of cells) {
    if (!set.has(id)) {
      set.add(id);
      n++;
    }
  }
  if (n) region.cells = [...set];
  return n;
}

export function removeCellsFromRegion(region: Region, cells: CellId[]): number {
  const drop = new Set(cells);
  const before = region.cells.length;
  region.cells = region.cells.filter((id) => !drop.has(id));
  return before - region.cells.length;
}

/** 同层互斥：把 cell 从同层其它 Region 移除（非重叠层） */
export function stealFromSiblings(
  world: World,
  region: Region,
  cells: CellId[],
): void {
  const layer = world.layers.find((l) => l.id === region.layerId);
  if (layer?.allowOverlap) return;
  const index = getRegionIndex(world);
  for (const cid of cells) {
    const owners = index.owners(world, region.layerId, cid);
    for (const oid of owners) {
      if (oid === region.id) continue;
      const other = world.regions.find((r) => r.id === oid);
      if (!other) continue;
      other.cells = other.cells.filter((c) => c !== cid);
    }
  }
  invalidateRegionIndex();
}

/** 洪水填充：从 start 扩散到邻接 land（或全部），可选限高陆地 */
export function floodFillCells(
  world: World,
  start: CellId,
  landOnly: boolean,
): CellId[] {
  const startCell = world.cells[start];
  if (!startCell) return [];
  const wantLand = landOnly ? isLand(startCell) : null;
  const seen = new Set<CellId>([start]);
  const out: CellId[] = [start];
  const stack = [start];
  while (stack.length) {
    const id = stack.pop()!;
    for (const n of world.cells[id].neighbors) {
      if (seen.has(n)) continue;
      const c = world.cells[n];
      if (wantLand !== null && isLand(c) !== wantLand) continue;
      seen.add(n);
      out.push(n);
      stack.push(n);
    }
  }
  return out;
}

export function setCenter(region: Region, cellId: CellId): void {
  region.centerCellId = cellId;
}

/** 射线法：点是否在多边形内（lonlat 平面近似） */
export function pointInPolygon(
  lon: number,
  lat: number,
  poly: { lon: number; lat: number }[],
): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].lon;
    const yi = poly[i].lat;
    const xj = poly[j].lon;
    const yj = poly[j].lat;
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function cellsInPolygon(
  world: World,
  poly: { lon: number; lat: number }[],
): CellId[] {
  if (poly.length < 3) return [];
  const hits: CellId[] = [];
  for (const c of world.cells) {
    if (pointInPolygon(c.center.lon, c.center.lat, poly)) hits.push(c.id);
  }
  return hits;
}

/** 重叠层：调整权重；归零从 cells 移除 */
export function adjustWeights(
  region: Region,
  cells: CellId[],
  delta: number,
): void {
  if (!region.weights) region.weights = new Map();
  const inCells = new Set(region.cells);
  for (const id of cells) {
    if (!inCells.has(id) && delta > 0) {
      region.cells.push(id);
      inCells.add(id);
      region.weights.set(id, Math.max(0, Math.min(1, delta)));
      continue;
    }
    if (!inCells.has(id)) continue;
    const cur = region.weights.get(id) ?? 1;
    const next = Math.max(0, Math.min(1, cur + delta));
    if (next <= 0) {
      region.weights.delete(id);
      region.cells = region.cells.filter((c) => c !== id);
    } else {
      region.weights.set(id, next);
    }
  }
}

export function regionWeight(region: Region, cellId: CellId): number {
  if (!region.cells.includes(cellId)) return 0;
  return region.weights?.get(cellId) ?? 1;
}

/**
 * Ctrl 绘制：与该 cell 上同层所有占有方分摊权重。
 * 目标权重 +step，其它按比例扣；扣到 0 则移出。
 */
export function shareCellsWithOthers(
  world: World,
  region: Region,
  cells: CellId[],
  step = 0.15,
): void {
  const layer = world.layers.find((l) => l.id === region.layerId);
  if (!layer?.allowOverlap) {
    // 非重叠层：退化为抢占
    stealFromSiblings(world, region, cells);
    addCellsToRegion(region, cells);
    return;
  }
  const index = getRegionIndex(world);
  if (!region.weights) region.weights = new Map();
  const inSet = new Set(region.cells);
  for (const cid of cells) {
    if (!inSet.has(cid)) {
      region.cells.push(cid);
      inSet.add(cid);
      region.weights.set(cid, Math.min(1, step));
    } else {
      const cur = region.weights.get(cid) ?? 1;
      region.weights.set(cid, Math.min(1, cur + step));
    }
    const owners = index.owners(world, region.layerId, cid);
    const others = owners.filter((id) => id !== region.id);
    if (others.length === 0) continue;
    // 从其它占有方扣 step / n
    const cut = step / others.length;
    for (const oid of others) {
      const o = world.regions.find((r) => r.id === oid);
      if (!o) continue;
      if (!o.weights) o.weights = new Map();
      const ow = o.weights.get(cid) ?? 1;
      const nw = Math.max(0, ow - cut);
      if (nw <= 0) {
        o.weights.delete(cid);
        o.cells = o.cells.filter((c) => c !== cid);
      } else {
        o.weights.set(cid, nw);
      }
    }
  }
  invalidateRegionIndex();
}

/** 点在任一 cell 多边形内 → cellId；用于端点命中 */
export function cellAtPoint(world: World, lon: number, lat: number): CellId | null {
  // 先最近中心粗筛，再精确多边形
  let best: Cell | null = null;
  let bestD = Infinity;
  for (const c of world.cells) {
    if (c.polygon.length < 3) continue;
    const d = (c.center.lon - lon) ** 2 + (c.center.lat - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  if (!best) return null;
  // 检查 best 与邻居
  const candidates = [best.id, ...best.neighbors];
  for (const id of candidates) {
    const c = world.cells[id];
    if (c && pointInPolygon(lon, lat, c.polygon)) return id;
  }
  return null;
}

