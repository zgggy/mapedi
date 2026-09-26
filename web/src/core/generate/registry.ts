import type { LayerId, World } from '../types';
import { genConfigFromParams } from '../layer';
import { unifiedGenerate } from './unified';
import { generateRivers } from '../rivers';
import { generateRoads, generateRoutes } from './networks';
import type { BiomeId, CellClimate, CellId } from '../types';

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
const countryGen: LayerGenerator = makeUnifiedGen('country', ['province']);
const environmentGen: LayerGenerator = makeUnifiedGen('environment', ['height']);
const vegetationGen: LayerGenerator = makeUnifiedGen('vegetation', ['height']);
const faunaGen: LayerGenerator = makeUnifiedGen('fauna', ['height']);
const raceGen: LayerGenerator = makeUnifiedGen('race', ['height']);
const cultureGen: LayerGenerator = makeUnifiedGen('culture', ['height']);
const religionGen: LayerGenerator = makeUnifiedGen('religion', ['height']);
const militaryGen: LayerGenerator = makeUnifiedGen('military', ['height']);

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
 * 级联顺序：height → province → country → 其他语义层 → 路径层。
 * province 必须先于 country（country 是 fromLayer 聚合 province）。
 */
export const LAYER_GENERATORS: LayerGenerator[] = [
  heightGen,
  provinceGen,
  countryGen,
  environmentGen,
  vegetationGen,
  faunaGen,
  raceGen,
  cultureGen,
  religionGen,
  militaryGen,
  riversGen,
  roadGen,
  routeGen,
];

export function generatorFor(layerId: LayerId): LayerGenerator | undefined {
  return LAYER_GENERATORS.find((g) => g.layerId === layerId);
}

/** 按预定义顺序 + dependsOn 过滤 */
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
    : LAYER_GENERATORS;
  if (enabled) list = list.filter((g) => enabled.has(g.layerId));
  const ctx: GenContext = { world, seed, params: {}, onProgress };
  list.forEach((g, i) => {
    onStep?.(g.layerId, i, list.length);
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
  environment: '气候与群系',
  vegetation: '植物',
  fauna: '动物',
  race: '种族',
  culture: '文化',
  religion: '宗教',
  military: '军队',
  road: '道路',
  route: '航线',
};
