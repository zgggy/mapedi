import type { Cell, World, LayerDef, ClimateParams, LayerRenderConfig, LonLat } from './types';
import { normalizeStyle } from './layer/style';
import { generateVoronoiCells } from './voronoi';
import { bumpGeomRev } from './rev';
import { defaultClimate } from './types';
import { migrateToPathFeature } from './paths';
import { getCellGrid, invalidateCellGrid } from './index/cellGrid';

export const DEFAULT_DENSITY = 100000;
/** 硬上限：生成链唯一钳制点（store.generate）；UI 输入框 max 与此一致 */
export const HARD_MAX_DENSITY = 200000;

export function builtinLayers(): LayerDef[] {
  return [
    {
      id: 'cells',
      name: '地块',
      kind: 'custom',
      modeDefault: 'view',
      baseMesh: true,
      cellMarker: 'none',
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
  // **新世界 = 新几何**：几何域缓存（pairEdgeCache/环缓存…）按 geomRev 失效，
  // 建世界必须记几何账，否则跨世界沿用旧边表（0 环/错环）。
  bumpGeomRev();
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
      // cellMarker 'id' 是旧的调试默认值（无 UI 入口），同步回默认
      if (cur.cellMarker !== b.cellMarker && b.cellMarker === 'none' && !cur.id.startsWith('custom-')) {
        cur.cellMarker = 'none';
        changed = true;
      }
    }
  }
  if (!world.paths) world.paths = [];
  void changed;
  return world;
}

import { lonlatKey, lonlatNumKey } from './ring/build';

/**
 * 全局顶点归一：同一 0.001° 格只保留一个 LonLat，**改写 cell.polygon**。
 * 相邻 cell 共享角点必须是同一坐标，否则 sharedEdges/链化接错。
 */
export function canonicalizeCellPolygons(world: World): void {
  const rep = new Map<number, LonLat>();
  const snap = (ll: LonLat): LonLat => {
    const k = lonlatNumKey(ll);
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
 * 从 cells 多边形重建 sharedEdges（缺档兜底）。
 * 先 canonicalize，再按 lonlatKey 求交；**禁止**近邻糊焊造边。
 * 端点与 polygon **同一 LonLat 引用**；短边塌缩（仅 1 个共点）不建边。
 */
export function rebuildSharedEdgesFromCells(world: World): Map<string, [LonLat, LonLat]> {
  // 幂等归一；与 rebuildNeighbors 同一套 lonlatKey
  canonicalizeCellPolygons(world);
  const out = new Map<string, [LonLat, LonLat]>();
  for (const c of world.cells) {
    if (!c?.polygon?.length) continue;
    const ptByKey = new Map<number, LonLat>();
    for (const p of c.polygon) {
      const k = lonlatNumKey(p);
      if (!ptByKey.has(k)) ptByKey.set(k, p);
    }
    for (const n of c.neighbors) {
      if (n <= c.id) continue;
      const nc = world.cells[n];
      if (!nc?.polygon?.length) continue;
      // 共享边两端 = 邻格多边形中落在本格的前两个**相异**角点（命中 2 个即早停）；
      // 塌成一点或对不上 → 无边（禁止 0.05° 糊焊）
      let p0: LonLat | null = null;
      let p1: LonLat | null = null;
      let k0 = NaN;
      let k1 = NaN;
      for (const p of nc.polygon) {
        const k = lonlatNumKey(p);
        if (k === k0 || k === k1) continue;
        const hit = ptByKey.get(k);
        if (!hit) continue;
        if (!p0) {
          p0 = hit;
          k0 = k;
        } else {
          p1 = hit;
          k1 = k;
          break;
        }
      }
      if (!p0 || !p1) continue;
      out.set(edgeKey(c.id, n), [p0, p1]);
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
    // cellClimate / biome 不落盘（还债步骤 4）：真缓存=读方 ensureClimate/ensureBiome 按当前地形重算
    astro: world.astro,
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
    astro?: World['astro'];
    layerRenderConfig?: [string, unknown][];
    sharedEdges?: [string, [LonLat, LonLat]][];
  };
  if (!raw.meta || !Array.isArray(raw.cells) || !Array.isArray(raw.regions) || !Array.isArray(raw.layers)) {
    throw new Error('项目文件缺少必要的世界数据');
  }
  const version = raw.meta.formatVersion ?? 1;
  if (version < 1 || version > 2) throw new Error(`不支持的项目版本：${version}`);
  // 结构断言（2026-10-01 还债步骤 3）：坏档必须**明确报错、不进渲染**（throw →
  // tryRestore/runWorker 捕获 → 启动错误条；旧档不被覆盖——autosave 只写成功序列化的结果）。
  {
    const n = raw.cells.length;
    for (let i = 0; i < n; i++) {
      const c = raw.cells[i];
      if (!c || c.id !== i) {
        throw new Error(
          `存档损坏：cell.id 连续性被破坏（位置 ${i}${c ? `，id=${String(c.id)}` : '，cell 缺失'}）`,
        );
      }
      if (!Array.isArray(c.polygon) || c.polygon.length < 3) {
        throw new Error(`存档损坏：cell#${i} polygon 顶点数 < 3`);
      }
      if (Array.isArray(c.neighbors)) {
        for (const x of c.neighbors) {
          if (!Number.isInteger(x) || x < 0 || x >= n) {
            throw new Error(`存档损坏：cell#${i} 邻居越界（${String(x)}，共 ${n} 格）`);
          }
        }
      }
    }
    for (const r of raw.regions) {
      if (!Array.isArray(r.cells)) throw new Error(`存档损坏：元素 ${String(r.id)} 缺少 cells 数组`);
      for (const cid of r.cells) {
        if (!Number.isInteger(cid) || cid < 0 || cid >= n) {
          throw new Error(`存档损坏：元素 ${String(r.id)} 引用越界 cell ${String(cid)}`);
        }
      }
    }
  }
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
    astro: raw.astro,
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
  // 反序列化 = 新几何域（同 createWorld）
  bumpGeomRev();
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
