/**
 * 基于已有高度图生成（2026-10-06 用户澄清重写——初版「粗值扩散细化」被否：
 * 「基于已有 = 基于已有的大致海岸线，几乎走重新生成那一套，从顶峰到深海各个
 * 高度都有，只是海岸线和当前绘制的一样」）。
 *
 * 管线：
 * 1. 记录用户绘制的**海陆 mask**（h≥1）——海岸线唯一真相；
 * 2. `buildTerrain` 完整重新生成（Perlin-FBM 大陆度/山系/细节/海底 + 热侵蚀 +
 *    去尖刺 + 刻度——与「重新生成」同一套算法，种子/旋钮同语义）；
 * 3. **分位重映射到 mask**：陆区按 f 升序分位铺满 [1,64]（贴岸低→顶峰）、海区
 *    铺满 [-63,0]（最深→贴岸 0），幂弯 gamma（flatness 旋钮）保留海拔分布形状
 *    （低地多/深海多）——从顶峰到深海各档全有，且空间结构（山系/侵蚀/破碎）
 *    全部来自生成管线；
 * 4. landRatio 被 mask 取代、relief 被满谱取代（UI 开关开时隐藏这两钮）。
 *
 * 不变量：**mask 逐格不变**（重映射两侧分别 clamp 在各自区间 + isOcean 同步）；
 * 同 seed 同 shape 同输出；无陆（纯海）世界保护 return 0。
 */
import type { World } from '../types';
import { isOcean } from '../types';
import { buildTerrain } from '../terrain';
import type { WorldShape } from '../layer/genTypes';

export interface RefineOpts {
  seed: number;
  /** 地形旋钮全套（= 重新生成同一 WorldShape；landRatio/relief 在本路径不参与刻度） */
  shape: WorldShape;
}

/** 升序数组中 v 的左端分位（并列同 q → 等值面保持平坦）；n=1 → 0.5 */
function lowerQ(sorted: Float64Array, v: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < v) lo = mid + 1;
    else hi = mid;
  }
  const n = sorted.length;
  return n <= 1 ? 0.5 : lo / (n - 1);
}

function sortAsc(a: number[]): Float64Array {
  const f = Float64Array.from(a);
  f.sort();
  return f;
}

/**
 * 直接写 cells.height / isOcean；返回变更格数（0 = 无可细化，调用方给提示）。
 * 调用方负责快照 → HeightCellsCommand 入栈 → flushHeightRegions。
 */
export function refineHeight(world: World, opts: RefineOpts): number {
  const cells = world.cells;
  const n = cells.length;
  if (!n) return 0;
  // ① 用户绘制的海岸线（mask）
  const h0 = new Int16Array(n);
  const isLand = new Uint8Array(n);
  let anyLand = false;
  for (const c of cells) {
    h0[c.id] = c.height;
    isLand[c.id] = c.height >= 1 ? 1 : 0;
    if (isLand[c.id]) anyLand = true;
  }
  if (!anyLand) return 0; // 纯海世界：无海岸线可依据 → 不动

  // ② 完整重新生成（同一套算法）
  buildTerrain(world, opts.seed, opts.shape);

  // ③ 分位重映射到 mask（陆 [1,64] / 海 [-63,0]，gamma=flatness 幂弯）
  const gamma = 1 + 1.2 * Math.max(0, Math.min(1, opts.shape.flatness));
  const landIdx: number[] = [];
  const seaIdx: number[] = [];
  const landF: number[] = [];
  const seaF: number[] = [];
  for (const c of cells) {
    if (isLand[c.id]) {
      landIdx.push(c.id);
      landF.push(c.height);
    } else {
      seaIdx.push(c.id);
      seaF.push(c.height);
    }
  }
  const landSorted = sortAsc(landF);
  const seaSorted = sortAsc(seaF);
  let changed = 0;
  for (const id of landIdx) {
    const q = lowerQ(landSorted, cells[id].height);
    const v = Math.max(1, Math.min(64, Math.round(1 + Math.pow(q, gamma) * 63)));
    if (cells[id].height !== v) {
      cells[id].height = v;
      changed++;
    }
    cells[id].isOcean = isOcean({ height: v });
  }
  for (const id of seaIdx) {
    const q = lowerQ(seaSorted, cells[id].height);
    const v = Math.max(-63, Math.min(0, Math.round(-63 + Math.pow(q, gamma) * 63)));
    if (cells[id].height !== v) {
      cells[id].height = v;
      changed++;
    }
    cells[id].isOcean = isOcean({ height: v });
  }
  // mask 不变量自检（数学上必成立：陆∈[1,64]、海∈[-63,0]；防御性断言只在开发期有意义，
  // 此处以 clamp 本身为保证，不加运行时开销）
  void h0;
  void isLand;
  return changed;
}
