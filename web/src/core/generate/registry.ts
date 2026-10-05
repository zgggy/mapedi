import type { LayerId, World } from '../types';
import { genConfigFromParams } from '../layer';
import { unifiedGenerate } from './unified';
import { generateRivers } from '../rivers';
import { generateRoads, generateRoutes } from './networks';
import type { BiomeId, CellClimate, CellId } from '../types';
import { childLayerIdOf } from '../hierarchy/derive';

export interface GenContext {
  world: World;
  seed: number;
  params: Record<string, number | string | boolean>;
  fields?: {
    biome?: Map<CellId, BiomeId>;
    climate?: Map<CellId, CellClimate>;
  };
  /** 细粒度进度回调 */
  onProgress?: (label: string, frac: number) => void;
}

export interface LayerGenerator {
  layerId: LayerId;
  dependsOn: LayerId[];
  defaultParams: Record<string, number | string | boolean>;
  generate(ctx: GenContext): void;
}

/** 统一区域生成器工厂：所有语义层共用 unifiedGenerate */
function makeUnifiedGen(layerId: LayerId, dependsOn: LayerId[]): LayerGenerator {
  return {
    layerId,
    dependsOn,
    defaultParams: {},
    generate(ctx) {
      const config = genConfigFromParams(layerId, ctx.seed, ctx.params);
      unifiedGenerate(ctx.world, layerId, config);
    },
  };
}

const heightGen: LayerGenerator = makeUnifiedGen('height', []);
const provinceGen: LayerGenerator = makeUnifiedGen('province', ['height']);
// country 的单元源（province）由**层树**表达（unit 边，cascadeOrder 内派生）——
// dependsOn 只留真数据依赖（HIERARCHY §6.3 包3，原 ['province'] 移除）
const countryGen: LayerGenerator = makeUnifiedGen('country', []);
const ecosystemGen: LayerGenerator = makeUnifiedGen('ecosystem', ['height']);
const raceGen: LayerGenerator = makeUnifiedGen('race', ['height']);
const cultureGen: LayerGenerator = makeUnifiedGen('culture', ['height']);

function num(p: GenContext['params'], k: string, d: number): number {
  const v = p[k];
  return typeof v === 'number' ? v : d;
}

/** 河网（路径层，非 Region） */
const riversGen: LayerGenerator = {
  layerId: 'river',
  dependsOn: ['height'],
  defaultParams: {},
  generate(ctx) {
    const threshold = num(ctx.params, 'threshold', Math.max(4, Math.floor(ctx.world.cells.length / 400)));
    generateRivers(ctx.world, threshold);
  },
};

const roadGen: LayerGenerator = {
  layerId: 'road',
  dependsOn: ['country'],
  defaultParams: { k: 3, slopeCost: 2, forestCost: 1.2 },
  generate(ctx) {
    generateRoads(
      ctx.world,
      ctx.seed,
      num(ctx.params, 'k', 3),
      num(ctx.params, 'slopeCost', 2),
      num(ctx.params, 'forestCost', 1.2),
    );
  },
};

const routeGen: LayerGenerator = {
  layerId: 'route',
  dependsOn: ['country'],
  defaultParams: { maxPorts: 8 },
  generate(ctx) {
    generateRoutes(ctx.world, ctx.seed, num(ctx.params, 'maxPorts', 8));
  },
};

/**
 * 生成器注册序 = **平手基准**（原 CASCADE_ORDER 数组已删，包3 单源）。
 * 实际生成序由 `cascadeOrder` 拓扑推导：单元边（子层先于父层，层树单源）
 * ∪ 数据依赖边（dependsOn 真数据依赖），平手按本数组序 —— 内置 13 层
 * 拓扑结果与本序一致，生成输出不变。
 */
export const LAYER_GENERATORS: LayerGenerator[] = [
  heightGen,
  provinceGen,
  countryGen,
  ecosystemGen,
  raceGen,
  cultureGen,
  riversGen,
  roadGen,
  routeGen,
];

export function generatorFor(layerId: LayerId): LayerGenerator | undefined {
  return LAYER_GENERATORS.find((g) => g.layerId === layerId);
}

/**
 * 级联序 = 拓扑排序（HIERARCHY §6.3 包3）：
 * 边 ① 单元边：`childLayer(L) → L`（层树单源，L 等子层先完成）
 * 边 ② 数据依赖边：`dependsOn`（真数据依赖；country←province 由树表达已移除）
 * 平手按 LAYER_GENERATORS 数组序（Kahn 就绪集内取基准序最小者）→ 内置 13 层
 * 结果与旧固定序一致、生成输出不变。环（写入闸后不可达）防御性按基准序推进。
 */
export function cascadeOrder(world: World, ids: LayerId[]): LayerId[] {
  const inSet = new Set(ids);
  const base = LAYER_GENERATORS.map((g) => g.layerId).filter((id) => inSet.has(id));
  const deps = new Map<LayerId, Set<LayerId>>();
  for (const id of base) {
    const d = new Set<LayerId>();
    for (const dep of generatorFor(id)?.dependsOn ?? []) {
      if (dep !== id && inSet.has(dep)) d.add(dep);
    }
    const child = childLayerIdOf(world, id);
    if (child && inSet.has(child)) d.add(child);
    deps.set(id, d);
  }
  const out: LayerId[] = [];
  const done = new Set<LayerId>();
  const remaining = [...base];
  while (remaining.length) {
    const i = remaining.findIndex((id) => [...deps.get(id)!].every((d) => done.has(d)));
    if (i >= 0) {
      const id = remaining.splice(i, 1)[0];
      out.push(id);
      done.add(id);
      continue;
    }
    // 环：防御性取基准序最小者推进（确定性、不挂死）
    let best = 0;
    for (let k = 1; k < remaining.length; k++) {
      if (base.indexOf(remaining[k]) < base.indexOf(remaining[best])) best = k;
    }
    const id = remaining.splice(best, 1)[0];
    out.push(id);
    done.add(id);
  }
  return out;
}

/** 启用层清单（原 profile.cascadeEnabled 收编，基准序 = 注册序） */
export function cascadeEnabled(
  profiles: { layerId: LayerId; enabled?: boolean }[],
): LayerId[] {
  return LAYER_GENERATORS.map((g) => g.layerId).filter(
    (id) => profiles.find((p) => p.layerId === id)?.enabled !== false,
  );
}

/** 按拓扑序 + dependsOn/单元边约束执行 */
export function runCascade(
  world: World,
  seed: number,
  only?: LayerId[],
  onStep?: (label: string, i: number, n: number) => void,
  profileParams?: Record<string, Record<string, number | string | boolean>>,
  enabled?: Set<string>,
  onProgress?: (label: string, frac: number) => void,
): void {
  let list = only?.length
    ? LAYER_GENERATORS.filter((g) => only.includes(g.layerId))
    : [...LAYER_GENERATORS];
  if (enabled) list = list.filter((g) => enabled.has(g.layerId));
  const ordered = cascadeOrder(world, list.map((g) => g.layerId))
    .map((id) => generatorFor(id))
    .filter((g): g is LayerGenerator => !!g);
  const ctx: GenContext = { world, seed, params: {}, onProgress };
  ordered.forEach((g, i) => {
    onStep?.(g.layerId, i, ordered.length);
    ctx.params = { ...g.defaultParams, ...(profileParams?.[g.layerId] ?? {}) };
    g.generate(ctx);
  });
}

export const CASCADE_LABELS: Record<string, string> = {
  height: '大陆高度',
  province: '行省',
  country: '国家',
  rivers: '河网',
  river: '河网',
  ecosystem: '生态',
  race: '种族',
  culture: '文化',
  road: '道路',
  route: '航线',
};
