/**
 * cell 集边界环缓存。
 * 键 = cellIds 指纹 + 投影 + **dataRev()**（O(1) 失效，不扫全图）。
 */
import type { World, CellId } from '../core/types';
import {
  cellSetBoundaryEdges,
  cellSetBoundaryRings,
  indexEdgesByPair,
  type BoundEdge,
} from '../core/ring/build';
import type { MidRing } from '../core/ring/displayRing';
import type { Pt } from '../render/space';
import type { ProjCache } from './projCache';
import { dataRev, geomRev } from '../core/rev';
import { landSeaKindOf } from '../core/layer/landSea';
import { projectionWorldPeriod, type ProjectionId } from '../core/project/projections';
import { polarCellIds } from '../core/voronoi';

export type Ring = MidRing;

type Entry = {
  rings: Ring[];
  poles: { north: boolean; south: boolean };
  fullWorld: boolean;
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
};

let ringsCache = new Map<string, Entry>();
let pairEdgeCache: Map<string, BoundEdge> | null = null;
let pairEdgeGeomRev = -1;
let continentCentersCache: { sig: string; centers: { x: number; y: number }[] } | null = null;
let baseRev = '';
let cachedWorld: World | null = null;

export function invalidateBorderCache(): void {
  ringsCache = new Map();
  pairEdgeCache = null;
  pairEdgeGeomRev = -1;
  continentCentersCache = null;
  baseRev = '';
  cachedWorld = null;
}

function ensureRev(world: World): string {
  const rev = dataRev();
  // 只按内容 rev 失效；不按 world 对象引用（store 每次 touch 浅拷贝会链式误伤）
  if (rev !== baseRev) {
    ringsCache = new Map();
    continentCentersCache = null;
    baseRev = rev;
    cachedWorld = world;
  }
  // pairEdgeCache 是纯几何边表：只随几何域失效，不随 height/regions rev 清空
  const g = geomRev();
  if (!pairEdgeCache || pairEdgeGeomRev !== g) {
    pairEdgeCache = null;
    pairEdgeGeomRev = g;
  }
  return rev;
}

/** 键 = 调用方提示 + 内容指纹（长度/和/FNV）：同一 rev 周期内不同 cell 集绝不串缓存 */
function ringCacheKey(setKey: string, projKey: string, rev: string, cellIds: CellId[]): string {
  let h = 2166136261;
  let sum = 0;
  for (const id of cellIds) {
    h = Math.imul(h ^ id, 16777619);
    sum += id;
  }
  return `${setKey}|${projKey}|${rev}|${cellIds.length}|${sum}|${h >>> 0}`;
}

export function getCellSetRingsCached(
  world: World,
  cellIds: CellId[],
  project: (ll: { lon: number; lat: number }) => Pt,
  projKey: ProjectionId,
  setKey = '',
): Entry {
  const rev = ensureRev(world);
  const key = ringCacheKey(setKey, projKey, rev, cellIds);
  const hit = ringsCache.get(key);
  if (hit) return hit;
  if (!pairEdgeCache) {
    pairEdgeCache = indexEdgesByPair(world);
  }
  const edges = cellSetBoundaryEdges(world, cellIds, pairEdgeCache);
  const rings = cellSetBoundaryRings(
    world, cellIds, project, edges, projectionWorldPeriod(projKey) ?? Math.PI * 2,
  );
  const owners = polarCellIds(world.cells);
  const set = new Set(cellIds);
  const entry: Entry = {
    rings,
    poles: { north: set.has(owners.north), south: set.has(owners.south) },
    fullWorld: world.cells.length > 0 && set.size === world.cells.length,
    bbox: ringBBox(rings),
  };
  ringsCache.set(key, entry);
  return entry;
}

function ringBBox(rings: Ring[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const p of r.pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  return { minX, maxX, minY, maxY };
}

export function ringBBoxHitsView(
  bbox: { minX: number; maxX: number; minY: number; maxY: number },
  viewL: number,
  viewR: number,
  viewT: number,
  viewB: number,
  pad = 0.2,
): boolean {
  return !(
    bbox.maxX + pad < viewL ||
    bbox.minX - pad > viewR ||
    bbox.maxY + pad < viewB ||
    bbox.minY - pad > viewT
  );
}

export function getContinentCentersCached(
  world: World,
  pcache: ProjCache,
): { x: number; y: number }[] {
  const rev = ensureRev(world);
  const sig = `${rev}|${pcache.key}`;
  if (continentCentersCache && continentCentersCache.sig === sig) {
    return continentCentersCache.centers;
  }
  // 从 continent Regions 派生（单一真相）；kind 判定与 landSeaKindOf 同口径
  const continentRegions = world.regions.filter(
    (r) => r.layerId === 'landsea' && landSeaKindOf(r) === 'continent',
  );
  const centers = continentRegions.map((r) => {
    const comp = r.cells;
    if (!comp.length) return { x: 0, y: 0 };
    const x0 = pcache.centers[comp[0] * 2];
    const y0 = pcache.centers[comp[0] * 2 + 1];
    let sx = x0;
    let sy = y0;
    for (let i = 1; i < comp.length; i++) {
      const id = comp[i];
      sx += unwrapXAgainstLocal(x0, pcache.centers[id * 2]);
      sy += pcache.centers[id * 2 + 1];
    }
    return { x: sx / comp.length, y: sy / comp.length };
  });
  continentCentersCache = { sig, centers };
  return centers;
}

function unwrapXAgainstLocal(refX: number, x: number, period = Math.PI * 2): number {
  let v = x;
  const half = period / 2;
  while (v - refX > half) v -= period;
  while (v - refX < -half) v += period;
  return v;
}
