import type { BiomeId, Region, World } from './types';
import { isLand, isOcean } from './types';
import { createRng, hashSeed } from './rng';
import { biomeAt } from './biomes';

const VEG_BY_BIOME: Partial<Record<BiomeId, string[]>> = {
  rainforest: ['阔叶雨林', '藤蔓群落', '巨型蕨类'],
  temperate_forest: ['橡木林', '混交林', '竹林'],
  taiga: ['云杉林', '冷杉林', '白桦林'],
  grassland: ['高草草原', '草甸', '灌丛草原'],
  savanna: ['金合欢', '疏林草原'],
  desert: ['耐旱灌丛', '仙人掌群落'],
  tundra: ['苔原地衣', '矮灌冻原'],
  snow: ['雪线灌木'],
  mountain: ['高山草甸', '针叶林缘'],
  wetland: ['芦苇荡', '红树林'],
  coast: ['滨海灌丛', '椰林'],
  ice: [],
  ocean: [],
};

const FAUNA_BY_BIOME: Partial<Record<BiomeId, string[]>> = {
  rainforest: ['雨林灵长', '巨蟒', '彩羽鸟群'],
  temperate_forest: ['鹿群', '野猪', '林鸮'],
  taiga: ['驯鹿', '棕熊', '狼群'],
  grassland: ['野马', '羚羊', '地鼠群'],
  savanna: ['狮群', '斑马', '象群'],
  desert: ['沙狐', '骆驼', '蝎群'],
  tundra: ['旅鼠', '雪狐'],
  snow: ['雪豹', '北极狐'],
  mountain: ['岩羊', '山鹰'],
  wetland: ['蛙群', '水鸟'],
  coast: ['海豹', '海鸥'],
  ice: [],
  ocean: ['鲸群'],
};

const RACE_POOL = [
  '山民',
  '平原民',
  '林民',
  '海民',
  '雪民',
  '沙民',
  '河谷民',
];

function collectByBiome(
  world: World,
  table: Partial<Record<BiomeId, string[]>>,
  layerId: string,
  seed: number,
  minCells: number,
  overlap: boolean,
): void {
  world.regions = world.regions.filter((r) => r.layerId !== layerId);
  if (!world.biome) return;
  const rng = createRng(hashSeed(seed, hashSeed(1, layerId.length * 31)));
  const groups = new Map<string, number[]>();
  for (const cell of world.cells) {
    if (isOcean(cell) && layerId !== 'fauna') continue;
    const b = biomeAt(world, cell.id);
    const names = table[b];
    if (!names?.length) continue;
    // 低氧砍动物
    const cl = world.cellClimate?.get(cell.id);
    if (layerId === 'fauna' && cl && cl.oxygen < 0.6 && rng() > 0.3) continue;
    const name = names[Math.floor(rng() * names.length)];
    const key = `${b}:${name}`;
    const arr = groups.get(key);
    if (arr) arr.push(cell.id);
    else groups.set(key, [cell.id]);
  }

  let i = 0;
  for (const [key, cells] of groups) {
    if (cells.length < minCells) continue;
    const [b, name] = key.split(':');
    world.regions.push({
      id: `${layerId}-${i++}`,
      layerId,
      name: `${name}`,
      cells: overlap ? cells : cells.slice(0, Math.ceil(cells.length * 0.9)),
      color: colorFor(layerId, b),
      attributes: { biome: b },
    });
  }
}

function colorFor(layerId: string, biome: string): string {
  if (layerId === 'vegetation') return biome.includes('forest') || biome === 'rainforest' ? '#2d8a4e' : '#8fad5a';
  if (layerId === 'fauna') return '#c47b3a';
  return '#9b5cc4';
}

export function generateVegetation(world: World, seed: number): void {
  collectByBiome(world, VEG_BY_BIOME, 'vegetation', seed, Math.max(8, Math.floor(world.cells.length / 80)), true);
}

export function generateFauna(world: World, seed: number): void {
  const min = Math.max(12, Math.floor(world.cells.length / 60));
  collectByBiome(world, FAUNA_BY_BIOME, 'fauna', seed, min, true);
}

/** 种族：在大陆上多种子 BFS，偏好非冰非海 */
export function generateRaces(world: World, seed: number, count = 5): void {
  world.regions = world.regions.filter((r) => r.layerId !== 'race');
  const land = world.cells.filter((c) => {
    if (isOcean(c)) return false;
    const b = biomeAt(world, c.id);
    return b !== 'ice' && b !== 'snow';
  });
  if (land.length < count * 3) return;
  const rng = createRng(hashSeed(seed, 909));
  const step = Math.max(1, Math.floor(land.length / count));
  const seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    seeds.push(land[Math.min(land.length - 1, i * step + Math.floor(rng() * step * 0.7))].id);
  }
  const owner = new Int32Array(world.cells.length).fill(-1);
  const q: number[] = [];
  seeds.forEach((id, i) => {
    owner[id] = i;
    q.push(id);
  });
  let qi = 0;
  while (qi < q.length) {
    const id = q[qi++];
    const o = owner[id];
    for (const n of world.cells[id].neighbors) {
      if (owner[n] === -1 && isLand(world.cells[n])) {
        const b = biomeAt(world, n);
        if (b === 'ice') continue;
        owner[n] = o;
        q.push(n);
      }
    }
  }
  const colors = ['#9b5cc4', '#5cc4c4', '#c45c9b', '#8dc45c', '#c4a15c', '#5c8dc4', '#c45c5c'];
  for (let i = 0; i < count; i++) {
    const cells: number[] = [];
    for (const c of land) if (owner[c.id] === i) cells.push(c.id);
    if (cells.length < 5) continue;
    world.regions.push({
      id: `race-${i}`,
      layerId: 'race',
      name: RACE_POOL[i % RACE_POOL.length],
      cells,
      centerCellId: seeds[i],
      color: colors[i % colors.length],
      attributes: {},
    });
  }
}

export function regionsOf(world: World, layerId: string): Region[] {
  return world.regions.filter((r) => r.layerId === layerId);
}
