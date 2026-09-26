import type { Cell, LonLat } from './types';
import { createRng } from './rng';
import {
  blueNoiseSphere,
  createVertexSnap,
  sphericalArea,
  sphericalVoronoi,
  vec3ToLonLat,
  Vec3Grid,
  weldVertices,
  type Vec3,
} from './voronoiSphere';

export { createVertexSnap, weldVertices };

export interface VoronoiOptions {
  seed: number;
  count: number;
  lloydIterations?: number;
}

const poleOwners = new WeakMap<Cell[], { north: number; south: number }>();

/** 极点处的 Voronoi 归属是该方向点积最大的站点，不要求站点恰好位于极点。 */
export function polarCellIds(cells: Cell[]): { north: number; south: number } {
  const cached = poleOwners.get(cells);
  if (cached) return cached;
  let north = -1;
  let south = -1;
  let maxLat = -Infinity;
  let minLat = Infinity;
  for (const cell of cells) {
    if (cell.center.lat > maxLat) {
      maxLat = cell.center.lat;
      north = cell.id;
    }
    if (cell.center.lat < minLat) {
      minLat = cell.center.lat;
      south = cell.id;
    }
  }
  const owners = { north, south };
  poleOwners.set(cells, owners);
  return owners;
}

function vKey(v: Vec3): string {
  // 与 weldVertices 同量级，避免「已焊接但链键仍分裂」
  return `${Math.round(v[0] * 1e6)},${Math.round(v[1] * 1e6)},${Math.round(v[2] * 1e6)}`;
}

/** 由共享 Voronoi 顶点重建邻接（备用；主路径用全局 Delaunay 邻接） */
export function neighborsFromSharedVerts(polys: Vec3[][], sites: Vec3[], n: number): number[][] {
  const vertexSites = new Map<string, number[]>();
  polys.forEach((poly, i) => {
    for (const v of poly) {
      const k = vKey(v);
      let a = vertexSites.get(k);
      if (!a) {
        a = [];
        vertexSites.set(k, a);
      }
      if (!a.includes(i)) a.push(i);
    }
  });

  const edgeCount = new Map<string, number>();
  for (const list of vertexSites.values()) {
    if (list.length < 2 || list.length > 8) continue;
    for (let a = 0; a < list.length; a++) {
      for (let b = a + 1; b < list.length; b++) {
        const i = list[a];
        const j = list[b];
        const key = i < j ? `${i}:${j}` : `${j}:${i}`;
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
      }
    }
  }

  const adj: number[][] = Array.from({ length: n }, () => []);
  const maxCos = Math.cos((3.5 * Math.sqrt(4 * Math.PI)) / Math.sqrt(n));
  for (const [key, c] of edgeCount) {
    if (c < 2) continue;
    const [si, sj] = key.split(':');
    const i = +si;
    const j = +sj;
    const d =
      sites[i][0] * sites[j][0] + sites[i][1] * sites[j][1] + sites[i][2] * sites[j][2];
    if (d <= maxCos) continue;
    if (!adj[i].includes(j)) adj[i].push(j);
    if (!adj[j].includes(i)) adj[j].push(i);
  }

  // 网格 kNN 补齐稀疏点（O(n·k)）
  const grid = new Vec3Grid(sites, 12);
  for (let i = 0; i < n; i++) {
    if (adj[i].length >= 5) continue;
    const nb = grid.neighbors(i, 8);
    for (const j of nb) {
      if (!adj[i].includes(j)) adj[i].push(j);
      if (!adj[j].includes(i)) adj[j].push(i);
    }
  }
  return adj;
}

/**
 * 球面 Voronoi：撒点 + **凸包球面 Delaunay** → 胞腔。
 * 拓扑单源：neighbors / sharedEdges 只来自 faces；
 * polygon 与 sharedEdges 端点 **同一 LonLat 引用**（经全局顶点表 snap）。
 */
export function generateVoronoiCells(
  opts: VoronoiOptions,
  onProgress?: (label: string, frac: number) => void,
): {
  cells: Cell[];
  sites: LonLat[];
  sharedEdges: Map<string, [LonLat, LonLat]>;
} {
  const n = Math.max(16, opts.count | 0);
  const rng = createRng(opts.seed);
  void opts.lloydIterations;
  const pts = blueNoiseSphere(n, rng, 0.8);
  onProgress?.('球面 Voronoi', 0.05);
  const { polys, neighbors, sharedEdges: rawShared } = sphericalVoronoi(
    pts,
    18,
    (done, total) => onProgress?.('球面 Voronoi', 0.05 + 0.55 * (done / Math.max(1, total))),
  );
  onProgress?.('写入经纬度', 0.7);

  // LonLat 级顶点表：同一 Vec3 代表 → 同一 LonLat 引用
  const lonOf = new Map<Vec3, LonLat>();
  const lonlat = (v: Vec3): LonLat => {
    const hit = lonOf.get(v);
    if (hit) return hit;
    const ll = vec3ToLonLat(v);
    lonOf.set(v, ll);
    return ll;
  };
  const shared = new Map<string, [LonLat, LonLat]>();
  for (const [k, e] of rawShared) {
    if (e.a === e.b) continue;
    shared.set(k, [lonlat(e.a), lonlat(e.b)]);
  }

  const cells: Cell[] = [];
  const sites: LonLat[] = [];
  for (let i = 0; i < pts.length; i++) {
    sites.push(lonlat(pts[i]));
    const poly = polys[i] ?? [];
    cells.push({
      id: i,
      polygon: poly.map(lonlat),
      center: sites[i],
      neighbors: neighbors[i] ?? [],
      isOcean: true,
      height: 0,
      area: sphericalArea(poly),
    });
  }
  onProgress?.('地块就绪', 0.78);
  return { cells, sites, sharedEdges: shared };
}
