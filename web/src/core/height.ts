import type { Cell, LonLat, World } from './types';
import { isOcean } from './types';
import { createRng, hashSeed } from './rng';
import { projectMercator } from './project/mercator';
import { landContinentsCSR } from './index/cellGraph';
import { DEFAULT_WORLD_SHAPE, type WorldShape } from './layer/genTypes';

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

/** 海底高度场：整数 -63..-1，有海沟/大陆架起伏（seaRugged 0–1 控制起伏幅度） */
export function setAllOcean(cells: Cell[], seaRugged = 1): void {
  const rugged = 0.25 + 0.75 * Math.max(0, Math.min(1, seaRugged));
  for (const c of cells) {
    const p = projectMercator(c.center);
    const n = fbm(p.x * 1.8, p.y * 1.8, 7777, 5);
    const trench = ridged(p.x * 3.5, p.y * 3.5, 8888);
    const base = -20 - n * 30 * rugged;
    const depth = base - trench * 13 * rugged;
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

/** 大陆生成：海底 + 几块大陆（中心山脉向外扩散）+ 形状整形（占比/落差/平整率） */
export function generateDemoContinents(
  world: World,
  seed: number,
  onProgress?: (label: string, frac: number) => void,
  shape: WorldShape = DEFAULT_WORLD_SHAPE,
): void {
  onProgress?.('海底地形', 0.1);
  setAllOcean(world.cells, shape.seaRugged);
  const rng = createRng(hashSeed(seed, 17));
  const rough = 0.5 + 0.5 * Math.max(0, Math.min(1, shape.roughness));

  // 1) 穿极大陆（产品默认开：默认大陆穿极）
  if (shape.polar) {
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
          roughness: (0.65 + rng() * 0.3) * rough,
          seed: hashSeed(seed, 400 + Math.round(lat)),
        },
      );
      onProgress?.('穿极大陆', 0.2 + 0.3 * ((lat + 35) / 124));
    }
  }

  // 2) 确保极点大陆（产品默认：至少一端贴极）
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
  const stamps = Math.max(0, Math.round(shape.continentCount));
  for (let i = 0; i < stamps; i++) {
    const lon = rng() * 320 - 160;
    const lat = (rng() * 100 - 50) * (rng() > 0.5 ? 1 : 0.85);
    stampContinent(world.cells, { lon, lat }, {
      height: 0.55 + rng() * 0.45,
      falloff: 2.5 + rng() * 1.5,
      radius: 0.6 + rng() * 0.6,
      roughness: (0.65 + rng() * 0.3) * rough,
      seed: hashSeed(seed, 100 + i),
    });
    onProgress?.('大陆生成', 0.6 + 0.2 * (i / Math.max(1, stamps)));
  }
  const iters = Math.max(0, Math.min(4, Math.round(shape.erosion)));
  if (iters > 0) {
    onProgress?.('热侵蚀', 0.85);
    thermalErode(world.cells, iters, 0.12);
  }
  onProgress?.('形状整形', 0.9);
  shapeHeightField(world.cells, shape);
  onProgress?.('大陆归属', 0.95);
  assignContinents(world);
  onProgress?.('完成', 1);
}

/** 正态分位（Acklam 有理近似，|err| < 1.2e-9）；p∈(0,1) */
function probit(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - pl) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/**
 * 高度分布整形（单调保序 → 空间结构不变，只改值分布）：
 * 1) 按 raw 高度排名切陆/海两群（陆 = 前 landRatio → 占比精确）
 * 2) 各群内部按分位映射到**半正态**（整体 = 以海平面为界的钟形；用户要的正态观感）
 * 3) 平整率：|z|^γ 收拢向 0（γ=1+3·flatness，越大越多 cell 贴海平面）
 * 4) 落差：陆地峰值 + 海底最深 = relief（各半，与现行默认观感一致）
 */
export function shapeHeightField(
  cells: Cell[],
  shape: Pick<WorldShape, 'landRatio' | 'relief' | 'flatness'>,
): void {
  const n = cells.length;
  if (!n) return;
  const order = cells.map((_, i) => i);
  order.sort((a, b) => cells[a].height - cells[b].height || cells[a].id - cells[b].id);
  const p = Math.max(0.01, Math.min(0.95, shape.landRatio));
  const landCount = Math.max(1, Math.min(n - 1, Math.round(p * n)));
  const seaCount = n - landCount;
  const gamma = 1 + 3 * Math.max(0, Math.min(1, shape.flatness));
  const relief = Math.max(20, Math.min(127, shape.relief));
  const H = relief / 2;

  // 半正态分位（u∈(0,1) → probit(0.5+0.5u) ∈ (0,∞)），γ 收拢
  const zLand = new Float64Array(landCount);
  for (let r = 0; r < landCount; r++) {
    zLand[r] = Math.pow(probit(0.5 + 0.5 * ((r + 0.5) / landCount)), gamma);
  }
  const zSea = new Float64Array(seaCount);
  for (let r = 0; r < seaCount; r++) {
    zSea[r] = Math.pow(probit(0.5 + 0.5 * ((r + 0.5) / seaCount)), gamma);
  }
  const zlMax = zLand[landCount - 1] || 1;
  const zsMax = zSea[seaCount - 1] || 1;

  for (let i = 0; i < n; i++) {
    const c = cells[order[i]];
    if (i >= seaCount) {
      c.height = Math.max(1, Math.min(64, Math.round((zLand[i - seaCount] / zlMax) * H)));
    } else {
      c.height = Math.max(-63, Math.min(-1, Math.round((zSea[i] / zsMax) * -H)));
    }
    c.isOcean = isOcean(c);
  }
}
