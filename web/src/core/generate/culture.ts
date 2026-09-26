import type { Region, World } from '../types';
import { createRng, hashSeed } from '../rng';

const CULTURE_COLORS = [
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

const CULTURE_NAMES = ['阿尔泰', '瓦兰', '赛里斯', '努米底亚', '维京', '高棉', '玛雅', '波斯', '斯基泰', '迦太基', '雅典', '罗马'];
const RELIGION_NAMES = ['日曜教', '月影宗', '大地母神', '海神殿', '星象会', '祖先崇拜', '风灵宗', '铁律教'];
const COUNTRY_PREFIX = ['北境', '南洋', '东海', '西陆', '中央', '苍岭', '赤原', '银湾', '铁丘', '雾林', '金穗', '黑岩'];
const COUNTRY_SUFFIX = ['联邦', '王国', '共和国', '帝国', '同盟', '公国', '汗国'];

/** 每步成本：坡度、山地群系、过河更贵 */
function stepCost(
  world: World,
  from: number,
  to: number,
  mountainBarrier: number,
  riverBarrier: number,
): number {
  const a = world.cells[from];
  const b = world.cells[to];
  let cost = 1;
  const dh = Math.abs(a.height - b.height);
  cost += dh * 3 * mountainBarrier;
  const bb = world.biome?.get(to);
  if (bb === 'mountain' || bb === 'snow' || bb === 'ice') cost += mountainBarrier;
  if (bb === 'desert') cost += 0.4;
  // 河边
  for (const [, r] of world.rivers) {
    if ((r.a === from && r.b === to) || (r.a === to && r.b === from)) {
      cost += riverBarrier;
      break;
    }
  }
  return Math.max(0.2, cost);
}

/** 多源代价场扩张（Dijkstra 近似：优先队列用数组） */
function costExpand(
  world: World,
  seeds: { id: number; owner: number }[],
  opts: { mountainBarrier: number; riverBarrier: number; landOnly: boolean; crossPenalty?: (from: number, to: number) => number },
): Int32Array {
  const n = world.cells.length;
  const owner = new Int32Array(n).fill(-1);
  const dist = new Float64Array(n).fill(Infinity);
  // 简易二元堆
  const heap: { id: number; d: number; o: number }[] = [];
  const push = (id: number, d: number, o: number) => {
    heap.push({ id, d, o });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].d <= heap[i].d) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].d < heap[m].d) m = l;
        if (r < heap.length && heap[r].d < heap[m].d) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  for (const s of seeds) {
    owner[s.id] = s.owner;
    dist[s.id] = 0;
    push(s.id, 0, s.owner);
  }

  while (heap.length) {
    const cur = pop();
    if (cur.d > dist[cur.id] + 1e-9) continue;
    if (owner[cur.id] !== cur.o) continue;
    const cell = world.cells[cur.id];
    for (const nb of cell.neighbors) {
      const nc = world.cells[nb];
      if (opts.landOnly && nc.height <= 0) continue;
      let c = stepCost(world, cur.id, nb, opts.mountainBarrier, opts.riverBarrier);
      if (opts.crossPenalty) c *= opts.crossPenalty(cur.id, nb);
      const nd = cur.d + c;
      if (nd < dist[nb]) {
        dist[nb] = nd;
        owner[nb] = cur.o;
        push(nb, nd, cur.o);
      }
    }
  }
  return owner;
}

function pickSeeds(
  world: World,
  count: number,
  rng: () => number,
  landOnly: boolean,
): number[] {
  const pool = world.cells.filter((c) => (landOnly ? c.height > 0 : true));
  if (pool.length < count) return pool.map((c) => c.id);
  const step = pool.length / count;
  const seeds: number[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.min(pool.length - 1, Math.floor(i * step + rng() * step * 0.85));
    seeds.push(pool[idx].id);
  }
  return seeds;
}

/** 区域最中心 cell：从边界 BFS 深度最大者（近似最大最小距离） */
export function mostCentralCell(world: World, cells: number[]): number | undefined {
  if (!cells.length) return undefined;
  const set = new Set(cells);
  if (set.size <= 3) return cells[0];
  // 边界：邻接不在集合内的
  const dist = new Map<number, number>();
  const q: number[] = [];
  for (const id of cells) {
    const cell = world.cells[id];
    const border = cell.neighbors.some((n) => !set.has(n));
    if (border) {
      dist.set(id, 0);
      q.push(id);
    }
  }
  if (!q.length) return cells[Math.floor(cells.length / 2)];
  let head = 0;
  while (head < q.length) {
    const id = q[head++];
    const d = dist.get(id)!;
    for (const n of world.cells[id].neighbors) {
      if (!set.has(n) || dist.has(n)) continue;
      dist.set(n, d + 1);
      q.push(n);
    }
  }
  let best = cells[0];
  let bestD = -1;
  for (const id of cells) {
    const d = dist.get(id) ?? -1;
    if (d > bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

export function generateCultures(
  world: World,
  seed: number,
  count = 8,
  mountainBarrier = 2.5,
  riverBarrier = 1.8,
): void {
  world.regions = world.regions.filter((r) => r.layerId !== 'culture');
  const rng = createRng(hashSeed(seed, 201));
  const seeds = pickSeeds(world, count, rng, true);
  if (!seeds.length) return;
  const owner = costExpand(
    world,
    seeds.map((id, i) => ({ id, owner: i })),
    { mountainBarrier, riverBarrier, landOnly: true },
  );
  for (let i = 0; i < seeds.length; i++) {
    const cells: number[] = [];
    for (const c of world.cells) if (c.height > 0 && owner[c.id] === i) cells.push(c.id);
    if (cells.length < 8) continue;
    world.regions.push({
      id: `culture-${i}`,
      layerId: 'culture',
      name: CULTURE_NAMES[i % CULTURE_NAMES.length],
      cells,
      centerCellId: seeds[i],
      color: CULTURE_COLORS[i % CULTURE_COLORS.length],
      attributes: {},
    });
  }
}

export function generateReligions(
  world: World,
  seed: number,
  count = 5,
  mountainBarrier = 1.2,
  riverBarrier = 1.5,
): void {
  world.regions = world.regions.filter((r) => r.layerId !== 'religion');
  const rng = createRng(hashSeed(seed, 303));
  const seeds = pickSeeds(world, count, rng, true);
  if (!seeds.length) return;
  // 跨文化略易
  const cultureOf = new Int32Array(world.cells.length).fill(-1);
  for (const r of world.regions) {
    if (r.layerId !== 'culture') continue;
    for (const id of r.cells) cultureOf[id] = parseInt(r.id.split('-')[1], 10) || 0;
  }
  const owner = costExpand(
    world,
    seeds.map((id, i) => ({ id, owner: i })),
    {
      mountainBarrier,
      riverBarrier,
      landOnly: true,
      crossPenalty: (from, to) => {
        if (cultureOf[from] !== cultureOf[to] && cultureOf[from] >= 0) return 0.7;
        return 1;
      },
    },
  );
  for (let i = 0; i < seeds.length; i++) {
    const cells: number[] = [];
    for (const c of world.cells) if (c.height > 0 && owner[c.id] === i) cells.push(c.id);
    if (cells.length < 8) continue;
    world.regions.push({
      id: `religion-${i}`,
      layerId: 'religion',
      name: RELIGION_NAMES[i % RELIGION_NAMES.length],
      cells,
      centerCellId: seeds[i],
      color: CULTURE_COLORS[(i + 3) % CULTURE_COLORS.length],
      attributes: {},
    });
  }
}

/** 首都偏好沿海/低坡，再成本扩张国家 */
export function generateCountriesCost(
  world: World,
  seed: number,
  count = 8,
): void {
  world.regions = world.regions.filter((r) => r.layerId !== 'country' && r.layerId !== 'province');
  const rng = createRng(hashSeed(seed, 404));
  const land = world.cells.filter((c) => c.height > 0 && c.height < 0.7);
  if (land.length < count * 4) return;
  // 沿海加分
  const scored = land.map((c) => {
    let s = rng();
    const neighOcean = c.neighbors.some((n) => world.cells[n].height <= 0);
    if (neighOcean) s += 1.2;
    const b = world.biome?.get(c.id);
    if (b === 'mountain' || b === 'ice') s -= 1;
    return { id: c.id, s };
  });
  scored.sort((a, b) => b.s - a.s);
  const seeds: number[] = [];
  const minDist = 8;
  for (const item of scored) {
    if (seeds.length >= count) break;
    const ok = seeds.every((sid) => {
      const a = world.cells[sid].center;
      const b = world.cells[item.id].center;
      return Math.hypot(a.lon - b.lon, a.lat - b.lat) > minDist;
    });
    if (ok) seeds.push(item.id);
  }
  if (seeds.length < 2) return;
  const owner = costExpand(
    world,
    seeds.map((id, i) => ({ id, owner: i })),
    { mountainBarrier: 1.8, riverBarrier: 1.2, landOnly: true },
  );
  const PALETTE = CULTURE_COLORS;
  for (let i = 0; i < seeds.length; i++) {
    const cells: number[] = [];
    for (const c of world.cells) if (c.height > 0 && owner[c.id] === i) cells.push(c.id);
    if (cells.length < 10) continue;
    const id = `country-${i}`;
    world.regions.push({
      id,
      layerId: 'country',
      name: `${COUNTRY_PREFIX[i % COUNTRY_PREFIX.length]}${COUNTRY_SUFFIX[i % COUNTRY_SUFFIX.length]}`,
      cells,
      centerCellId: mostCentralCell(world, cells) ?? seeds[i],
      color: PALETTE[i % PALETTE.length],
      attributes: {},
    });
  }
  // 行省
  for (const country of world.regions.filter((r) => r.layerId === 'country')) {
    const pCount = Math.min(5, Math.max(2, Math.floor(country.cells.length / 35)));
    const pSeeds: number[] = [];
    const step = Math.max(1, Math.floor(country.cells.length / pCount));
    for (let i = 0; i < pCount; i++) {
      pSeeds.push(country.cells[Math.min(country.cells.length - 1, i * step)]);
    }
    const set = new Set(country.cells);
    const pOwner = new Map<number, number>();
    const q: number[] = [];
    pSeeds.forEach((id, i) => {
      pOwner.set(id, i);
      q.push(id);
    });
    let qi = 0;
    while (qi < q.length) {
      const id = q[qi++];
      const o = pOwner.get(id)!;
      for (const n of world.cells[id].neighbors) {
        if (!pOwner.has(n) && set.has(n)) {
          pOwner.set(n, o);
          q.push(n);
        }
      }
    }
    for (let i = 0; i < pCount; i++) {
      const cells = country.cells.filter((id) => pOwner.get(id) === i);
      if (cells.length < 4) continue;
      world.regions.push({
        id: `${country.id}-p${i}`,
        layerId: 'province',
        name: `${COUNTRY_PREFIX[Math.floor(i / 2) % COUNTRY_PREFIX.length]}${['郡', '道', '州', '都'][i % 4]}`,
        cells,
        centerCellId: mostCentralCell(world, cells) ?? pSeeds[i],
        parentId: country.id,
        color: country.color,
        attributes: {},
      });
    }
  }
  // 国家首都：所有行省中心里最「居中」的行省中心
  for (const country of world.regions.filter((r) => r.layerId === 'country')) {
    const provs = world.regions.filter((r) => r.parentId === country.id);
    if (!provs.length) continue;
    const cen = mostCentralCell(
      world,
      provs.map((p) => p.centerCellId ?? p.cells[0]),
    );
    if (cen !== undefined) country.centerCellId = cen;
  }
}

export function cultureName(i: number): string {
  return CULTURE_NAMES[i % CULTURE_NAMES.length];
}

export type { Region };
