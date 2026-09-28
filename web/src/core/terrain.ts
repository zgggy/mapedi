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
 * 高度场：**球面 3D 域扭曲噪声（大陆度）+ 宽幅穿极脊 + 大陆核 + 细节/海底**。
 * - 噪声在单位球向量上求值（无缝、不拉伸）；域扭曲用**向量噪声**撕破圆形海岸；
 * - 穿极大陆 = 沿随机大圆的**宽脊**（宽 30°–50°，噪声撕边）——宽大陆穿极，
 *   不是细长条；天然穿过两极与日界线；
 * - 大陆核 = 宽高斯包络 × 噪声；海底起伏防整片同高。
 */
function heightField(cells: Cell[], seed: number, shape: WorldShape, rng: () => number): Float64Array {
  const n = cells.length;
  const f = new Float64Array(n);
  const rough = 0.5 + 0.5 * Math.max(0, Math.min(1, shape.roughness));
  const rugged = 0.25 + 0.75 * Math.max(0, Math.min(1, shape.seaRugged));

  // 穿极宽脊：随机经线大圆（过两极）+ 宽度
  const lon0 = rng() * 360 - 180;
  const spineN = unitOf(lon0 + 90, 0); // 大圆所在平面的法向
  const spineW = 0.52 + rng() * 0.28;
  const spineAmp = 0.5 + rng() * 0.3;

  // 大陆核（宽包络，随机分布）
  const k = Math.max(0, Math.round(shape.continentCount));
  const cores: { v: V3; r: number; amp: number }[] = [];
  for (let i = 0; i < k; i++) {
    const u = rng() * 2 - 1;
    const lon = rng() * 360 - 180;
    const lat = (Math.asin(Math.max(-1, Math.min(1, u))) * 180) / Math.PI;
    cores.push({ v: unitOf(lon, lat), r: 0.5 + rng() * 0.55, amp: 0.4 + rng() * 0.5 });
  }

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const p = unitOf(c.center.lon, c.center.lat);
    // 域扭曲（向量噪声）：撕圆海岸，方向对称 → 无拉伸/旋绕
    const wx = fbm3(p.x * 1.9 + 3.1, p.y * 1.9 + 5.7, p.z * 1.9 + 1.3, seed + 11, 3) - 0.5;
    const wy = fbm3(p.x * 1.9 + 8.2, p.y * 1.9 + 2.4, p.z * 1.9 + 6.9, seed + 23, 3) - 0.5;
    const wz = fbm3(p.x * 1.9 + 1.7, p.y * 1.9 + 9.1, p.z * 1.9 + 4.2, seed + 37, 3) - 0.5;
    let qx = p.x + wx * 0.34, qy = p.y + wy * 0.34, qz = p.z + wz * 0.34;
    const ql = Math.hypot(qx, qy, qz) || 1;
    qx /= ql; qy /= ql; qz /= ql;

    // 大陆度：低/中频 fbm（撕边后的球面坐标）
    let v = (fbm3(qx * 2.3, qy * 2.3, qz * 2.3, seed + 101, 5) - 0.44) * 1.7;

    if (shape.polar) {
      // 穿极宽脊：到大圆的角距（跨两极/日界线连续）
      const d = Math.abs(p.x * spineN.x + p.y * spineN.y + p.z * spineN.z);
      const ang = Math.asin(Math.max(0, Math.min(1, d)));
      const t = ang / spineW;
      if (t < 2.2) {
        const warp = 1 + (fbm3(qx * 2.8, qy * 2.8, qz * 2.8, seed + 201, 3) - 0.5) * 0.55;
        v += Math.exp(-t * t * warp) * spineAmp * (0.65 + 0.7 * fbm3(qx * 3.1, qy * 3.1, qz * 3.1, seed + 211, 3));
      }
      // 贴极保障：极区小幅抬升（产品默认「至少一端贴极」）
      const pole = Math.max(0, Math.abs(p.y) - 0.93) / 0.07;
      if (pole > 0) v += pole * pole * 0.32;
    }
    for (let ci = 0; ci < cores.length; ci++) {
      const s = cores[ci];
      const dot = Math.max(-1, Math.min(1, p.x * s.v.x + p.y * s.v.y + p.z * s.v.z));
      const t = Math.acos(dot) / s.r;
      if (t > 2.2) continue;
      v += Math.exp(-t * t * 1.1) * s.amp * (0.6 + 0.8 * fbm3(qx * 3.2 + ci * 7, qy * 3.2, qz * 3.2, seed + 301, 3));
    }

    // 细节 + 海底起伏（防整片同高；无弧带噪声）
    const detail = fbm3(p.x * 12, p.y * 12, p.z * 12, seed + 501, 4) - 0.5;
    v += detail * (0.5 + 1.1 * rough) * (0.7 + 0.6 * rugged);
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

  // 整数域去尖刺：峰顶零散点再收拢；随后仿射拉回实差（去尖刺会压缩极值）
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
  let mn = 999;
  let mx = -999;
  for (const c of cells) {
    if (c.height < mn) mn = c.height;
    if (c.height > mx) mx = c.height;
  }
  // 各侧独立拉满（保海平面符号）：陆到 +H、海到 −H → 落差 = 2H = relief 精确
  const kl = H / Math.max(1, mx);
  const ks = H / Math.max(1, -mn);
  for (const c of cells) {
    const v = c.height;
    c.height = Math.max(-63, Math.min(64, Math.round(v >= 0 ? v * kl : v * ks)));
    if (c.height === 0) c.height = v >= 0 ? 1 : -1;
    c.isOcean = isOcean(c);
  }
  onProgress?.('完成', 1);
}
