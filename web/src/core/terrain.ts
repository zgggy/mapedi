/**
 * 统一地形模型 v3：**-63 底球 + 随机撒点 + 扩散**（用户定语义）。
 *
 * 模型（一句话）：底球高度 -63；球面随机撒点，每点自带**起始高度（峰高）/ 扩散半径 /
 * 扩散浓度**；高度从峰顶沿**大圆角距**向外衰减——浓度越高下降越慢、越低下降越快；
 * 半径越大铺得越远。多点扩散自然叠加（叠加处 = 高地/大陆合并）。
 *
 * 关键性质：
 * - 距离全是**大圆角距**：扩散穿过日界线/极点是正常衰减，不会「到线就停」；
 * - 域扭曲只扰动**角距**（方向对称）→ 无「绕着什么转 / 拉伸」的弧线感；
 * - 海底起伏用小噪声（避免整片同高）；无山脊弧带噪声。
 * 后处理：热侵蚀 + 去尖刺；海平面 = 场的 landRatio 分位（占比精确）；落差精确；
 * 平整率 = 向海平面幂弯。
 */
import type { Cell, World } from './types';
import { isOcean } from './types';
import { createRng, hashSeed } from './rng';
import type { WorldShape } from './layer/genTypes';

// ── 球面 3D 值噪声（确定性、无缝；只用于细节/海底/撕边） ──

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const fade = (t: number) => t * t * (3 - 2 * t);

function noise3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const fx = fade(x - x0), fy = fade(y - y0), fz = fade(z - z0);
  const c000 = hash3(x0, y0, z0, seed), c100 = hash3(x0 + 1, y0, z0, seed);
  const c010 = hash3(x0, y0 + 1, z0, seed), c110 = hash3(x0 + 1, y0 + 1, z0, seed);
  const c001 = hash3(x0, y0, z0 + 1, seed), c101 = hash3(x0 + 1, y0, z0 + 1, seed);
  const c011 = hash3(x0, y0 + 1, z0 + 1, seed), c111 = hash3(x0 + 1, y0 + 1, z0 + 1, seed);
  const x00 = c000 + (c100 - c000) * fx, x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx, x11 = c011 + (c111 - c011) * fx;
  const y0v = x00 + (x10 - x00) * fy, y1v = x01 + (x11 - x01) * fy;
  return y0v + (y1v - y0v) * fz;
}

function fbm3(x: number, y: number, z: number, seed: number, octaves = 3): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

type V3 = { x: number; y: number; z: number };

function unitOf(lonDeg: number, latDeg: number): V3 {
  const λ = (lonDeg * Math.PI) / 180;
  const φ = (latDeg * Math.PI) / 180;
  const c = Math.cos(φ);
  return { x: c * Math.cos(λ), y: Math.sin(φ), z: c * Math.sin(λ) };
}

/**
 * 扩散点：起始高度（峰顶值）/ 扩散半径（角距）/ 扩散浓度（越高衰减越慢）。
 */
type Seed = { v: V3; peak: number; radius: number; conc: number };

function buildSeeds(seed: number, shape: WorldShape, rng: () => number): Seed[] {
  const seeds: Seed[] = [];
  // 穿极大陆：沿随机大圆的核链（随机撒点 → 自然穿过两极与日界线）
  if (shape.polar) {
    const lon0 = rng() * 360 - 180;
    for (let lat = -90; lat <= 90; lat += 17) {
      seeds.push({
        v: unitOf(lon0 + rng() * 12 - 6, lat),
        peak: 14 + rng() * 50,
        radius: 0.3 + rng() * 0.22,
        conc: 0.3 + rng() * 0.6,
      });
    }
  }
  const k = Math.max(0, Math.round(shape.continentCount));
  for (let i = 0; i < k; i++) {
    const u = rng() * 2 - 1;
    const lon = rng() * 360 - 180;
    const lat = (Math.asin(Math.max(-1, Math.min(1, u))) * 180) / Math.PI;
    seeds.push({
      v: unitOf(lon, lat),
      peak: 10 + rng() * 54,
      radius: 0.26 + rng() * 0.6,
      conc: 0.2 + rng() * 0.75,
    });
  }
  // 海山/海盆（峰高低于海平面的撒点）：让深海底不平板
  const m = 8 + Math.round(rng() * 10);
  for (let i = 0; i < m; i++) {
    const u = rng() * 2 - 1;
    const lon = rng() * 360 - 180;
    const lat = (Math.asin(Math.max(-1, Math.min(1, u))) * 180) / Math.PI;
    seeds.push({
      v: unitOf(lon, lat),
      peak: -34 + rng() * 32,
      radius: 0.14 + rng() * 0.3,
      conc: 0.15 + rng() * 0.6,
    });
  }
  return seeds;
}

/**
 * 扩散场：f(p) = Σ (峰高+63)·exp(−λ·(角距/半径)²)·撕边；λ 由浓度定（浓度高 → 衰减慢）。
 * 底 = 0（对应高度 −63）；叠加即大陆合并。
 */
function heightField(cells: Cell[], seed: number, shape: WorldShape, rng: () => number): Float64Array {
  const n = cells.length;
  const f = new Float64Array(n);
  const seeds = buildSeeds(seed, shape, rng);
  const rough = 0.5 + 0.5 * Math.max(0, Math.min(1, shape.roughness));
  const rugged = 0.25 + 0.75 * Math.max(0, Math.min(1, shape.seaRugged));

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const p = unitOf(c.center.lon, c.center.lat);
    let v = 0;
    for (const s of seeds) {
      const dot = Math.max(-1, Math.min(1, p.x * s.v.x + p.y * s.v.y + p.z * s.v.z));
      const d = Math.acos(dot); // 大圆角距：跨日界线/极点连续
      const t0 = d / s.radius;
      if (t0 > 3) continue;
      // 域扭曲只扰动角距（方向对称 → 无拉伸/旋绕感），撕破圆形轮廓
      const w = (fbm3(p.x * 2.2 + 3.1, p.y * 2.2 + 5.7, p.z * 2.2 + 1.3, seed + 31, 3) - 0.5) * 0.5;
      const t = t0 * (1 + w * 0.22);
      const lam = 0.55 + 3.3 * (1 - Math.max(0, Math.min(1, s.conc))); // 浓度高 → 下降慢
      v += (s.peak + 63) * Math.exp(-lam * t * t);
    }
    // 细节（小幅度，无弧带）+ 海底起伏（防整片同高）
    const detail = (fbm3(p.x * 13, p.y * 13, p.z * 13, seed + 501, 4) - 0.5);
    v += detail * (1.2 + 3.2 * rough) * (0.6 + 0.6 * rugged);
    f[i] = v;
  }
  return f;
}

/** 数组分位（升序复制） */
function quantile(arr: Float64Array, q: number): number {
  const copy = Array.from(arr).sort((a, b) => a - b);
  const i = Math.max(0, Math.min(copy.length - 1, Math.round(q * (copy.length - 1))));
  return copy[i];
}

/** 建地形：写 cell.height / cell.isOcean。onProgress 同旧接口。 */
export function buildTerrain(
  world: World,
  seed: number,
  shape: WorldShape,
  onProgress?: (label: string, frac: number) => void,
): void {
  const cells = world.cells;
  const n = cells.length;
  if (!n) return;
  const rng = createRng(hashSeed(seed, 17));

  onProgress?.('撒点扩散', 0.15);
  const f = heightField(cells, seed, shape, rng);

  // 侵蚀：热松弛（限坡）+ 去尖刺
  const iters = Math.max(0, Math.min(6, Math.round(shape.erosion)));
  if (iters > 0) {
    onProgress?.('热侵蚀', 0.5);
    for (let it = 0; it < iters; it++) {
      const delta = new Float64Array(n);
      for (const c of cells) {
        const hv = f[c.id];
        for (const nid of c.neighbors) {
          const d = hv - f[nid];
          if (d > 0.05) {
            const move = (d - 0.05) * 0.28;
            delta[c.id] -= move;
            delta[nid] += move;
          }
        }
      }
      for (let i = 0; i < n; i++) f[i] += delta[i];
    }
  }
  onProgress?.('去尖刺', 0.62);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float64Array(f);
    for (const c of cells) {
      const nb = c.neighbors;
      if (!nb.length) continue;
      let sum = 0;
      for (const nid of nb) sum += f[nid];
      const mean = sum / nb.length;
      const dv = f[c.id] - mean;
      if (Math.abs(dv) > 0.6) {
        let far = dv > 0 ? Infinity : -Infinity;
        for (const nid of nb) far = dv > 0 ? Math.min(far, f[nid]) : Math.max(far, f[nid]);
        const extreme = dv > 0 ? f[c.id] > far : f[c.id] < far;
        if (extreme) next[c.id] = mean + Math.sign(dv) * 0.6;
      }
    }
    f.set(next);
  }

  // 刻度：海平面 = 场的 landRatio 分位（占比精确）；扩散场线性映射（保模型形状）；
  // 落差 = max−min 精确；平整率 = 向海平面幂弯。
  onProgress?.('刻度', 0.85);
  const gamma = 1 + 1.2 * Math.max(0, Math.min(1, shape.flatness));
  const H = Math.max(10, Math.min(127, shape.relief)) / 2;
  const p = Math.max(0.01, Math.min(0.95, shape.landRatio));
  const sea = quantile(f, 1 - p); // 场内海平面
  let dTop = 1e-9;
  let dBot = -1e-9;
  for (let i = 0; i < n; i++) {
    const d = f[i] - sea;
    if (d > dTop) dTop = d;
    if (d < dBot) dBot = d;
  }
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const d = f[i] - sea;
    if (d >= 0) {
      const u = Math.pow(d / dTop, gamma);
      c.height = Math.max(1, Math.min(64, Math.round(1 + u * (H - 1))));
    } else {
      const u = Math.pow(d / dBot, gamma);
      c.height = Math.max(-63, Math.min(-1, Math.round(-(1 + u * (H - 1)))));
    }
    c.isOcean = isOcean(c);
  }

  // 整数域去尖刺：峰顶零散点再收拢
  onProgress?.('收尾', 0.95);
  for (let pass = 0; pass < 2; pass++) {
    for (const c of cells) {
      const nb = c.neighbors;
      if (nb.length < 3) continue;
      let sum = 0;
      for (const nid of nb) sum += cells[nid].height;
      const mean = sum / nb.length;
      const dv = c.height - mean;
      if (Math.abs(dv) <= 6) continue;
      let far = dv > 0 ? Infinity : -Infinity;
      for (const nid of nb) far = dv > 0 ? Math.min(far, cells[nid].height) : Math.max(far, cells[nid].height);
      const extreme = dv > 0 ? c.height > far : c.height < far;
      if (!extreme) continue;
      c.height = Math.max(-63, Math.min(64, Math.round(mean + Math.sign(dv) * 6)));
      c.isOcean = isOcean(c);
    }
  }
  onProgress?.('完成', 1);
}
