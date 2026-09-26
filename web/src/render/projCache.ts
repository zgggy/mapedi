import type { LonLat, World } from '../core/types';
import {
  project,
  projectionWorldPeriod,
  type ProjectionId,
  type ProjectionParams,
} from '../core/project/projections';
import { FRAME_LAT, unwrapXAgainst, wrapPeriod } from './space';
import { getViewIndex, type ViewIndex, type Rect } from './viewIndex';
import { polarCellIds } from '../core/voronoi';

export interface ProjCache {
  key: string;
  polys: Float64Array[];
  /** Polar picking uses a frame-closed polygon; the mesh uses only actual cell edges. */
  polarOutlines: Map<number, Float64Array>;
  centers: Float64Array;
  bboxes: Float64Array;
  worldBBox: Rect;
  view: ViewIndex;
}

let cache: ProjCache | null = null;

function cacheKey(world: World, proj: ProjectionId, pp: ProjectionParams): string {
  return `${world.meta.seed}:${world.meta.cellCount}:${world.cells.length}:${proj}:${pp.centralMeridian}:${pp.aeqdCenter.lon}:${pp.aeqdCenter.lat}`;
}

/** 显示用顶点键：0.01° 网格 + ±180 缝（合并浮点微差，角点必须同一 id） */
function vertKey(ll: LonLat): string {
  let lon = ll.lon;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  if (Math.abs(lon) >= 180 - 1e-2) lon = 180;
  return `${Math.round(lon * 100)},${Math.round(ll.lat * 100)}`;
}

type Vert = { x: number; y: number };

/**
 * 问题：同一角点在不同 cell 里投影/unwrap 不一致 → 顶点对不上、真缝。
 * 原理：
 * 1) **合并顶点表**（0.01°）→ 同一角点同一 (x,y)
 * 2) 每 cell 在表坐标上 **沿环连续 unwrap**（多边形不断）
 * 3) 整格平移 2π 对齐到 wrapPeriod(中心)，跨日界线不拆邻接
 */
function buildSharedProjectedVerts(
  world: World,
  projectFn: (ll: LonLat) => { x: number; y: number },
): Map<string, Vert> {
  const table = new Map<string, Vert>();
  for (const cell of world.cells) {
    for (const q of cell.polygon ?? []) {
      const k = vertKey(q);
      if (table.has(k)) continue;
      let lon = q.lon;
      while (lon > 180) lon -= 360;
      while (lon < -180) lon += 360;
      const p = projectFn({ lon, lat: q.lat });
      table.set(k, { x: p.x, y: p.y });
    }
  }
  return table;
}

export function getProjCache(
  world: World,
  proj: ProjectionId,
  pp: ProjectionParams,
): ProjCache {
  const key = cacheKey(world, proj, pp);
  // 只按 key 失效：key 含 seed/cellCount/proj/pp，覆盖几何与投影变化。
  // 不按 world 引用失效——store 浅拷贝 {…world} 会换引用但几何没变，全量重建 O(N) 太贵。
  if (cache && cache.key === key) return cache;
  const n = world.cells.length;
  const polys: Float64Array[] = new Array(n);
  const polarOutlines = new Map<number, Float64Array>();
  const centers = new Float64Array(n * 2);
  const bboxes = new Float64Array(n * 4);
  let gMinX = Infinity;
  let gMaxX = -Infinity;
  let gMinY = Infinity;
  let gMaxY = -Infinity;
  const projectFn = (ll: LonLat) => project(ll, proj, pp);
  const period = projectionWorldPeriod(proj) ?? Math.PI * 2;
  const table = buildSharedProjectedVerts(world, projectFn);
  const poles = polarCellIds(world.cells);

  for (const cell of world.cells) {
    const c = projectFn(cell.center);
    centers[cell.id * 2] = c.x;
    centers[cell.id * 2 + 1] = c.y;

    const vs: Vert[] = [];
    for (const q of cell.polygon ?? []) {
      const v = table.get(vertKey(q));
      if (v) vs.push(v);
    }
    if (vs.length < 3) {
      polys[cell.id] = new Float64Array(0);
      continue;
    }

    // 沿环连续 unwrap（多边形不断）
    const xs = vs.map((v) => v.x);
    const ys = vs.map((v) => v.y);
    for (let i = 1; i < xs.length; i++) {
      xs[i] = unwrapXAgainst(xs[i - 1], xs[i], period);
    }
    // 整格对齐到中心所在 2π 副，跨日界线邻接仍共用表顶点
    const cx = wrapPeriod(c.x, period);
    let midX = 0;
    for (const x of xs) midX += x;
    midX /= xs.length;
    const shift = period * Math.round((cx - midX) / period);
    if (shift !== 0) {
      for (let i = 0; i < xs.length; i++) xs[i] += shift;
    }

    const polar = projectionWorldPeriod(proj) !== null &&
      (cell.id === poles.north || cell.id === poles.south);
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);

    const out: number[] = [];
    if (!polar) {
      for (let i = 0; i < xs.length; i++) out.push(xs[i], ys[i]);
    } else {
      const outline: number[] = [];
      for (let i = 0; i < xs.length; i++) outline.push(xs[i], ys[i]);
      polarOutlines.set(cell.id, Float64Array.from(outline));
      const north = cell.id === poles.north;
      const edgeLat = north ? FRAME_LAT : -FRAME_LAT;
      const edgeY = projectFn({ lon: 0, lat: edgeLat }).y;
      const seamX = unwrapXAgainst(xs[xs.length - 1], xs[0], period);
      for (let i = 0; i < xs.length; i++) out.push(xs[i], ys[i]);
      // 真实末边到相邻副本的首点；随后仅填充沿极侧框线闭合。
      out.push(seamX, ys[0], seamX, edgeY, xs[0], edgeY);
      minX = Math.min(minX, seamX);
      maxX = Math.max(maxX, seamX);
      minY = Math.min(minY, edgeY);
      maxY = Math.max(maxY, edgeY);
    }

    polys[cell.id] = Float64Array.from(out);
    const bx0 = Math.min(minX, c.x);
    const bx1 = Math.max(maxX, c.x);
    const by0 = Math.min(minY, c.y);
    const by1 = Math.max(maxY, c.y);
    bboxes[cell.id * 4] = bx0;
    bboxes[cell.id * 4 + 1] = bx1;
    bboxes[cell.id * 4 + 2] = by0;
    bboxes[cell.id * 4 + 3] = by1;
    if (bx0 < gMinX) gMinX = bx0;
    if (bx1 > gMaxX) gMaxX = bx1;
    if (by0 < gMinY) gMinY = by0;
    if (by1 > gMaxY) gMaxY = by1;
  }

  const worldBBox: Rect = Number.isFinite(gMinX)
    ? { minX: gMinX, maxX: gMaxX, minY: gMinY, maxY: gMaxY }
    : { minX: -Math.PI, maxX: Math.PI, minY: -2, maxY: 2 };

  const view = getViewIndex(key, worldBBox, (addCell) => {
    for (const cell of world.cells) {
      const i4 = cell.id * 4;
      addCell(cell.id, {
        minX: bboxes[i4],
        maxX: bboxes[i4 + 1],
        minY: bboxes[i4 + 2],
        maxY: bboxes[i4 + 3],
      });
    }
  });

  cache = { key, polys, polarOutlines, centers, bboxes, worldBBox, view };
  return cache;
}

export function invalidateProjCache(): void {
  cache = null;
}
