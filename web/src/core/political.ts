import type { Region, World } from './types';
import { createRng, hashSeed } from './rng';
import { materializeParentCells } from './displayCompose';
import { writeCells } from './occupy';

const PALETTE = [
  '#c45c5c',
  '#5c8dc4',
  '#5cc48d',
  '#c4a15c',
  '#9b5cc4',
  '#c45c9b',
  '#5cc4c4',
  '#8dc45c',
  '#c47b5c',
  '#6b7c93',
];

/** 陆地 BFS 划分国家，再在国家内划分行省 */
export function generatePolitical(world: World, seed: number, countryCount = 8): void {
  const land = world.cells.filter((c) => c.height > 0);
  world.regions = world.regions.filter((r) => r.layerId !== 'country' && r.layerId !== 'province');
  if (land.length < countryCount * 4) return;

  const rng = createRng(hashSeed(seed, 99));
  // 均匀挑种子
  const seeds: number[] = [];
  const step = Math.max(1, Math.floor(land.length / countryCount));
  for (let i = 0; i < countryCount; i++) {
    const idx = Math.min(land.length - 1, i * step + Math.floor(rng() * step * 0.8));
    seeds.push(land[idx].id);
  }

  // 多源 BFS
  const owner = new Int32Array(world.cells.length).fill(-1);
  const queue: number[] = [];
  seeds.forEach((id, i) => {
    owner[id] = i;
    queue.push(id);
  });
  let qi = 0;
  while (qi < queue.length) {
    const id = queue[qi++];
    const o = owner[id];
    for (const n of world.cells[id].neighbors) {
      if (owner[n] === -1 && world.cells[n].height > 0) {
        owner[n] = o;
        queue.push(n);
      }
    }
  }

  const countries: Region[] = seeds.map((id, i) => ({
    id: `country-${i}`,
    layerId: 'country',
    name: `邦国${i + 1}`,
    cells: [],
    centerCellId: id,
    color: PALETTE[i % PALETTE.length],
    attributes: {},
  }));
  {
    // 归属批量落写（顺序 = land 序 → 输出逐位不变；2026-10-06 包 C：经占据写入器）
    const lists: number[][] = countries.map(() => []);
    for (const cell of land) {
      const o = owner[cell.id];
      if (o >= 0) lists[o].push(cell.id);
    }
    countries.forEach((c, i) => {
      if (lists[i].length) writeCells(c, lists[i], 'generate');
    });
  }

  const provinces: Region[] = [];
  for (const country of countries) {
    if (country.cells.length < 6) continue;
    const pCount = Math.min(4, Math.max(2, Math.floor(country.cells.length / 40)));
    const pSeeds: number[] = [];
    const pStep = Math.max(1, Math.floor(country.cells.length / pCount));
    for (let i = 0; i < pCount; i++) {
      const idx = Math.min(country.cells.length - 1, i * pStep + Math.floor(rng() * 3));
      pSeeds.push(country.cells[idx]);
    }
    const pOwner = new Map<number, number>();
    const pq: number[] = [];
    pSeeds.forEach((id, i) => {
      pOwner.set(id, i);
      pq.push(id);
    });
    const countrySet = new Set(country.cells);
    let pj = 0;
    while (pj < pq.length) {
      const id = pq[pj++];
      const o = pOwner.get(id)!;
      for (const n of world.cells[id].neighbors) {
        if (!pOwner.has(n) && countrySet.has(n)) {
          pOwner.set(n, o);
          pq.push(n);
        }
      }
    }
    for (let i = 0; i < pCount; i++) {
      const cells = country.cells.filter((id) => pOwner.get(id) === i);
      if (!cells.length) continue;
      provinces.push({
        id: `${country.id}-p${i}`,
        layerId: 'province',
        name: `行省${i + 1}`,
        cells,
        centerCellId: pSeeds[i],
        parentId: country.id,
        color: country.color,
        attributes: {},
      });
    }
  }

  world.regions.push(...countries, ...provinces);
  // 归属唯一真相：父 Region.cells = 子并集（不再运行时并集）
  materializeParentCells(world);
}

export function regionsOfLayer(world: World, layerId: string): Region[] {
  return world.regions.filter((r) => r.layerId === layerId);
}

export function childrenOf(world: World, parentId: string): Region[] {
  return world.regions.filter((r) => r.parentId === parentId);
}
