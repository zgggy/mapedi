import type { Cell, CellId, Region, World } from '../types';
import { isLand } from '../types';
import { childLayerIdOf } from '../hierarchy/derive';
import { getCellGrid } from '../index/cellGrid';
import { getRegionIndex, invalidateRegionIndex } from '../index/regionIndex';
import { writeCells } from '../occupy';

/**
 * 工具集（C3 清算 2026-09-30；2026-10-06 包 A 死物清账）：
 * - `brush` 通用水笔刷（B）；`road` 道路/航线层专用（由 startDraw 按层自动选中）。
 * - `fill` / `center`：**从未接入任何绘制分支**（死值）→ 删；`weight`：用户定
 *   「设置权重的笔刷不再被需要」→ 删——2026-10-06 把该词汇最后遗物
 *   adjustWeights/regionWeight/shareCellsWithOthers/removeCellsFromRegion 物理删除
 *   （src+tests 双向 grep 零引用取证）；floodFillCells/stealFromSiblings/addCellsToRegion 保留
 *   （drawController 会话链引用）。原 setCenter（核心格直写）已随「设中心」收敛到
 *   commandService.setCoreCell（RegionFieldsCommand）删除。
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
  /** 正在拖动的道路端点 cell */
  draggingEndpointCell?: CellId | null;
  /** 高度笔刷模式（2026-10-06：涂改=写值 / 平滑=图拉普拉斯抹台阶） */
  heightMode?: 'paint' | 'smooth';
  /** 平滑强度 = 迭代次数（拍板 2a：1/3/5） */
  smoothIter?: 1 | 3 | 5;
  /** 海岸保护开关（拍板 3：默认开） */
  smoothCoast?: boolean;
}

export function emptyDrawSession(): DrawSession {
  return {
    active: false,
    targetRegionId: null,
    tool: 'brush',
    radiusDeg: 1.5,
    addMode: true,
    heightMode: 'paint',
    smoothIter: 3,
    smoothCoast: true,
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
    // 经度差 wrap（跨 180° 等价，2026-10-06 与 grid 同修）
    let dx = c.center.lon - lon;
    dx = (((dx + 180) % 360) + 360) % 360 - 180;
    const dy = c.center.lat - lat;
    if (dx * dx + dy * dy <= r2) hits.push(c.id);
  }
  return hits;
}

export function addCellsToRegion(region: Region, cells: CellId[]): number {
  const set = new Set(region.cells);
  const added: CellId[] = [];
  for (const id of cells) {
    if (!set.has(id)) {
      set.add(id);
      added.push(id);
    }
  }
  if (added.length) writeCells(region, [...set], 'paint', { delta: { added, removed: [] } });
  return added.length;
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
  // owners() 读的是 index 缓存（worldKey 键控、循环内不受本次写入影响）→ 先收集后落写，
  // 与「边循环边 filter」终态一致（2026-10-06 包 C：经占据写入器）
  const drop = new Map<string, Set<CellId>>();
  for (const cid of cells) {
    const owners = index.owners(world, region.layerId, cid);
    for (const oid of owners) {
      if (oid === region.id) continue;
      let s = drop.get(oid);
      if (!s) {
        s = new Set();
        drop.set(oid, s);
      }
      s.add(cid);
    }
  }
  for (const [oid, s] of drop) {
    const other = world.regions.find((r) => r.id === oid);
    if (!other) continue;
    const removed = other.cells.filter((c) => s.has(c));
    if (!removed.length) continue;
    writeCells(other, other.cells.filter((c) => !s.has(c)), 'paint', { delta: { added: [], removed } });
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

