/**
 * 统一地形模型 v6：**2D 高度图（Perlin + HMF 多分形 + Domain Warp）→ 球面采样**。
 *
 * 算法本体 = `core/heightmap2d.ts`（按用户规格）：输出 256×256 int16，像素 ∈ [-63,64]，
 * seaLevel 阈值定陆海比例。本模块负责把它**贴到球面 cell**：等距圆柱双线性采样
 * （x 方向周期采样 → 换日线无缝；极区即贴图上/下缘，自然连续）。
 *
 * 生成链：heightmap2D（Domain Warp → HMF 多分形 → 量化 [-63,64]）→ 逐 cell 采样 →
 * isOcean = h ≤ seaLevel。
 */
import type { Cell, World } from './types';
import { isOcean } from './types';
import { DEFAULT_HMF2D, generateHeightmap2D, type Hmf2DParams } from './heightmap2d';

/** 高度图 → 逐 cell 采样（等距圆柱；x 周期 → 换日线无缝） */
function sampleHeightmap(map: Int16Array, size: number, lon: number, lat: number): number {
  const u = ((lon + 180) / 360) * size;
  const v = ((90 - lat) / 180) * (size - 1);
  const i0 = Math.floor(u);
  const j0 = Math.max(0, Math.min(size - 2, Math.floor(v)));
  const fu = u - i0;
  const fv = v - j0;
  const wrap = (i: number) => ((i % size) + size) % size;
  const a = map[j0 * size + wrap(i0)];
  const b = map[j0 * size + wrap(i0 + 1)];
  const c = map[(j0 + 1) * size + wrap(i0)];
  const d = map[(j0 + 1) * size + wrap(i0 + 1)];
  return (a * (1 - fu) + b * fu) * (1 - fv) + (c * (1 - fu) + d * fu) * fv;
}

/** 建地形：2D 高度图（Perlin+HMF+DomainWarp）→ 球面采样 → cell.height */
export function buildTerrain(
  world: World,
  seed: number,
  shape: Hmf2DParams = DEFAULT_HMF2D,
  onProgress?: (label: string, frac: number) => void,
): void {
  const cells = world.cells;
  const n = cells.length;
  if (!n) return;

  onProgress?.('Perlin+HMF 高度图', 0.2);
  // 世界种子决定噪声种子（同种子可复现）；其余参数照规格
  const map = generateHeightmap2D({ ...shape, seed }, 256, true);

  onProgress?.('球面采样', 0.8);
  for (const c of cells) {
    const h = sampleHeightmap(map, 256, c.center.lon, c.center.lat);
    c.height = Math.max(-63, Math.min(64, Math.round(h)));
    c.isOcean = isOcean(c);
  }
  onProgress?.('完成', 1);
}
