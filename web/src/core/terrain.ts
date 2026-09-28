/**
 * 统一地形模型 v2：**球面随机 + 扩散**。
 *
 * 生成语义（用户定）：
 * - **在球面上生成**：一切距离都是**大圆角距**——扩散穿过日界线/极点时是正常高度衰减，
 *   不会「到线就停」（旧版 2D 墨卡托印章在换日线/极区断裂、被拉伸）。
 * - **随机 + 扩散**：随机种子（含穿极大陆核链）向外按角距平滑衰减生长；叠加处升高
 *   （大陆合并处自然成高地）；域扭曲扰动**角距**（方向对称 → 无拉伸感），撕破圆形海岸。
 * - 山脊/细节用球面 3D 噪声；海底随「离种子距离」变深 + 海沟/海岭噪声。
 * - 后处理：热侵蚀 + 去尖刺；值映射走**排名域**（海陆各侧铺满全高程域，逐值自然过渡，
 *   无平台）；参数语义见 WorldShape（占比/落差/平整率/大陆数/穿极/崎岖/海床/侵蚀）。
 */
import type { Cell, World } from './types';
import { isOcean } from './types';
import { createRng, hashSeed } from './rng';
import type { WorldShape } from './layer/genTypes';

// ── 球面 3D 值噪声（确定性、无缝） ──

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

function fbm3(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise3(x * freq, y * freq, z * freq, seed + i * 101);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** 山脊分形（|2n-1| 反相平方累积）：连绵山脊而非孤峰 */
function ridged3(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = noise3(x * freq, y * freq, z * freq, seed + 700 + i * 31);
    const r = 1 - Math.abs(n * 2 - 1);
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2.11;
  }
  return sum / norm;
}

const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

type V3 = { x: number; y: number; z: number };

function unitOf(lonDeg: number, latDeg: number): V3 {
  const λ = (lonDeg * Math.PI) / 180;
  const φ = (latDeg * Math.PI) / 180;
  const c = Math.cos(φ);
  return { x: c * Math.cos(λ), y: Math.sin(φ), z: c * Math.sin(λ) };
}

/** 扩散种子：半径（角距）/ 峰值 / 域扭曲强度 */
type Seed = { v: V3; radius: number; peak: number; warp: number };

function buildSeeds(seed: number, shape: WorldShape, rng: () => number): Seed[] {
  const seeds: Seed[] = [];
  // 穿极大陆：沿一条随机大圆（经线圈）撒核——**自然穿过两极与日界线**，衰减不中断
  if (shape.polar) {
    const lon0 = rng() * 360 - 180;
    for (let lat = -90; lat <= 90; lat += 15) {
      seeds.push({
        v: unitOf(lon0 + rng() * 8 - 4, lat),
        radius: 0.42 + rng() * 0.22,
        peak: 0.72 + rng() * 0.38,
        warp: 0.3 + rng() * 0.22,
      });
    }
  }
  // 其它大陆核（球面均匀随机）
  const k = Math.max(0, Math.round(shape.continentCount));
  for (let i = 0; i < k; i++) {
    const u = rng() * 2 - 1;
    const lon = rng() * 360 - 180;
    const lat = (Math.asin(Math.max(-1, Math.min(1, u))) * 180) / Math.PI;
    seeds.push({
      v: unitOf(lon, lat),
      radius: 0.38 + rng() * 0.55,
      peak: 0.62 + rng() * 0.5,
      warp: 0.28 + rng() * 0.26,
    });
  }
  return seeds;
}

/**
 * 球面扩散高度场：每 cell 取各种子「角距衰减」的叠加；角距经噪声扭曲（方向对称）。
 * 距离 = 大圆角距 → 跨日界线/极点是正常衰减。
 */
function heightField(cells: Cell[], seed: number, shape: WorldShape, rng: () => number): Float64Array {
  const n = cells.length;
  const h = new Float64Array(n);
  const seeds = buildSeeds(seed, shape, rng);
  const rough = 0.5 + 0.5 * Math.max(0, Math.min(1, shape.roughness));
  const rugged = 0.25 + 0.75 * Math.max(0, Math.min(1, shape.seaRugged));

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const p = unitOf(c.center.lon, c.center.lat);
    let v = -0.5; // 深海基准
    for (const s of seeds) {
      const dot = Math.max(-1, Math.min(1, p.x * s.v.x + p.y * s.v.y + p.z * s.v.z));
      const d0 = Math.acos(dot) / s.radius;
      if (d0 > 1.35) continue;
      // 域扭曲：扰动**角距**（对称 → 不拉伸），撕破圆形海岸
      const w = (fbm3(p.x * 2.1 + 3.1, p.y * 2.1 + 5.7, p.z * 2.1 + 1.3, seed + 31, 3) - 0.5) * s.warp;
      const d = d0 + w;
      if (d <= 0) v += s.peak;
      else if (d < 1) {
        const t = 1 - d * d;
        v += s.peak * t * t;
      }
    }
    // 山脊（内陆更强）+ 高频细节
    const inland = smoothstep(0.02, 0.5, v);
    const ridges = ridged3(p.x * 4.2, p.y * 4.2, p.z * 4.2, seed + 401, 4);
    v += inland * ridges * (0.22 + 0.5 * rough);
    v += (fbm3(p.x * 15, p.y * 15, p.z * 15, seed + 501, 4) - 0.5) * (0.09 + 0.2 * rough);
    // 海底：离种子越远越深；海沟/海岭噪声
    const deep = smoothstep(0.06, -0.5, v);
    const trench = ridged3(p.x * 3.0 + 21, p.y * 3.0 + 8, p.z * 3.0 + 2, seed + 601, 3);
    v -= deep * trench * (0.08 + 0.4 * rugged);
    v -= deep * (0.15 + 0.35 * rugged) * (0.5 + 0.5 * fbm3(p.x * 1.7, p.y * 1.7, p.z * 1.7, seed + 701, 3));
    h[i] = v;
  }
  return h;
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

  onProgress?.('球面扩散', 0.15);
  const h = heightField(cells, seed, shape, rng);

  // 侵蚀：热松弛（限坡）+ 去尖刺（消「最高处零散的点」）
  const iters = Math.max(0, Math.min(6, Math.round(shape.erosion)));
  if (iters > 0) {
    onProgress?.('热侵蚀', 0.55);
    for (let it = 0; it < iters; it++) {
      const delta = new Float64Array(n);
      for (const c of cells) {
        const hv = h[c.id];
        for (const nid of c.neighbors) {
          const d = hv - h[nid];
          if (d > 0.05) {
            const move = (d - 0.05) * 0.28;
            delta[c.id] -= move;
            delta[nid] += move;
          }
        }
      }
      for (let i = 0; i < n; i++) h[i] += delta[i];
    }
  }
  onProgress?.('去尖刺', 0.7);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float64Array(h);
    for (const c of cells) {
      const nb = c.neighbors;
      if (!nb.length) continue;
      let sum = 0;
      for (const nid of nb) sum += h[nid];
      const mean = sum / nb.length;
      const dv = h[c.id] - mean;
      if (Math.abs(dv) > 0.34) {
        let far = dv > 0 ? Infinity : -Infinity;
        for (const nid of nb) far = dv > 0 ? Math.min(far, h[nid]) : Math.max(far, h[nid]);
        const extreme = dv > 0 ? h[c.id] > far : h[c.id] < far;
        if (extreme) next[c.id] = mean + Math.sign(dv) * 0.34;
      }
    }
    h.set(next);
  }

  // 刻度映射（**排名域**）：海陆按 landRatio 分位切开，各侧按分位铺满全高程域
  // ——顶峰到深海逐值均匀、自然过渡（排名对场单调 → 空间结构保持）；
  // 平整率 = 分位幂弯（越大越贴海平面）。占比与落差精确。
  onProgress?.('刻度', 0.88);
  const gamma = 1 + 1.2 * Math.max(0, Math.min(1, shape.flatness));
  const H = Math.max(10, Math.min(127, shape.relief)) / 2;
  const p = Math.max(0.01, Math.min(0.95, shape.landRatio));
  const shift = quantile(h, 1 - p);
  const land: number[] = [];
  const sea: number[] = [];
  for (let i = 0; i < n; i++) (h[i] - shift >= 0 ? land : sea).push(i);
  land.sort((a, b) => h[a] - h[b] || a - b); // 低 → 高
  sea.sort((a, b) => h[b] - h[a] || a - b); // 浅 → 深
  const paint = (list: number[], sign: 1 | -1) => {
    const m = list.length;
    for (let r = 0; r < m; r++) {
      const t = m > 1 ? r / (m - 1) : 1;
      const u = Math.pow(t, gamma);
      const c = cells[list[r]];
      c.height = Math.max(-63, Math.min(64, Math.round(sign * (1 + u * (H - 1)))));
      c.isOcean = isOcean(c);
    }
  };
  paint(land, 1);
  paint(sea, -1);

  // 整数域去尖刺：排名拉伸放大局部梯度，孤立格（峰顶零散点）再收拢一次
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
