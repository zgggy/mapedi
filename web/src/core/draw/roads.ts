import type { CellId, LonLat, Region, World } from '../types';

export interface RoadSegment {
  a: CellId;
  b: CellId;
  pa: LonLat;
  pb: LonLat;
}

/** 邻接成段：region.cells 内共享邻接的边 */
export function buildRoadSegments(world: World, region: Region): RoadSegment[] {
  const set = new Set(region.cells);
  const segs: RoadSegment[] = [];
  const seen = new Set<string>();
  for (const id of region.cells) {
    const cell = world.cells[id];
    if (!cell) continue;
    for (const n of cell.neighbors) {
      if (!set.has(n)) continue;
      const key = id < n ? `${id}-${n}` : `${n}-${id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = id < n ? id : n;
      const b = id < n ? n : id;
      segs.push({
        a,
        b,
        pa: endpointOf(world, region, a),
        pb: endpointOf(world, region, b),
      });
    }
  }
  return segs;
}

export function endpointOf(world: World, region: Region, cellId: CellId): LonLat {
  const ov = region.endpointOverrides?.get(cellId);
  if (ov) return ov;
  return world.cells[cellId]?.center ?? { lon: 0, lat: 0 };
}

export function setEndpointOverride(
  region: Region,
  cellId: CellId,
  ll: LonLat | null,
): void {
  if (!region.endpointOverrides) region.endpointOverrides = new Map();
  if (ll === null) region.endpointOverrides.delete(cellId);
  else region.endpointOverrides.set(cellId, ll);
}

/**
 * 拖端点：若落在 cell 多边形内 → 改 override；
 * 若落在另一 cell → 取消原 cell 道路归属，把目标 cell 纳入道路。
 */
export function dragRoadEndpoint(
  world: World,
  region: Region,
  fromCell: CellId,
  lon: number,
  lat: number,
  hitCell: CellId | null,
  pointInsideFrom: boolean,
): 'override' | 'transfer' | 'none' {
  if (pointInsideFrom) {
    setEndpointOverride(region, fromCell, { lon, lat });
    return 'override';
  }
  if (hitCell !== null && hitCell !== fromCell && world.cells[hitCell]) {
    region.cells = region.cells.filter((c) => c !== fromCell);
    setEndpointOverride(region, fromCell, null);
    if (!region.cells.includes(hitCell)) region.cells.push(hitCell);
    // 目标默认中心端点，可再拖
    return 'transfer';
  }
  return 'none';
}

/** 连通分量数（道路断裂检测） */
export function roadComponentCount(world: World, region: Region): number {
  const set = new Set(region.cells);
  const seen = new Set<CellId>();
  let comps = 0;
  for (const start of region.cells) {
    if (seen.has(start)) continue;
    comps++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const id = stack.pop()!;
      for (const n of world.cells[id].neighbors) {
        if (set.has(n) && !seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
  }
  return comps;
}
