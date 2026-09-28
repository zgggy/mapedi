/**
 * 2D 高度图生成：**Perlin 噪声 + HMF 非均匀多分形 + Domain Warp 域扭曲**（按用户规格）。
 *
 * 核心原理：
 * 1. **Domain Warp**：用 Perlin 噪声扰动采样坐标 → 扭曲海岸线，消除噪声规整感；
 * 2. **HMF 多分形**（hybrid multifractal，Musgrave 型）：多层噪声叠加，
 *    `weight = clamp(signal·gain, 0, 1)` 随**局部高度**反馈——高地自动放大细节、
 *    平原细节减弱，模拟地球地貌；
 * 3. 浮点结果映射量化到整数 `[-63, 64]`（128 级）；`seaLevel` 阈值控制陆海比例。
 *
 * 输出：`size×size`（默认 256×256）`Int16Array`，每个像素 ∈ [-63, 64]。
 *
 * 预设（地球默认，陆地≈30%）：seed=1337, scale=22, octaves=6, lacunarity=2,
 * persistence=0.48, hmfGain=1.05, hmfOffset=0.02, warpStrength=2.8, warpScale=35,
 * seaLevel=-12。
 *
 * 球面适配：x 方向**周期化**（lattice 按 periodX 回绕）——贴到球面时换日线无缝；
 * 纯 2D 用法（periodX=0）与规格一致。
 */

export interface Hmf2DParams {
  seed: number;
  /** 主噪声频率：跨图噪声格数（越大大陆越多越小） */
  scale: number;
  octaves: number;
  lacunarity: number;
  persistence: number;
  /** HMF：细节随高度增益（>1 高地细节放大） */
  hmfGain: number;
  /** HMF：各层噪声整体抬升 */
  hmfOffset: number;
  /** 域扭曲强度（噪声域单位） */
  warpStrength: number;
  /** 域扭曲噪声频率（跨图格数） */
  warpScale: number;
  /** 海平面（输出整数阈值）：> seaLevel = 陆地 */
  seaLevel: number;
}

export const DEFAULT_HMF2D: Hmf2DParams = {
  seed: 1337,
  scale: 22.0,
  octaves: 6,
  lacunarity: 2.0,
  persistence: 0.48,
  hmfGain: 1.05,
  hmfOffset: 0.02,
  warpStrength: 2.8,
  warpScale: 35.0,
  seaLevel: -12,
};

/** 可调预设分组（用户给定） */
export const HMF2D_PRESETS: Record<string, Partial<Hmf2DParams>> = {
  群岛: { scale: 12, warpStrength: 3.2, seaLevel: -18 },
  巨型山脉大陆: { scale: 35, persistence: 0.52, warpStrength: 2.0, seaLevel: -8 },
  关闭域扭曲: { warpStrength: 0 },
};

// ── Perlin 2D 梯度噪声（可选 x 周期） ──

function hash2(ix: number, iy: number, seed: number): number {
  let h = (ix * 374761393 + iy * 668265263 + seed * 1274126177) | 0;
  h = (h ^ (h >>> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const quintic = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function grad2(h: number, x: number, y: number): number {
  switch (h & 7) {
    case 0: return x + y;
    case 1: return x - y;
    case 2: return -x + y;
    case 3: return -x - y;
    case 4: return x;
    case 5: return -x;
    case 6: return y;
    default: return -y;
  }
}

/** Perlin 2D；periodX>0 时 x 方向按 periodX 格回绕（球面贴图换日线无缝） */
function perlin2(x: number, y: number, seed: number, periodX = 0): number {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const xf = x - x0, yf = y - y0;
  const u = quintic(xf), v = quintic(yf);
  const wx = (i: number) => (periodX > 0 ? ((x0 + i) % periodX + periodX) % periodX : x0 + i);
  const g = (i: number, j: number) =>
    grad2(Math.floor(hash2(wx(i), y0 + j, seed) * 8), xf - i, yf - j);
  return lerp(lerp(g(0, 0), g(1, 0), u), lerp(g(0, 1), g(1, 1), u), v);
}

/**
 * HMF 非均匀多分形（hybrid multifractal，Musgrave 型）：
 * signal = (noise₀₁ + offset)·amp；signal·= weight；weight = clamp(signal·gain, 0, 1)。
 * weight 随**局部高度**反馈：高地 weight≈1 → 后续层细节全开；平原 weight→0 → 细节减弱。
 */
function hmf2D(x: number, y: number, p: Hmf2DParams, periodX: number): number {
  let value = 0;
  let weight = 1;
  let freq = 1;
  let amp = 1;
  for (let i = 0; i < Math.max(1, Math.round(p.octaves)); i++) {
    const n = perlin2(x * freq, y * freq, p.seed + i * 101, periodX > 0 ? Math.round(periodX * freq) : 0);
    const n01 = n * 0.5 + 0.5; // [0,1]
    let signal = (n01 + p.hmfOffset) * amp;
    signal *= weight;
    weight = Math.max(0, Math.min(1, signal * p.hmfGain));
    value += signal;
    freq *= p.lacunarity;
    amp *= p.persistence;
  }
  return value;
}

/**
 * 生成 256×256（可调）int16 高度图，像素 ∈ [-63, 64]。
 * @param periodicX true = x 方向周期（球面贴图用；左/右边缘无缝）
 */
export function generateHeightmap2D(
  params: Partial<Hmf2DParams> = {},
  size = 256,
  periodicX = true,
): Int16Array {
  const p: Hmf2DParams = { ...DEFAULT_HMF2D, ...params };
  const out = new Int16Array(size * size);
  const raw = new Float64Array(size * size);
  const scale = Math.max(1, p.scale);
  const warpScale = Math.max(1, p.warpScale);
  const periodX = periodicX ? Math.max(2, Math.round(scale)) : 0;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = (i / size) * scale;
      const v = (j / size) * scale;
      // 1) Domain Warp：两通道 Perlin 扰动采样坐标（扭曲海岸线）
      let su = u;
      let sv = v;
      if (p.warpStrength > 0) {
        const wu = (i / size) * warpScale;
        const wv = (j / size) * warpScale;
        const dx = perlin2(wu, wv, p.seed + 900, periodicX ? Math.round(warpScale) : 0);
        const dy = perlin2(wu + 5.7, wv + 1.3, p.seed + 901, periodicX ? Math.round(warpScale) : 0);
        su = u + p.warpStrength * dx;
        sv = v + p.warpStrength * dy;
      }
      // 2) HMF 多分形
      raw[j * size + i] = hmf2D(su, sv, p, periodX);
    }
  }

  // 3) 量化到 [-63, 64]：**分位幂映射**（γ=2.56）——单调保形（空间结构不变）、
  // 铺满 128 级无平台，且与规格对齐：默认 seaLevel=-12 恰好 ≈30% 陆地；
  // seaLevel 越低陆地越多（比例旋钮）。
  const n = raw.length;
  const order = new Array<number>(n);
  for (let k = 0; k < n; k++) order[k] = k;
  order.sort((a, b) => raw[a] - raw[b] || a - b);
  const GAMMA = 2.56;
  for (let r = 0; r < n; r++) {
    const t = Math.pow((r + 0.5) / n, GAMMA);
    out[order[r]] = Math.max(-63, Math.min(64, Math.round(-63 + t * 127)));
  }
  void p.seaLevel; // 阈值由消费方解释（h > seaLevel = 陆地）
  return out;
}

/** 高度图 → 陆地占比（h > seaLevel） */
export function landFraction(map: Int16Array, seaLevel: number): number {
  let land = 0;
  for (let i = 0; i < map.length; i++) if (map[i] > seaLevel) land++;
  return land / map.length;
}
