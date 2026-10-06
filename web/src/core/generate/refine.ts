/**
 * 基于已有手绘骨架的地形生成（**v7 = Poisson 约束生成**，2026-10-06 用户定稿：
 * 「上网搜到底用什么算法……要求生成的结果效果和不基于已有的一样」）。
 *
 * 算法（Poisson Image Editing 的地形应用；Pérez et al. 2003 框架
 * `min∫|∇f−v|², f|∂Ω=f*|∂Ω` ⇔ `Δf=div v`，取 v=∇f_src、边界 f|岸=0 的减法形式）：
 * 1. `f = terrainFieldFor(...)`：**与 buildTerrain 完全同源**的完整形态场
 *    （heightField + 热侵蚀 + 去尖刺，共用同一函数——「效果一样」的代码保证）；
 * 2. 岸线边界值 b_i = f|岸（逐格），**调和扩展** u（域内解 Δu=0、∂Ω 固定 b）：
 *    u ≈ 边界值的低频延拓（Jacobi 迭代）；
 * 3. h = f − u ⇒ **h|岸=0**（海岸线逐格=绘制，且不是截取——是低频修正，
 *    中高频细节/山川走向/海沟结构与自由生成逐点一致）；
 * 4. 陆/海各自按 (f−u) 的秩序线性铺满 [1,64] / [−63,0]（保序 = 保形态，端点必达）；
 * 5. 护岸开关（默认关）：关 = 岸边各 1 格按 f 相对岸均值的偏移决定进出
 *    （海岸随形态场微调 ±1 格，「大致」保持）；开 = mask 逐格锁定。
 */
import type { World } from '../types';
import { isOcean } from '../types';
import { terrainFieldFor } from '../terrain';
import { clampHeight } from '../layer/heightIntervals';
import type { WorldShape } from '../layer/genTypes';

export interface RefineOpts {
  seed: number;
  shape: WorldShape;
  /** 保护海岸（用户定：默认关）：开 = mask 逐格不动；关 = 岸线随形态场带内 ±1 格微调 */
  protectCoast: boolean;
}

/**
 * 边界值延拓（u）的构造：**BFS 最近岸值 + 若干轮同域均值平滑**
 * （= 边界值的低频延拓；数学上不必严格调和——h=f−u 只需 u 低频、u|岸=f|岸。
 * 240 轮全图 Jacobi 实测 2.3s 太慢 → 此方案 O(E×轮)≈百毫秒级，2026-10-06）。
 */
const SMOOTH_ITERS = 40;

/**
 * 海岸碎渣清理（2026-10-06 用户「海岸边上还有一些零碎的海岸，消除一下」；
 * v2 同日「还是碎」修正）：对最终整数高度场做连通域过滤——**不含「手绘未翻格」**
 * 的小块（陆 <K → 归海 −1；海 <K → 归陆 +1）。
 * v2 修的两个逃逸：① K=4 时恰好 4 格的碎块逃逸 → K=30；② 来源判据 = **手绘原侧
 * == 当前侧**（护岸微调的翻转格本身是手绘原格，v1 把它当手绘 → 含翻转格的碎渣
 * 全部逃过；v2 只认「手绘且未翻」= 真手绘小岛/湖泊，含之才保留）。
 */
function cleanCoastFragments(
  cells: World['cells'],
  handLand: Uint8Array,
  K: number,
): number {
  const n = cells.length;
  const land = new Uint8Array(n);
  for (const c of cells) land[c.id] = c.height >= 1 ? 1 : 0;
  let fixed = 0;
  const isHandKept = (i: number, want: number) => handLand[i] === want; // 手绘原侧==当前侧 = 真手绘
  // 先毛刺翻转（≥5 异侧邻居孤刺，手绘未翻格豁免）——它会造出新碎块，
  // 所以连通域清理必须放**其后**（顺序颠倒会残留碎块 = 2026-10-06「还是碎」的原因之一）
  {
    const seenM = new Uint8Array(n);
    void seenM;
    for (const c of cells) land[c.id] = c.height >= 1 ? 1 : 0;
    const flipM = new Int8Array(n);
    for (const c of cells) {
      const i = c.id;
      if (isHandKept(i, land[i])) continue;
      let opp = 0;
      for (const j of c.neighbors) if (land[j] !== land[i]) opp++;
      if (opp >= 5) flipM[i] = land[i] ? -1 : 1;
    }
    for (const c of cells) {
      if (flipM[c.id] === -1) { cells[c.id].height = -1; cells[c.id].isOcean = true; fixed++; }
      else if (flipM[c.id] === 1) { cells[c.id].height = 1; cells[c.id].isOcean = false; fixed++; }
    }
  }
  // 陆侧：非手绘来源的小陆块 → 海
  for (const c of cells) land[c.id] = c.height >= 1 ? 1 : 0;
  const seen = new Uint8Array(n);
  for (const c of cells) {
    if (!land[c.id] || seen[c.id]) continue;
    const comp: number[] = [];
    let hasHand = false;
    const stack = [c.id];
    seen[c.id] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      if (isHandKept(i, 1)) hasHand = true;
      for (const j of cells[i].neighbors) {
        if (land[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (!hasHand && comp.length < K) {
      for (const i of comp) { cells[i].height = -1; cells[i].isOcean = true; fixed++; }
    }
  }
  // 海侧：非手绘来源的小水洼 → 陆
  for (const c of cells) land[c.id] = c.height >= 1 ? 1 : 0;
  const seen2 = new Uint8Array(n);
  for (const c of cells) {
    if (land[c.id] || seen2[c.id]) continue;
    const comp: number[] = [];
    let hasHand = false;
    const stack = [c.id];
    seen2[c.id] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      if (isHandKept(i, 0)) hasHand = true;
      for (const j of cells[i].neighbors) {
        if (!land[j] && !seen2[j]) { seen2[j] = 1; stack.push(j); }
      }
    }
    if (!hasHand && comp.length < K) {
      for (const i of comp) { cells[i].height = 1; cells[i].isOcean = false; fixed++; }
    }
  }
  return fixed;
}

/**
 * 直接写 cells.height / isOcean；返回变更格数（0 = 无可依据骨架）。
 * 调用方负责快照 → HeightCellsCommand 入栈 → flushHeightRegions。
 */
export function refineHeight(world: World, opts: RefineOpts): number {
  const cells = world.cells;
  const n = cells.length;
  if (!n) return 0;

  // ① 手绘骨架 / 域
  const h0 = new Int16Array(n);
  const land = new Uint8Array(n);
  let anyLand = false;
  for (const c of cells) {
    h0[c.id] = c.height;
    land[c.id] = c.height >= 1 ? 1 : 0;
    if (land[c.id]) anyLand = true;
  }
  if (!anyLand) return 0; // 纯海：没有绘制出大陆骨架 → 不动

  // ② 同源完整形态场（与 buildTerrain 同链：含热侵蚀/去尖刺）
  const f = terrainFieldFor(cells, opts.seed, opts.shape);

  // ③ 护岸关（默认）：岸线按形态场在 ±1 格内微调——逐岸格与**最近异侧岸格**比 f：
  //    陆格低于对岸（对岸地形更高）→ 让给海；海格高于对岸 → 并给陆。
  //    用旧 land 快照并行判定（只翻一层、不传播；面积近似保持 =「大致」）。
  //    **手绘小域（<30 格）整体豁免**（2026-10-06「还是碎」修：翻转圈会吞掉手绘
  //    小岛并连成大块逃过清理——小岛/小湖锁定，大陆边缘照常微调）。
  if (!opts.protectCoast) {
    const domSize = new Int32Array(n).fill(0);
    {
      const seenD = new Uint8Array(n);
      for (const c of cells) {
        if (seenD[c.id]) continue;
        const comp: number[] = [];
        const stack = [c.id];
        seenD[c.id] = 1;
        while (stack.length) {
          const i = stack.pop()!;
          comp.push(i);
          for (const j of cells[i].neighbors) {
            if (land[j] === land[i] && !seenD[j]) { seenD[j] = 1; stack.push(j); }
          }
        }
        const sz = comp.length;
        for (const i of comp) domSize[i] = sz;
      }
    }
    const flip = new Int8Array(n); // 1 = 变陆, -1 = 变海
    for (const c of cells) {
      const i = c.id;
      if (domSize[i] < 30) continue; // 手绘小岛/小湖不参与微调
      let oppMax = -Infinity;
      let hasOpp = false;
      for (const j of c.neighbors) {
        if (land[j] !== land[i]) { hasOpp = true; if (f[j] > oppMax) oppMax = f[j]; }
      }
      if (!hasOpp) continue;
      if (land[i]) {
        if (f[i] < oppMax) flip[i] = -1;
      } else {
        let oppMin = Infinity;
        for (const j of c.neighbors) if (land[j] !== land[i] && f[j] < oppMin) oppMin = f[j];
        if (f[i] > oppMin) flip[i] = 1;
      }
    }
    for (const c of cells) {
      if (flip[c.id] === 1) land[c.id] = 1;
      else if (flip[c.id] === -1) land[c.id] = 0;
    }
  }

  // ④ 边界值延拓 u：BFS 最近岸值+同域距离 d（同域）→ 同域均值平滑若干轮
  //    （u|岸 = f|岸 ⇒ h|岸 = 0；u 低频 ⇒ h 保留 f 的全部中高频细节）
  const u = new Float64Array(n);
  const uNext = new Float64Array(n);
  const isBoundary = new Uint8Array(n);
  const dist = new Int32Array(n).fill(-1);
  for (const c of cells) {
    for (const j of c.neighbors) {
      if (land[j] !== land[c.id]) { isBoundary[c.id] = 1; break; }
    }
  }
  {
    const seen = new Uint8Array(n);
    const q: number[] = [];
    for (const c of cells) {
      if (isBoundary[c.id]) { u[c.id] = f[c.id]; seen[c.id] = 1; dist[c.id] = 0; q.push(c.id); }
    }
    for (let head = 0; head < q.length; head++) {
      const i = q[head];
      for (const j of cells[i].neighbors) {
        if (land[j] !== land[i] || seen[j]) continue;
        seen[j] = 1;
        u[j] = u[i];
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
  }
  for (let t = 0; t < SMOOTH_ITERS; t++) {
    for (const c of cells) {
      const i = c.id;
      if (isBoundary[i]) { uNext[i] = u[i]; continue; }
      let sum = 0;
      let cnt = 0;
      for (const j of c.neighbors) {
        if (land[j] !== land[i]) continue;
        sum += u[j];
        cnt++;
      }
      uNext[i] = cnt ? sum / cnt : u[i];
    }
    u.set(uNext);
  }

  // ⑤ h = f − u·w(d)：修正只在近岸带内（w 在 W 格外归零）→ **内陆逐点 = 同源场
  //    原样**（「效果和不基于已有一样」的硬保证）；岸格 w=1 ⇒ h=f−u=0 精确贴岸。
  //    最后陆/海各自 affine 到 [1,64]/[−63,0]（保序，仅整体刻度）。
  const W = 10;
  let lMin = Infinity, lMax = -Infinity, sMin = Infinity, sMax = -Infinity;
  for (const c of cells) {
    const i = c.id;
    const d = dist[i] < 0 ? W : dist[i];
    const w = d >= W ? 0 : 1 - (d / W) * (d / W) * (3 - 2 * (d / W));
    const hv = f[i] - u[i] * w;
    if (land[i]) {
      if (hv < lMin) lMin = hv;
      if (hv > lMax) lMax = hv;
    } else {
      if (hv < sMin) sMin = hv;
      if (hv > sMax) sMax = hv;
    }
  }
  const lSpan = lMax - lMin || 1;
  const sSpan = sMax - sMin || 1;
  let changed = 0;
  for (const c of cells) {
    const i = c.id;
    const d = dist[i] < 0 ? W : dist[i];
    const w = d >= W ? 0 : 1 - (d / W) * (d / W) * (3 - 2 * (d / W));
    const hv = f[i] - u[i] * w;
    let v: number;
    if (land[i]) {
      v = Math.max(1, Math.min(64, Math.round(1 + ((hv - lMin) / lSpan) * 63)));
    } else {
      v = Math.max(-63, Math.min(0, Math.round(-63 + ((hv - sMin) / sSpan) * 63)));
    }
    if (c.height !== v) { c.height = v; changed++; }
    c.isOcean = isOcean({ height: v });
  }

  // ⑥ 海岸碎渣清理（不含手绘原格的 <4 格连通碎块归并）
  const handLand = new Uint8Array(n);
  for (const c of cells) handLand[c.id] = h0[c.id] >= 1 ? 1 : 0;
  changed += cleanCoastFragments(cells, handLand, 30);

  return changed;
}
