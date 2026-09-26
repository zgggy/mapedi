import type { Cell, World, LayerDef, ClimateParams, BiomeId, CellClimate, LayerRenderConfig, LonLat } from './types';
import { normalizeStyle } from './layer/style';
import { generateVoronoiCells } from './voronoi';
import { defaultClimate } from './types';
import { migrateToPathFeature } from './paths';
import { getCellGrid, invalidateCellGrid } from './index/cellGrid';

export const DEFAULT_DENSITY = 30000;
export const SOFT_MAX_DENSITY = 100000;

export function builtinLayers(): LayerDef[] {
  return [
    {
      id: 'cells',
      name: '地块',
      kind: 'custom',
      modeDefault: 'view',
      baseMesh: true,
      cellMarker: 'id',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'height',
      name: '高度',
      kind: 'height',
      modeDefault: 'edit',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'landsea',
      name: '海陆',
      kind: 'environment',
      modeDefault: 'edit',
      allowOverlap: false,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'environment',
      name: '环境',
      kind: 'environment',
      modeDefault: 'view',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'vegetation',
      name: '植物',
      kind: 'vegetation',
      modeDefault: 'view',
      cellSymbol: 'tree',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'fauna',
      name: '动物',
      kind: 'fauna',
      modeDefault: 'view',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'race',
      name: '种族',
      kind: 'race',
      modeDefault: 'view',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'culture',
      name: '文化',
      kind: 'cultural',
      modeDefault: 'view',
      coreSymbol: 'circle',
      labelMode: 'name',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: true,
      centerLabel: '文化中心',
      styleSetId: 'default',
    },
    {
      id: 'religion',
      name: '宗教',
      kind: 'religious',
      modeDefault: 'view',
      coreSymbol: 'circle',
      labelMode: 'name',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: true,
      centerLabel: '圣城',
      styleSetId: 'default',
    },
    {
      id: 'country',
      name: '国家',
      kind: 'political',
      modeDefault: 'view',
      coreSymbol: 'star',
      labelMode: 'name',
      allowOverlap: false,
      requireAdjacency: true,
      requireCenter: true,
      centerLabel: '首都',
      styleSetId: 'default',
    },
    {
      id: 'province',
      name: '行省',
      kind: 'political',
      modeDefault: 'view',
      coreSymbol: 'square',
      labelMode: 'name',
      parentLayerId: 'country',
      allowOverlap: false,
      requireAdjacency: true,
      requireCenter: true,
      centerLabel: '省会',
      styleSetId: 'default',
    },
    {
      id: 'road',
      name: '道路',
      kind: 'road',
      modeDefault: 'view',
      allowOverlap: false,
      requireAdjacency: true,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'route',
      name: '航线',
      kind: 'route',
      modeDefault: 'view',
      allowOverlap: false,
      requireAdjacency: true,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'river',
      name: '河流',
      kind: 'river',
      modeDefault: 'view',
      allowOverlap: false,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'military',
      name: '军队',
      kind: 'military',
      modeDefault: 'view',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    },
  ];
}

export function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** 连通域算法唯一实现：core/index/cellGraph.ts landContinentsCSR */

export function createWorld(
  opts: { seed: number; count?: number },
  onProgress?: (label: string, frac: number) => void,
): World {
  const count = opts.count ?? DEFAULT_DENSITY;
  onProgress?.('撒点 / Voronoi', 0.02);
  // 拓扑单源：faces → neighbors + sharedEdges + polygon 同源
  const { cells, sharedEdges } = generateVoronoiCells(
    { seed: opts.seed, count, lloydIterations: 1 },
    onProgress,
  );
  for (const c of cells) {
    c.isOcean = true;
    c.height = 0;
  }
  onProgress?.('地块就绪', 1);
  return {
    meta: {
      seed: opts.seed,
      cellCount: cells.length,
      formatVersion: 2,
      createdAt: Date.now(),
    },
    cells,
    rivers: new Map(),
    layers: builtinLayers(),
    regions: [],
    climate: defaultClimate(),
    sharedEdges,
  };
}

/** 旧存档可能缺 river 等层：反序列化后合并内置层（保留用户自定义与父子关系） */
export function ensureBuiltinLayers(world: World): World {
  const builtins = builtinLayers();
  const have = new Map(world.layers.map((l) => [l.id, l]));
  let changed = false;
  for (const b of builtins) {
    if (!have.has(b.id)) {
      world.layers.push({ ...b });
      changed = true;
    } else {
      const cur = have.get(b.id)!;
      // 修复缺失/错误的内置元数据（如 river 曾从 layers 里消失）
      if (cur.kind !== b.kind && !cur.id.startsWith('custom-')) {
        cur.kind = b.kind;
        changed = true;
      }
    }
  }
  if (!world.paths) world.paths = [];
  void changed;
  return world;
}

import { lonlatKey } from './ring/build';

/**
 * 全局顶点归一：同一 0.001° 格只保留一个 LonLat，**改写 cell.polygon**。
 * 相邻 cell 共享角点必须是同一坐标，否则 sharedEdges/链化接错。
 */
export function canonicalizeCellPolygons(world: World): void {
  const rep = new Map<string, LonLat>();
  const snap = (ll: LonLat): LonLat => {
    const k = lonlatKey(ll);
    const hit = rep.get(k);
    if (hit) return hit;
    const copy = { lon: ll.lon, lat: ll.lat };
    rep.set(k, copy);
    return copy;
  };
  for (const c of world.cells) {
    if (!c?.polygon?.length) continue;
    c.polygon = c.polygon.map(snap);
    c.center = snap(c.center);
  }
}

/**
 * 邻接 = **共享一条边（≥2 个角点）**。
 * 只共一个角点不算；kNN 假邻居一律丢弃。
 */
export function rebuildNeighborsFromSharedVerts(world: World): void {
  const vertOwner = new Map<string, number[]>();
  for (const c of world.cells) {
    if (!c?.polygon?.length) continue;
    const seen = new Set<string>();
    for (const p of c.polygon) {
      const k = lonlatKey(p);
      if (seen.has(k)) continue;
      seen.add(k);
      let a = vertOwner.get(k);
      if (!a) {
        a = [];
        vertOwner.set(k, a);
      }
      a.push(c.id);
    }
  }
  const pairHits = new Map<string, number>();
  const pairIds = new Map<string, [number, number]>();
  for (const owners of vertOwner.values()) {
    for (let i = 0; i < owners.length; i++) {
      for (let j = i + 1; j < owners.length; j++) {
        const a = Math.min(owners[i], owners[j]);
        const b = Math.max(owners[i], owners[j]);
        const ek = `${a}-${b}`;
        pairHits.set(ek, (pairHits.get(ek) ?? 0) + 1);
        pairIds.set(ek, [a, b]);
      }
    }
  }
  const adj = new Map<number, Set<number>>();
  for (const [ek, hits] of pairHits) {
    if (hits < 2) continue;
    const [a, b] = pairIds.get(ek)!;
    let sa = adj.get(a);
    if (!sa) {
      sa = new Set();
      adj.set(a, sa);
    }
    sa.add(b);
    let sb = adj.get(b);
    if (!sb) {
      sb = new Set();
      adj.set(b, sb);
    }
    sb.add(a);
  }
  for (const c of world.cells) {
    const s = adj.get(c.id);
    c.neighbors = s ? [...s] : [];
  }
}

/**
 * 从 cells 多边形重建 sharedEdges（缺档兜底）。
 * 先 canonicalize，再按 lonlatKey 求交；**禁止**近邻糊焊造边。
 * 端点与 polygon **同一 LonLat 引用**；短边塌缩（仅 1 个共点）不建边。
 */
export function rebuildSharedEdgesFromCells(world: World): Map<string, [LonLat, LonLat]> {
  // 幂等归一；与 rebuildNeighbors 同一套 lonlatKey
  canonicalizeCellPolygons(world);
  const out = new Map<string, [LonLat, LonLat]>();
  const qkey = lonlatKey;
  for (const c of world.cells) {
    if (!c?.polygon?.length) continue;
    const ptByKey = new Map<string, LonLat>();
    for (const p of c.polygon) {
      const k = qkey(p);
      if (!ptByKey.has(k)) ptByKey.set(k, p);
    }
    for (const n of c.neighbors) {
      if (n <= c.id) continue;
      const nc = world.cells[n];
      if (!nc?.polygon?.length) continue;
      const shared: LonLat[] = [];
      const seen = new Set<string>();
      for (const p of nc.polygon) {
        const k = qkey(p);
        if (seen.has(k)) continue;
        const hit = ptByKey.get(k);
        if (!hit) continue;
        seen.add(k);
        shared.push(hit);
      }
      // 共享边两端；塌成一点或对不上 → 无边（禁止 0.05° 糊焊）
      if (shared.length < 2) continue;
      const ek = c.id < n ? `${c.id}-${n}` : `${n}-${c.id}`;
      out.set(ek, [shared[0], shared[1]]);
    }
  }
  return out;
}

export function serializeWorld(
  world: World,
  opts?: { stripSharedEdges?: boolean },
): string {
  const strip = opts?.stripSharedEdges ?? false;
  return JSON.stringify({
    meta: { ...world.meta, formatVersion: 2 },
    cells: world.cells,
    rivers: [...world.rivers.entries()],
    layers: world.layers,
    regions: world.regions.map((r) => ({
      ...r,
      weights: r.weights ? [...r.weights.entries()] : undefined,
      endpointOverrides: r.endpointOverrides
        ? [...r.endpointOverrides.entries()]
        : undefined,
      adjacentElementIds: r.adjacentElementIds
        ? [...r.adjacentElementIds]
        : undefined,
    })),
    paths: world.paths ?? [],
    climate: world.climate,
    cellClimate: world.cellClimate ? [...world.cellClimate.entries()] : undefined,
    astro: world.astro,
    biome: world.biome ? [...world.biome.entries()] : undefined,
    layerRenderConfig: world.layerRenderConfig ? [...world.layerRenderConfig.entries()] : undefined,
    sharedEdges:
      !strip && world.sharedEdges ? [...world.sharedEdges.entries()] : undefined,
  });
}

export function deserializeWorld(json: string): World {
  const raw = JSON.parse(json) as {
    meta: World['meta'];
    cells: Cell[];
    rivers: [string, World['rivers'] extends Map<string, infer V> ? V : never][];
    layers: LayerDef[];
    regions: (Omit<World['regions'][number], 'weights' | 'endpointOverrides' | 'adjacentElementIds'> & {
      weights?: [number, number][];
      endpointOverrides?: [number, { lon: number; lat: number }][];
      adjacentElementIds?: string[];
    })[];
    paths?: unknown[];
    climate?: ClimateParams;
    cellClimate?: [number, CellClimate][];
    astro?: World['astro'];
    biome?: [number, BiomeId][];
    layerRenderConfig?: [string, unknown][];
    sharedEdges?: [string, [LonLat, LonLat]][];
  };
  if (!raw.meta || !Array.isArray(raw.cells) || !Array.isArray(raw.regions) || !Array.isArray(raw.layers)) {
    throw new Error('项目文件缺少必要的世界数据');
  }
  const version = raw.meta.formatVersion ?? 1;
  if (version < 1 || version > 2) throw new Error(`不支持的项目版本：${version}`);
  const paths = (raw.paths ?? []).map((p) => migrateToPathFeature(p as Record<string, unknown>));
  const world: World = {
    meta: { ...raw.meta, formatVersion: 2 },
    cells: raw.cells,
    rivers: new Map(raw.rivers),
    layers: raw.layers,
    regions: raw.regions.map((r) => ({
      ...r,
      weights: r.weights ? new Map(r.weights) : undefined,
      endpointOverrides: r.endpointOverrides
        ? new Map(r.endpointOverrides)
        : undefined,
      adjacentElementIds: r.adjacentElementIds
        ? new Set(r.adjacentElementIds)
        : undefined,
    })),
    paths,
    climate: raw.climate ?? defaultClimate(),
    cellClimate: raw.cellClimate ? new Map(raw.cellClimate) : undefined,
    astro: raw.astro,
    biome: raw.biome ? new Map(raw.biome) : undefined,
    layerRenderConfig: (() => {
      const src = raw.layerRenderConfig;
      if (!src) return undefined;
      const m = new Map<string, LayerRenderConfig>();
      for (const [id, v] of src) m.set(id, normalizeStyle(v));
      return m;
    })(),
    sharedEdges: raw.sharedEdges ? new Map(raw.sharedEdges) : undefined,
  };
  // neighbors 随 Cell 序列化保存，**禁止**用几何键反推覆盖
  if (!world.sharedEdges?.size && world.cells?.length) {
    world.sharedEdges = rebuildSharedEdgesFromCells(world);
  }
  return ensureBuiltinLayers(world);
}

/** 粗拾取：最近中心（大图走 CellGrid）；经度差按球面 wrap */
export function pickCell(world: World, lon: number, lat: number): Cell | null {
  const n = world.cells.length;
  if (n > 800) {
    return getCellGrid(world).nearest(world, lon, lat);
  }
  let best: Cell | null = null;
  let bestD = Infinity;
  for (const c of world.cells) {
    if (!c.polygon.length) continue;
    let dlon = c.center.lon - lon;
    while (dlon > 180) dlon -= 360;
    while (dlon < -180) dlon += 360;
    const d = dlon * dlon + (c.center.lat - lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

export function invalidatePickCache(): void {
  invalidateCellGrid();
}
