import type { Cell, World, LayerDef, ClimateParams, LayerRenderConfig, LonLat } from './types';
import { normalizeStyle } from './layer/style';
import { generateVoronoiCells } from './voronoi';
import { bumpGeomRev } from './rev';
import { repairHierarchy } from './hierarchy/gate';
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
      labelTier: 'minor',
      name: '地块',
      kind: 'custom',
      modeDefault: 'view',
      baseMesh: true,
      genStrategy: 'scatter',
      cellMarker: 'none',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'height',
      // 注记档位显式指定（R6：顶层≠一律国家级；深度推导只作自定义层兜底）
      labelTier: 'tertiary',
      name: '高度',
      kind: 'height',
      modeDefault: 'edit',
      genStrategy: 'heightmap',
      focusAfterGen: true,
      editsHeight: true,
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
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
      // 空心星 ☆ = 其他首府（省会）——CIA 图例实测；实心星 ★ 留给国家首都
      coreSymbol: 'hollowStar',
      labelMode: 'name',
      parentLayerId: 'country',
      allowOverlap: false,
      requireAdjacency: true,
      requireCenter: true,
      centerLabel: '省会',
      styleSetId: 'default',
    },
    {
      id: 'ecosystem',
      // 注记档位显式指定（R6：顶层≠一律国家级；深度推导只作自定义层兜底）
      labelTier: 'tertiary',
      name: '生态',
      kind: 'ecosystem',
      modeDefault: 'view',
      // 树点装饰从原「植物」层平移过来（生态=植被+动物+环境的合并层）
      cellSymbol: 'tree',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    },
    {
      id: 'race',
      // 注记档位显式指定（R6：顶层≠一律国家级；深度推导只作自定义层兜底）
      labelTier: 'minor',
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
      // 注记档位显式指定（R6：顶层≠一律国家级；深度推导只作自定义层兜底）
      labelTier: 'tertiary',
      name: '文化',
      kind: 'cultural',
      modeDefault: 'view',
      // ⊙ 同心圆 = 中心/圣城（OSM 首都样式；原 circle 与一般城市撞形，2026-10-04 包3 改）
      coreSymbol: 'ring',
      labelMode: 'name',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: true,
      centerLabel: '文化中心',
      styleSetId: 'default',
    },
    {
      id: 'road',
      // 注记档位显式指定（R6：顶层≠一律国家级；深度推导只作自定义层兜底）
      labelTier: 'minor',
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
      // 注记档位显式指定（R6：顶层≠一律国家级；深度推导只作自定义层兜底）
      labelTier: 'minor',
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
      // 注记档位显式指定（R6：顶层≠一律国家级；深度推导只作自定义层兜底）
      labelTier: 'minor',
      name: '河流',
      kind: 'river',
      modeDefault: 'view',
      allowOverlap: false,
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
  // 海陆案 A（2026-10-03 拍板执行）：产品级删除 landsea——旧档在唯一读入口
  // 一次性清理层定义与海陆派生实体（含历史上寄居 height 层的 kind 派生物；
  // 高度区间元素 kind='interval' 不在清理集）。
  const landSeaAttr = (r: { attributes?: Record<string, unknown> }) => {
    const k = r.attributes?.kind;
    return k === 'lake' || k === 'ocean' || k === 'continent';
  };
  if (have.has('landsea')) {
    world.layers = world.layers.filter((l) => l.id !== 'landsea');
    changed = true;
  }
  // 2026-10-04 图层重构（用户授权重生成）：环境/植物/动物 → 合并为「生态」；宗教/军队删除。
  // 与海陆案 A 同一入口策略：**唯一读入口清层 + 清其元素**（旧档里这5层的 regions 一并移除）。
  const RETIRED_LAYERS = ['environment', 'vegetation', 'fauna', 'religion', 'military'];
  if (world.layers.some((l) => RETIRED_LAYERS.includes(l.id))) {
    world.layers = world.layers.filter((l) => !RETIRED_LAYERS.includes(l.id));
    world.regions = world.regions.filter((r) => !RETIRED_LAYERS.includes(r.layerId));
    changed = true;
  }
  const cleaned = world.regions.filter(
    (r) => r.layerId !== 'landsea' && !(r.layerId === 'height' && landSeaAttr(r)),
  );
  if (cleaned.length !== world.regions.length) {
    world.regions = cleaned;
    changed = true;
  }
  // 内置层在数组中的目标序号（builtinLayers() 的声明序 = 叠放序：数组靠前先画 = 底，
  // 2026-10-06 用户定序：地块→高度→国家→行省→其他→非地块依赖；列表自上而下 = 低→高）
  const builtinIdx = new Map(builtins.map((b, i) => [b.id, i]));
  for (const b of builtins) {
    if (!have.has(b.id)) {
      // **按内置序插入而非 push**：push 到末尾会把新层叠到政区之上（生态盖住国家名/边界）
      const want = builtinIdx.get(b.id) ?? 0;
      let at = world.layers.length;
      for (let i = world.layers.length - 1; i >= 0; i--) {
        const p = builtinIdx.get(world.layers[i].id);
        if (p !== undefined && p < want) {
          at = i + 1;
          break;
        }
      }
      world.layers.splice(at, 0, { ...b });
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
      // coreSymbol 同样无 UI 入口（配置面归包5）→ 符号族升级（包3：☆省会 / ⊙中心）同步到旧档
      if (cur.coreSymbol !== b.coreSymbol && !cur.id.startsWith('custom-')) {
        cur.coreSymbol = b.coreSymbol;
        changed = true;
      }
      // labelTier 无 UI 入口（包2 新增）→ 旧档 undefined 回填内置档位
      if (b.labelTier !== undefined && cur.labelTier !== b.labelTier && !cur.id.startsWith('custom-')) {
        cur.labelTier = b.labelTier;
        changed = true;
      }
      // 层身份标志位（genStrategy/focusAfterGen/editsHeight/baseMesh）：旧档缺字段 → 回填内置声明。
      // 无 UI 入口可改，强制与内置一致（与 kind 同策略）。
      if (b.baseMesh !== undefined && cur.baseMesh !== b.baseMesh) { cur.baseMesh = b.baseMesh; changed = true; }
      if (b.genStrategy !== undefined && cur.genStrategy !== b.genStrategy) { cur.genStrategy = b.genStrategy; changed = true; }
      if (b.focusAfterGen !== undefined && cur.focusAfterGen !== b.focusAfterGen) { cur.focusAfterGen = b.focusAfterGen; changed = true; }
      if (b.editsHeight !== undefined && cur.editsHeight !== b.editsHeight) { cur.editsHeight = b.editsHeight; changed = true; }
    }
  }
  // 内置层**相对顺序**自愈（叠放契约：数组序 = 后画在上 = builtinLayers() 声明序）：
  // 旧档曾因「缺层 push 到末尾」把生态层存到政区之上 → 重排内置槽位（custom 层原位不动，
  // 不破坏用户组织过的自定义层兄弟序）。
  {
    const built = world.layers.filter((l) => builtinIdx.has(l.id));
    const sorted = [...built].sort(
      (a, b) => (builtinIdx.get(a.id) ?? 0) - (builtinIdx.get(b.id) ?? 0),
    );
    if (built.some((l, i) => l !== sorted[i])) {
      let k = 0;
      world.layers = world.layers.map((l) => (builtinIdx.has(l.id) ? sorted[k++] : l));
      changed = true;
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
    // 用户自定义地块标记（包5）：显式白名单字段（serializeWorld 是逐字段白名单，不是展开）
    cellMarks: world.cellMarks?.length ? world.cellMarks : undefined,
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
    cellMarks?: { cellId: number; symbol: 'star' | 'circle' | 'diamond'; color?: string }[];
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
    // 悬空过滤（坏数据不进渲染）：撒点重生后 cellId 全变 → 标记失效即丢
    cellMarks: raw.cellMarks?.filter(
      (m) => m && Number.isInteger(m.cellId) && m.cellId >= 0 && m.cellId < raw.cells.length,
    ),
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
  const withBuiltins = ensureBuiltinLayers(world);
  // 层级读档修复（HIERARCHY S8，2026-10-03 包1）：悬空/环/一父二子/桥违例
  // → 确定性修复 + console.warn 报告（不动 cells / 邻接 / 数组序）
  const rep = repairHierarchy(withBuiltins);
  if (rep.fixed) {
    console.warn(`[hierarchy] 读档修复 ${rep.fixed} 处：`, rep.notes.join('；'));
  }
  return withBuiltins;
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
