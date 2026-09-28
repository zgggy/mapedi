/**
 * 统一地形模型：**参数 → 连续高度场 → 整数域(-63..64)**。
 *
 * 设计（与旧「印章叠加+排名整形」的根本区别）：
 * 1. **连续场**：高度来自多层噪声场的连续组合，只在最后一步取整——
 *    排名映射会把大量 cell 压到同一整数（平台），连续场不会。
 * 2. **球面 3D 噪声**：全部噪声在单位球向量上求值——无经度缝、无极区畸变
 *    （旧 2D 墨卡托噪声在换日线/极区有缝）。
 * 3. **三层分离**：大陆度（哪是陆）/ 山系（哪里高）/ 细节（表面粗糙）各管一层，
 *    参数互不污染；山系走**山脊噪声 × 褶皱带掩码**——成带状山脉，不是均匀鼓包。
 * 4. **侵蚀 + 去尖刺**：热侵蚀拉平陡坡；中值去尖刺消掉「最高处零散的点」。
 * 5. **测高曲线观感**：海侧 = 陆架缓坡 → 深海平原（众数）→ 海沟；陆侧 = 平原
 *    → 丘陵 → 山地带；对齐真实行星的高度直方形态。
 *
 * 参数语义（WorldShape）：landRatio=海平面分位（陆地占比精确）；relief=落差；
 * flatness=向海平面收拢；continentCount=大陆核个数；polar=穿极大陆；
 * roughness=山脊/细节强度；seaRugged=海床起伏；erosion=侵蚀迭代。
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

/** 三线性平滑值噪声，输出 ≈ [0,1] */
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

/** 分形布朗运动（多倍频），输出 ≈ [0,1] */
function fbm3(x: number, y: number, z: number, seed: number, octaves = 5): number {
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

/**
 * 大陆度场：大陆核（平滑角距帽）+ 穿极脊 + 域扭曲 + 低频 fbm。
 * 返回每 cell 一个连续值；海平面 = 其分位阈值。
 */
function continentPotential(cells: Cell[], seed: number, shape: WorldShape, rng: () => number): Float64Array {
  const n = cells.length;
  const out = new Float64Array(n);
  const warpAmp = 0.38 + 0.3 * shape.roughness;
  const cores: { v: V3; r: number; h: number }[] = [];

  // 穿极大陆：沿一条经线的核链（穿极 + 至少一端贴极，产品默认形态）
  if (shape.polar) {
    const spineLon = rng() * 360 - 180;
    for (let lat = -58; lat <= 90; lat += 16) {
      cores.push({ v: unitOf(spineLon + rng() * 10 - 5, lat), r: 0.42 + rng() * 0.16, h: 1 });
    }
    cores.push({ v: unitOf(spineLon, 90), r: 0.5, h: 1 });
  }

  // 其它大陆核
  const k = Math.max(0, Math.round(shape.continentCount));
  for (let i = 0; i < k; i++) {
    const u = rng() * 2 - 1;
    const lon = rng() * 360 - 180;
    const lat = (Math.asin(Math.max(-1, Math.min(1, u))) * 180) / Math.PI;
    cores.push({ v: unitOf(lon, lat), r: 0.38 + rng() * 0.5, h: 0.85 + rng() * 0.3 });
  }

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const p = unitOf(c.center.lon, c.center.lat);
    // 域扭曲（低频向量噪声）：撕圆海岸
    const wx = fbm3(p.x * 1.9 + 3.1, p.y * 1.9 + 5.7, p.z * 1.9 + 1.3, seed + 11, 3) - 0.5;
    const wy = fbm3(p.x * 1.9 + 8.2, p.y * 1.9 + 2.4, p.z * 1.9 + 6.9, seed + 23, 3) - 0.5;
    const wz = fbm3(p.x * 1.9 + 1.7, p.y * 1.9 + 9.1, p.z * 1.9 + 4.2, seed + 37, 3) - 0.5;
    const q = {
      x: p.x + wx * warpAmp,
      y: p.y + wy * warpAmp,
      z: p.z + wz * warpAmp,
    };
    const ql = Math.hypot(q.x, q.y, q.z) || 1;
    q.x /= ql; q.y /= ql; q.z /= ql;

    let pot = -0.6;
    for (const core of cores) {
      const d = q.x * core.v.x + q.y * core.v.y + q.z * core.v.z; // cos 角距
      // 平滑帽：角距内满、外衰（比高斯更平的海岸线）
      const s = smoothstep(0.15, Math.cos(core.r), d);
      if (s * core.h > pot) pot = s * core.h;
    }
    // 低频 fbm 调制大陆度（海岸破碎、海湾）
    pot += (fbm3(q.x * 2.6, q.y * 2.6, q.z * 2.6, seed + 101, 4) - 0.5) * 0.34;
    out[i] = pot;
  }
  return out;
}

/** 数组分位（升序复制） */
function quantile(arr: Float64Array, q: number): number {
  const copy = Array.from(arr).sort((a, b) => a - b);
  const i = Math.max(0, Math.min(copy.length - 1, Math.round(q * (copy.length - 1))));
  return copy[i];
}

/**
 * 建地形：写 cell.height / cell.isOcean。onProgress 同旧接口。
 */
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

  onProgress?.('大陆度', 0.1);
  const pot = continentPotential(cells, seed, shape, rng);

  // 海平面：landRatio 分位 → 陆地占比精确
  const p = Math.max(0.01, Math.min(0.95, shape.landRatio));
  const seaLevel = quantile(pot, 1 - p);

  onProgress?.('山系与细节', 0.35);
  const rough = Math.max(0, Math.min(1, shape.roughness));
  const rugged = Math.max(0, Math.min(1, shape.seaRugged));
  const h = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const p3 = unitOf(c.center.lon, c.center.lat);
    const up = pot[i] - seaLevel; // >0 陆 / <0 海

    if (up >= 0) {
      // 陆侧：海岸平原缓升 + 褶皱带山脊 + 细节
      const inland = smoothstep(0, 0.34, up);
      const belt = ridged3(p3.x * 2.2 + 11, p3.y * 2.2 + 3, p3.z * 2.2 + 7, seed + 301, 3);
      const ridges = ridged3(p3.x * 6.5, p3.y * 6.5, p3.z * 6.5, seed + 401, 4);
      const detail = fbm3(p3.x * 17, p3.y * 17, p3.z * 17, seed + 501, 4) - 0.5;
      h[i] =
        up * 0.9 +
        inland * (belt * 0.9 + 0.25) * (0.35 + 0.85 * ridges) * (0.5 + 0.9 * rough) +
        detail * (0.12 + 0.3 * inland) * (0.4 + 0.9 * rough);
    } else {
      // 海侧：陆架缓坡 → 深海平原（众数）→ 海沟/海岭
      const d = -up;
      const shelf = smoothstep(0, 0.16, d); // 陆架
      const deep = smoothstep(0.1, 0.75, d); // 深海
      const trench = ridged3(p3.x * 3.1 + 21, p3.y * 3.1 + 8, p3.z * 3.1 + 2, seed + 601, 3);
      const detail = fbm3(p3.x * 13, p3.y * 13, p3.z * 13, seed + 701, 4) - 0.5;
      h[i] =
        -(shelf * 0.22 + deep * (0.55 + 0.45 * deep)) -
        trench * deep * (0.12 + 0.5 * rugged) +
        detail * (0.06 + 0.22 * rugged);
    }
  }

  // 侵蚀：热松弛（限坡）+ 中值去尖刺（消「最高处零散的点」）
  const iters = Math.max(0, Math.min(6, Math.round(shape.erosion)));
  if (iters > 0) {
    onProgress?.('热侵蚀', 0.7);
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
  onProgress?.('去尖刺', 0.82);
  for (let pass = 0; pass < 2; pass++) {
    const next = new Float64Array(h);
    for (const c of cells) {
      const nb = c.neighbors;
      if (!nb.length) continue;
      let sum = 0;
      for (const nid of nb) sum += h[nid];
      const mean = sum / nb.length;
      const dv = h[c.id] - mean;
      // 单细胞尖点：远高于/低于所有邻居 → 向邻域均值拉回（限幅）
      if (Math.abs(dv) > 0.34) {
        let far = dv > 0 ? Infinity : -Infinity;
        for (const nid of nb) far = dv > 0 ? Math.min(far, h[nid]) : Math.max(far, h[nid]);
        const extreme = dv > 0 ? h[c.id] > far : h[c.id] < far;
        if (extreme) next[c.id] = mean + Math.sign(dv) * 0.34;
      }
    }
    h.set(next);
  }

  // 刻度映射：海平面 = 最终场的 landRatio 分位（占比精确）；
  // 端点用**真极值**（落差 = max−min 精确；分位端点会把顶端压成平台）；
  // 平整率 = 向海平面的有符号幂收拢（保序、连续，不造平台）。
  onProgress?.('刻度', 0.92);
  const gamma = 1 + 1.2 * Math.max(0, Math.min(1, shape.flatness));
  const H = Math.max(10, Math.min(127, shape.relief)) / 2;
  const shift = quantile(h, 1 - p);
  let landTop = 1e-6;
  let seaBottom = -1e-6;
  for (let i = 0; i < n; i++) {
    const v = h[i] - shift;
    if (v > landTop) landTop = v;
    if (v < seaBottom) seaBottom = v;
  }

  for (let i = 0; i < n; i++) {
    const c = cells[i];
    const v = h[i] - shift;
    let out: number;
    if (v >= 0) {
      const u = Math.pow(v / landTop, gamma);
      out = 1 + u * (H - 1);
    } else {
      const u = Math.pow(v / seaBottom, gamma);
      out = -(1 + u * (H - 1));
    }
    c.height = Math.max(-63, Math.min(64, Math.round(out)));
    if (c.height === 0) c.height = v >= 0 ? 1 : -1; // 海平面不落 0 歧义
    c.isOcean = isOcean(c);
  }
  onProgress?.('完成', 1);
}
