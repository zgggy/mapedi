/**
 * 统一地形模型 v5：**Perlin 梯度噪声 + FBM**（先定算法，参数由算法导出）。
 *
 * 算法（数据流）：
 *   p        = 球面单位向量（无缝：噪声直接吃 xyz，不走经纬度）
 *   q        = normalize(p + κ·W(p))            W = 向量 FBM（域扭曲，撕海岸）
 *   C        = FBM(q·f_c, oct=6)                大陆度（低频大形 + 高频细节）
 *          + 穿极宽帽（可关）                    保证「穿极 + 贴极」产品默认
 *   M        = ridged-FBM(q·f_m, oct=5)·内陆度·μ  山系（山脊分形 → 连绵山脉）
 *   D        = FBM(p·f_d, oct=4)·δ              表面细节
 *   S        = FBM(p·f_s, oct=4)·σ + 海沟噪声   海底起伏（防整片同高）
 *   h_raw    = C + M + D + (海侧)·S
 *   → 热侵蚀 → 去尖刺 → 海平面 = 分位(landRatio) → 线性刻度(relief/flatness) → 整数
 *
 * 为什么 Perlin+FBM（vs 旧值噪声）：梯度噪声无「网格状/拉伸」伪影；FBM 的
 * lacunarity/gain 控制细节能量谱；ridged 变体出山脊而非鼓包；域扭曲让海岸有机。
 *
 * 参数（面板）与算法一一对应：
 *   大陆尺度 → f_c（频率）；海岸破碎度 → κ；山脉强度 → μ；细节量 → δ；
 *   海底起伏 → σ；穿极大陆 → 帽开关；大陆占比/落差/平整率/侵蚀 → 后处理。
 */
import { EPS_FP } from './tolerances';
import type { Cell, World } from './types';
import { isOcean } from './types';
import { createRng, hashSeed } from './rng';
import type { WorldShape } from './layer/genTypes';

// ── Perlin 梯度噪声（3D，种子化，[-1,1]） ──

function hash3(ix: number, iy: number, iz: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + iz * 2147483647 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** 立方体棱方向梯度（Perlin 经典 12 梯度） */
function gradDot(h: number, x: number, y: number, z: number): number {
  const g = h & 15;
  const u = g < 8 ? x : y;
  const v = g < 4 ? y : (g === 12 || g === 14 ? x : z);
  return ((g & 1) === 0 ? u : -u) + ((g & 2) === 0 ? v : -v);
}

const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Perlin 3D 梯度噪声，输出 ≈ [-1,1] */
function perlin3(x: number, y: number, z: number, seed: number): number {
  const x0 = Math.floor(x), y0 = Math.floor(y), z0 = Math.floor(z);
  const xf = x - x0, yf = y - y0, zf = z - z0;
  const u = quintic(xf), v = quintic(yf), w = quintic(zf);
  const g = (dx: number, dy: number, dz: number) =>
    gradDot(Math.floor(hash3(x0 + dx, y0 + dy, z0 + dz, seed) * 16), xf - dx, yf - dy, zf - dz);
  const x00 = lerp(g(0, 0, 0), g(1, 0, 0), u);
  const x10 = lerp(g(0, 1, 0), g(1, 1, 0), u);
  const x01 = lerp(g(0, 0, 1), g(1, 0, 1), u);
  const x11 = lerp(g(0, 1, 1), g(1, 1, 1), u);
  return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
}

/** 分形布朗运动：多倍频叠加（lacunarity=2, gain=0.5），输出 ≈ [-1,1] */
/** 分层 fbm（IQ 形式：lacunarity=2、gain=0.5） */
function fbm(x: number, y: number, z: number, seed: number, octaves = 5): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * perlin3(x * freq, y * freq, z * freq, seed + i * 131);
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
  }
  return sum / norm;
}

/** 山脊 FBM：(1−|n|)² 累积 → 连绵山脊（非鼓包） */
/** 山脊 fbm [0,1] */
function ridged(x: number, y: number, z: number, seed: number, octaves = 5): number {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = perlin3(x * freq, y * freq, z * freq, seed + 700 + i * 37);
    const r = 1 - Math.abs(n);
    sum += amp * r * r;
    norm += amp;
    amp *= 0.5;
    freq *= 2.0;
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

/**
 * 高度场（Perlin-FBM 组合，见文件头数据流）。
 */
function heightField(cells: Cell[], seed: number, shape: WorldShape, rng: () => number): Float64Array {
  const n = cells.length;
  const f = new Float64Array(n);
  // 参数 → 算法量
  const fC = 1.1 + 2.6 * (1 - Math.max(0, Math.min(1, shape.continentScale))); // 大陆尺度（频率）
  const kappa = 0.1 + 0.5 * Math.max(0, Math.min(1, shape.coastBreak));         // 海岸破碎度（域扭曲）
  const mu = 0.18 + 1.0 * Math.max(0, Math.min(1, shape.mountain));             // 山脉强度
  const delta = 0.12 + 0.5 * Math.max(0, Math.min(1, shape.detail));            // 细节量
  const sigma = 0.25 + 1.0 * Math.max(0, Math.min(1, shape.seaRugged));         // 海底起伏

  // 噪声域旋转（每种子随机正交阵）：打散 Perlin 网格的轴对齐对称感
  const th = rng() * Math.PI * 2, ph = Math.acos(rng() * 2 - 1);
  const R = (() => {
    const c1 = Math.cos(th), s1 = Math.sin(th), c2 = Math.cos(ph), s2 = Math.sin(ph);
    return [
      c1, -s1, 0,
      s1 * c2, c1 * c2, -s2,
      s1 * s2, c1 * s2, c2,
    ];
  })();
  const rot = (v: { x: number; y: number; z: number }): { x: number; y: number; z: number } => ({
    x: R[0] * v.x + R[1] * v.y + R[2] * v.z,
    y: R[3] * v.x + R[4] * v.y + R[5] * v.z,
    z: R[6] * v.x + R[7] * v.y + R[8] * v.z,
  });

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const p0 = unitOf(c.center.lon, c.center.lat); // 真实球向量（纬度用）
    const p = rot(p0); // 噪声域（仅噪声采样）
    // 域扭曲 W(p)：向量 FBM（三通道各不同 → 方向对称撕海岸，无拉伸感）
    const wx = fbm(p.x * 1.6 + 3.1, p.y * 1.6 + 5.7, p.z * 1.6 + 1.3, seed + 11, 3);
    const wy = fbm(p.x * 1.6 + 8.2, p.y * 1.6 + 2.4, p.z * 1.6 + 6.9, seed + 23, 3);
    const wz = fbm(p.x * 1.6 + 1.7, p.y * 1.9 + 9.1, p.z * 1.6 + 4.2, seed + 37, 3);
    let qx = p.x + wx * kappa, qy = p.y + wy * kappa, qz = p.z + wz * kappa;
    const ql = Math.hypot(qx, qy, qz) || 1;
    qx /= ql; qy /= ql; qz /= ql;

    // 大陆度 C
    let v = fbm(qx * fC, qy * fC, qz * fC, seed + 101, 6);

    // 低纬大陆倾向（参数）：中低纬度整体抬升大陆度 → 大陆更常生于中低纬
    // （高纬大陆在墨卡托下拉伸难看；不再有穿极等特殊设定）
    const w = smoothstep(0.92, 0.2, Math.abs(p0.y)); // 真实纬度
    v += shape.latBias * 0.5 * w * (0.7 + 0.5 * fbm(qx * 2.2, qy * 2.2, qz * 2.2, seed + 201, 3));

    // 山系 M：ridged FBM × 内陆度
    const inland = smoothstep(0.02, 0.5, v);
    v += inland * ridged(qx * 3.4, qy * 3.4, qz * 3.4, seed + 301, 5) * mu;

    // 细节 D
    v += fbm(p.x * 11, p.y * 11, p.z * 11, seed + 501, 4) * delta * (0.55 + 0.45 * inland);

    // 海底 S：海床起伏 + 海沟（ridged）
    const deep = smoothstep(0.02, -0.55, v);
    v += deep * fbm(p.x * 2.0, p.y * 2.0, p.z * 2.0, seed + 601, 4) * sigma;
    v -= deep * ridged(p.x * 2.8, p.y * 2.8, p.z * 2.8, seed + 701, 3) * sigma * 0.45;

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

/** 建地形：写 cell.height / cell.isOcean。 */
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
  void rng;

  onProgress?.('Perlin-FBM 地形', 0.15);
  const f = heightField(cells, seed, shape, rng);

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
      if (Math.abs(dv) > 0.28) {
        let far = dv > 0 ? Infinity : -Infinity;
        for (const nid of nb) far = dv > 0 ? Math.min(far, f[nid]) : Math.max(far, f[nid]);
        const extreme = dv > 0 ? f[c.id] > far : f[c.id] < far;
        if (extreme) next[c.id] = mean + Math.sign(dv) * 0.28;
      }
    }
    f.set(next);
  }

  // 刻度：海平面 = landRatio 分位（占比精确）；线性映射保算法形状；落差精确；平整率幂弯
  onProgress?.('刻度', 0.85);
  const gamma = 1 + 1.2 * Math.max(0, Math.min(1, shape.flatness));
  const H = Math.max(10, Math.min(127, shape.relief)) / 2;
  const p = Math.max(0.01, Math.min(0.95, shape.landRatio));
  const sea = quantile(f, 1 - p);
  let dTop = EPS_FP;
  let dBot = -EPS_FP;
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

  // 整数域去尖刺 + 各侧仿射拉满（落差精确）
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
