import type { Cell, LonLat, World } from './types';
import { isOcean } from './types';
import { createRng, hashSeed } from './rng';
import { projectMercator } from './project/mercator';
import { landContinentsCSR } from './index/cellGraph';

/** 值噪声 + 域扭曲，用于撕破圆形大陆轮廓 */
function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothNoise(x: number, y: number, seed: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const n00 = hash2(x0, y0, seed);
  const n10 = hash2(x0 + 1, y0, seed);
  const n01 = hash2(x0, y0 + 1, seed);
  const n11 = hash2(x0 + 1, y0 + 1, seed);
  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let amp = 0.5;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * smoothNoise(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

/** 山脊噪声，形成条带山脉感 */
function ridged(x: number, y: number, seed: number): number {
  const n = fbm(x, y, seed, 5);
  return 1 - Math.abs(n * 2 - 1);
}

export interface ContinentBrush {
  /** 峰值高度 0–1 */
  height: number;
  /** 扩散系数，越大衰减越快 */
  falloff: number;
  /** 墨卡托半径（世界单位） */
  radius: number;
  /** 噪声掩码强度 0–1 */
  roughness?: number;
  seed: number;
}

/** 在已有高度场上叠加一个不规则大陆种子（中心山脉向外扩散） */
export function stampContinent(
  cells: Cell[],
  center: LonLat,
  brush: ContinentBrush,
): void {
  const c = projectMercator(center);
  const rough = brush.roughness ?? 0.75;
  const k = brush.falloff;
  const R = brush.radius;
  for (const cell of cells) {
    const p = projectMercator(cell.center);
    const dx = p.x - c.x;
    const dy = p.y - c.y;
    // 域扭曲：撕破圆形
    const wx = fbm(p.x * 3.2, p.y * 3.2, brush.seed) - 0.5;
    const wy = fbm(p.x * 3.2 + 19, p.y * 3.2 + 7, brush.seed + 3) - 0.5;
    const px = dx + wx * R * rough * 1.4;
    const py = dy + wy * R * rough * 1.4;
    const dist = Math.hypot(px, py);
    if (dist > R) continue;
    const t = dist / R;
    // 径向衰减：中心高、向外扩散
    const radial = Math.exp(-k * t * t) * (1 - t * t);
    // ridged 噪声：山脊细节
    const ridge = ridged(px * 2.1, py * 2.1, brush.seed + 11);
    const mask = 0.35 + 0.65 * ridge;
    const add = brush.height * Math.max(0, radial) * mask;
    // 叠加大陆高度：整数 -63..64
    const h = cell.height + add * 64;
    cell.height = Math.max(-63, Math.min(64, Math.round(h)));
    cell.isOcean = isOcean(cell);
  }
}

/** 海底高度场：整数 -63..-1，有海沟/大陆架起伏 */
export function setAllOcean(cells: Cell[]): void {
  for (const c of cells) {
    const p = projectMercator(c.center);
    const n = fbm(p.x * 1.8, p.y * 1.8, 7777, 5);
    const trench = ridged(p.x * 3.5, p.y * 3.5, 8888);
    const base = -20 - n * 30;
    const depth = base - trench * 13;
    c.height = Math.max(-63, Math.min(-1, Math.round(depth)));
    c.isOcean = true;
    c.continentId = undefined;
  }
}

/** 热侵蚀：降低针刺 */
export function thermalErode(cells: Cell[], iterations = 2, rate = 0.15): void {
  for (let it = 0; it < iterations; it++) {
    const deltas = new Float64Array(cells.length);
    for (const cell of cells) {
      if (isOcean(cell)) continue;
      for (const nId of cell.neighbors) {
        const n = cells[nId];
        const d = cell.height - n.height;
        if (d > 0.08) {
          const move = (d - 0.08) * rate;
          deltas[cell.id] -= move;
          deltas[nId] += move;
        }
      }
    }
    for (const cell of cells) {
      cell.height = Math.max(-63, Math.min(64, Math.round(cell.height + deltas[cell.id])));
      cell.isOcean = isOcean(cell);
    }
  }
}

export function assignContinents(world: World): void {
  const continents = landContinentsCSR(world);
  for (let i = 0; i < continents.length; i++) {
    for (const id of continents[i]) world.cells[id].continentId = i;
  }
  // 生成期种子（供笔刷多数票）；landSea rebuild 后以大陆 Region 顺序为准
}

/** 大陆生成：海底 + 几块大陆（中心山脉向外扩散，参数随机） */
export function generateDemoContinents(
  world: World,
  seed: number,
  onProgress?: (label: string, frac: number) => void,
): void {
  onProgress?.('海底地形', 0.1);
  setAllOcean(world.cells);
  const rng = createRng(hashSeed(seed, 17));

  // 1) 穿极大陆
  onProgress?.('穿极大陆', 0.2);
  const polarLon = rng() * 320 - 160;
  for (let lat = -35; lat <= 89; lat += 10) {
    stampContinent(
      world.cells,
      { lon: polarLon + rng() * 16 - 8, lat },
      {
        height: 0.55 + rng() * 0.4,
        falloff: 1.5 + rng() * 1.2,
        radius: 0.4 + rng() * 0.35,
        roughness: 0.65 + rng() * 0.3,
        seed: hashSeed(seed, 400 + Math.round(lat)),
      },
    );
    onProgress?.('穿极大陆', 0.2 + 0.3 * ((lat + 35) / 124));
  }

  // 2) 确保极点大陆
  onProgress?.('极点大陆', 0.5);
  for (const c of world.cells) {
    if (Math.abs(c.center.lat) < 88.5) continue;
    c.height = Math.max(c.height, 20);
    c.isOcean = false;
    for (const n of c.neighbors) {
      const nc = world.cells[n];
      if (!nc) continue;
      if (Math.abs(nc.center.lat) > 85) {
        nc.height = Math.max(nc.height, 12);
        nc.isOcean = false;
      }
    }
  }

  // 3) 其它大陆
  onProgress?.('大陆生成', 0.6);
  const stamps = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < stamps; i++) {
    const lon = rng() * 320 - 160;
    const lat = (rng() * 100 - 50) * (rng() > 0.5 ? 1 : 0.85);
    stampContinent(world.cells, { lon, lat }, {
      height: 0.55 + rng() * 0.45,
      falloff: 2.5 + rng() * 1.5,
      radius: 0.6 + rng() * 0.6,
      roughness: 0.65 + rng() * 0.3,
      seed: hashSeed(seed, 100 + i),
    });
    onProgress?.('大陆生成', 0.6 + 0.25 * (i / stamps));
  }
  onProgress?.('热侵蚀', 0.85);
  thermalErode(world.cells, 2, 0.12);
  onProgress?.('大陆归属', 0.95);
  assignContinents(world);
  onProgress?.('完成', 1);
}
