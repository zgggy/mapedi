/**
 * 基于已有手绘高度图的细化（**v6，2026-10-06 用户四点定稿**）：
 *   「平原整体是平原只在边缘起山、海要像真实海沟那样有走向、不要一层一层向外
 *    降低，而是随机方向能形成山川的那种包括弯曲、保护海岸开关默认关」
 *
 * 语义：**手绘档位 = 骨架**（画在哪就哪起山、画平原就保持平原档内起伏），
 * **形态 = buildTerrain 同源形态场**（heightFieldFor：域扭曲 FBM + ridged 山系
 * + 细节/海底——随机方向、弯曲的山川与有走向的海底，非距离场同心环）。
 *
 * 管线：
 * 1. f = heightFieldFor（与建地形完全同源的形态场）；
 * 2. **档内分位**：按手绘档分组，组内 f 升序 → 铺满该档 [lo,hi]（档内全谱层次；
 *    平原组永不出 [4,12]、顶峰组永在 [61,64] = 骨架语义）；
 * 3. **档界过渡带**（膨胀 2 轮 ≈ 3 格）：同「相接档集签名」组内 f 联合分位 →
 *    跨档铺满联合区间（顶峰61↔平原12 之间长出 13..60 的山脚过渡，且沿 f 等值
 *    弯曲）；
 * 4. **保护海岸开关（默认关）**：开 = 含跨侧（陆档∪海档）的过渡组跳过 → mask
 *    逐格不动；关 = 跨侧组也重排 → 海岸随 f 走向在带内弯曲进出（变化只限带内
 *    =「大致」保持，d0 ≤ 膨胀宽）；
 * 5. 量程收口 + isOcean 同步；纯海世界（无陆骨架）保护 return 0。
 * 同 seed 同 shape 同输出。
 */
import type { World } from '../types';
import { isOcean } from '../types';
import { heightFieldFor } from '../terrain';
import { heightToIntervalIndex, HEIGHT_INTERVALS, clampHeight } from '../layer/heightIntervals';
import type { WorldShape } from '../layer/genTypes';

export interface RefineOpts {
  seed: number;
  shape: WorldShape;
  /** 保护海岸（2026-10-06 用户定：默认关）：开 = mask 逐格不动；关 = 带内随 f 弯曲进出 */
  protectCoast: boolean;
}

/** 档界过渡带：边界格（与异档/异侧邻居相接）膨胀轮数（带宽 ≈ 膨胀+1 格） */
const BOUNDARY_DILATE = 2;

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
 * 直接写 cells.height / isOcean；返回变更格数（0 = 无可依据骨架，调用方给提示）。
 * 调用方负责快照 → HeightCellsCommand 入栈 → flushHeightRegions。
 */
export function refineHeight(world: World, opts: RefineOpts): number {
  const cells = world.cells;
  const n = cells.length;
  if (!n) return 0;

  // ① 手绘骨架：档组 / mask / 守卫
  const h0 = new Int16Array(n);
  const gi0 = new Uint8Array(n); // 手绘档 index 0..11
  const land0 = new Uint8Array(n);
  let anyLand = false;
  for (const c of cells) {
    h0[c.id] = c.height;
    gi0[c.id] = heightToIntervalIndex(c.height);
    land0[c.id] = c.height >= 1 ? 1 : 0;
    if (land0[c.id]) anyLand = true;
  }
  if (!anyLand) return 0; // 纯海：没有绘制出大陆骨架 → 不动

  // ② 形态场（与建地形完全同源：随机方向、弯曲的山川与有走向的海底）
  const f = heightFieldFor(cells, opts.seed, opts.shape);
  const gamma = 1 + 1.2 * Math.max(0, Math.min(1, opts.shape.flatness));

  // ③ 档内分位：组 = 手绘档；组内 f 升序 → 铺满 [lo,hi]
  const groups = new Map<number, number[]>();
  for (const c of cells) {
    const g = gi0[c.id];
    let arr = groups.get(g);
    if (!arr) groups.set(g, (arr = []));
    arr.push(c.id);
  }
  const h1 = new Float64Array(n);
  for (const [g, idxs] of groups) {
    const sorted = sortAsc(idxs.map((i) => f[i]));
    const lo = HEIGHT_INTERVALS[g].lo;
    const hi = HEIGHT_INTERVALS[g].hi;
    for (const i of idxs) {
      const q = lowerQ(sorted, f[i]);
      h1[i] = lo + Math.pow(q, gamma) * (hi - lo);
    }
  }

  // ④ 档界过渡带：边界格膨胀 → 按「相接档集签名」分组 → 联合区间 f 分位
  const isBoundary = new Uint8Array(n);
  for (const c of cells) {
    for (const j of c.neighbors) {
      if (gi0[j] !== gi0[c.id]) { isBoundary[c.id] = 1; break; }
    }
  }
  const inBand = new Uint8Array(n);
  for (const c of cells) if (isBoundary[c.id]) inBand[c.id] = 1;
  for (let t = 0; t < BOUNDARY_DILATE; t++) {
    const add: number[] = [];
    for (const c of cells) {
      if (inBand[c.id]) continue;
      for (const j of c.neighbors) if (inBand[j]) { add.push(c.id); break; }
    }
    for (const i of add) inBand[i] = 1;
  }
  // 组签名 = 自身+邻居的手绘档集（升序去重）；sig 含陆档与海档 = 跨侧组
  const sigOf = new Map<number, string>();
  const sideSetOf = new Map<string, { lo: number; hi: number; cross: boolean; idxs: number[] }>();
  for (const c of cells) {
    if (!inBand[c.id]) continue;
    const set = new Set<number>();
    set.add(gi0[c.id]);
    for (const j of c.neighbors) set.add(gi0[j]);
    const gs = [...set].sort((a, b) => a - b);
    const key = gs.join(',');
    sigOf.set(c.id, key);
    let lo = 99;
    let hi = -99;
    let hasLand = false;
    let hasSea = false;
    for (const g of gs) {
      lo = Math.min(lo, HEIGHT_INTERVALS[g].lo);
      hi = Math.max(hi, HEIGHT_INTERVALS[g].hi);
      if (HEIGHT_INTERVALS[g].hi >= 1) hasLand = true;
      if (HEIGHT_INTERVALS[g].lo <= 0) hasSea = true;
    }
    let ent = sideSetOf.get(key);
    if (!ent) sideSetOf.set(key, (ent = { lo, hi, cross: hasLand && hasSea, idxs: [] }));
    ent.idxs.push(c.id);
  }
  for (const [key, ent] of sideSetOf) {
    // 保护海岸开：跨侧（海陆）组跳过 → mask 逐格不动；关 = 跨侧也重排（带内弯曲进出）
    if (opts.protectCoast && ent.cross) continue;
    void key;
    const sorted = sortAsc(ent.idxs.map((i) => f[i]));
    for (const i of ent.idxs) {
      const q = lowerQ(sorted, f[i]);
      h1[i] = ent.lo + Math.pow(q, gamma) * (ent.hi - ent.lo);
    }
  }

  // ⑤ 收口：侧 clamp（护岸开 = 数学上必然；关 = 带内过渡值可跨侧 =「大致」语义）
  let changed = 0;
  for (const c of cells) {
    const i = c.id;
    let v = clampHeight(Math.round(h1[i]));
    if (opts.protectCoast) v = land0[i] ? Math.max(1, Math.min(64, v)) : Math.max(-63, Math.min(0, v));
    else v = Math.max(-63, Math.min(64, v));
    if (c.height !== v) { c.height = v; changed++; }
    c.isOcean = isOcean({ height: v });
  }
  return changed;
}
