import { PROJ_WRAP_EPS, KEY_QUANT } from '../core/tolerances';
import type { LonLat, World } from '../core/types';
import {
  project,
  projectionPeriodAt,
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

/** 显示用顶点键：**千分之一度网格（= KEY_QUANT 单源，2026-10-04 拍板统一）+ ±180 缝
 * （合并浮点微差，角点必须同一 id）；缝吸附与环键同值（PROJ_WRAP_EPS=WRAP_EPS）。 */
function vertKey(ll: LonLat): string {
  let lon = ll.lon;
  while (lon > 180) lon -= 360;
  while (lon < -180) lon += 360;
  if (Math.abs(lon) >= 180 - PROJ_WRAP_EPS) lon = 180;
  return `${Math.round(lon * KEY_QUANT)},${Math.round(ll.lat * KEY_QUANT)}`;
}

type Vert = { x: number; y: number };

/**
 * 问题：同一角点在不同 cell 里投影/unwrap 不一致 → 顶点对不上、真缝。
 * 原理：
 * 1) **合并顶点表**（千分之一度=KEY_QUANT）→ 同一角点同一 (x,y)
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
  cache = buildProjCache(world, proj, pp);
  return cache;
}

/** Worker 预建结果落盘（同 key 才接受；转移对象免主线程 O(N) 首建） */
export function installProjCache(next: ProjCache): void {
  if (cache && cache.key === next.key) return;
  cache = next;
}

/** 纯构建（生成/加载 Worker 与同步回退共用同一实现） */
export function buildProjCache(
  world: World,
  proj: ProjectionId,
  pp: ProjectionParams,
): ProjCache {
  const key = cacheKey(world, proj, pp);
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
  // 局部周期（伪圆柱 scale(y)·2π）：跨缝顶点在 y 处按真实周期 unwrap——
  // 常数 2π 对罗宾森会把缝点错移 +0.95（cell 多边形撕裂、填充乱的根因）。
  const periodAt = (y: number) => projectionPeriodAt(proj, y) ?? Math.PI * 2;
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
      xs[i] = unwrapXAgainst(xs[i - 1], xs[i], periodAt(ys[i]));
    }
    // 整格对齐到中心所在 2π 副，跨日界线邻接仍共用表顶点
    const cx = wrapPeriod(c.x, periodAt(c.y));
    let midX = 0;
    for (const x of xs) midX += x;
    midX /= xs.length;
    // 整数窗对齐：per-vertex 的 k·periodAt(y)（伪圆柱周期随 y 变；常数时退化整块平移）
    const kShift = Math.round((cx - midX) / periodAt(c.y));
    if (kShift !== 0) {
      for (let i = 0; i < xs.length; i++) xs[i] += -kShift * periodAt(ys[i]);
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
      const seamX = unwrapXAgainst(xs[xs.length - 1], xs[0], periodAt(ys[0]));
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

  const result: ProjCache = { key, polys, polarOutlines, centers, bboxes, worldBBox, view };
  return result;
}

export function invalidateProjCache(): void {
  cache = null;
}
