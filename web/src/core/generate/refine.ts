/**
 * 基于已有高度图的细化（2026-10-06 用户拍板方案 b）+ 同侧拉普拉斯核（平滑笔刷共用）。
 *
 * 三步管线（不变量：**海陆 mask 逐格不变**——h≥1 集合前后相等）：
 * 1. **同侧扩散梯度化**：cell 图（neighbors 拓扑单源）拉普拉斯迭代，只允许同海陆侧
 *    邻居参与 → 凸组合保侧（陆值∈[1,64] 凸组合仍在内）→ 粗档（顶峰/平原/海洋/深海）
 *    晕染成连续坡 = 档间自动长出中间层；
 * 2. **细节注入**：球面 unitOf→域旋转→fbm 细节 + ridged 山系混合（与 buildTerrain 同
 *    姿势、同噪声单源）；振幅按**距海距离** smoothstep 归零于贴边（边界格不加噪）；
 * 3. **硬收口**：侧 clamp（陆≥1、海≤0）+ clampHeight + round。
 * 同 seed 同输入同输出（项目确定性规则）。
 */
import type { World, CellId } from '../types';
import { clampHeight } from '../layer/heightIntervals';
import { fbm, ridged, unitOf, smoothstep } from '../terrain';

export interface RefineOpts {
  seed: number;
  /** 细节量 0..1（= 地形旋钮 detail，拍板 b 映射 fBm 振幅） */
  detail: number;
  /** 山脉强度 0..1（= 旋钮 mountain，映射 ridged 混合权重） */
  mountain: number;
}

/**
 * 同侧拉普拉斯扩散（Jacobi：每轮读上一轮，确定性）。
 * **归一化均值式** `h ← (1−λ)h + λ·mean(同侧邻居)`：λ≤1 时无条件稳定且是凸组合
 * （显式式 h+λΣ(h_j−h_i) 在 λ·度>1 时会过冲震荡——实测 λ=0.4×6=2.4 曾把带边格
 * 反拉到 64，2026-10-06 修）；凸组合保侧 → 陆∈[1,64]/海∈[-63,0] 闭区间不越界。
 * 返回新数组，不写 world。
 */
export function graphDiffuse(
  world: World,
  h: Float64Array,
  isLand: Uint8Array,
  iters: number,
  lambda: number,
  sameSideOnly: boolean,
): Float64Array {
  const cells = world.cells;
  let cur: Float64Array<ArrayBufferLike> = h;
  let next: Float64Array<ArrayBufferLike> = new Float64Array(h.length);
  for (let t = 0; t < iters; t++) {
    for (const c of cells) {
      const i = c.id;
      let sum = 0;
      let cnt = 0;
      for (const j of c.neighbors) {
        if (sameSideOnly && isLand[j] !== isLand[i]) continue;
        sum += cur[j];
        cnt++;
      }
      next[i] = cnt ? cur[i] + lambda * (sum / cnt - cur[i]) : cur[i];
    }
    const tmp = cur;
    cur = next;
    next = tmp;
  }
  return cur;
}

/** 各格到「异侧邻居」的图距离（同侧 BFS，边界格=1）；无异侧邻居（纯陆/纯海图）= 大数 */
export function distToOppositeSide(world: World, isLand: Uint8Array): Int32Array {
  const n = world.cells.length;
  const dist = new Int32Array(n).fill(-1);
  const q: CellId[] = [];
  for (const c of world.cells) {
    for (const j of c.neighbors) {
      if (isLand[j] !== isLand[c.id]) {
        if (dist[c.id] < 0) {
          dist[c.id] = 1;
          q.push(c.id);
        }
        break;
      }
    }
  }
  for (let head = 0; head < q.length; head++) {
    const i = q[head];
    for (const j of world.cells[i].neighbors) {
      if (isLand[j] === isLand[i] && dist[j] < 0) {
        dist[j] = dist[i] + 1;
        q.push(j);
      }
    }
  }
  for (let i = 0; i < n; i++) if (dist[i] < 0) dist[i] = 1 << 20;
  return dist;
}

/**
 * 细化已有高度图（直接写 cells.height；调用方负责快照/失效/入栈）。
 * 返回变更格数（0 = 无变化）。
 */
export function refineHeight(world: World, opts: RefineOpts): number {
  const cells = world.cells;
  const n = cells.length;
  if (!n) return 0;
  const h0 = new Float64Array(n);
  const isLand = new Uint8Array(n);
  let anyLand = false;
  for (const c of cells) {
    h0[c.id] = c.height;
    isLand[c.id] = c.height >= 1 ? 1 : 0;
    if (isLand[c.id]) anyLand = true;
  }
  // 纯空图（无陆）细化无意义 → 不动
  if (!anyLand) return 0;

  // ① 同侧扩散：粗档 → 连续坡（凸组合保侧）
  const diffused = graphDiffuse(world, h0, isLand, 8, 0.5, true);

  // ② 细节注入：与 buildTerrain 同姿势（unitOf→域旋转→fbm/ridged）
  const d = Math.max(0, Math.min(1, opts.detail));
  const mu = Math.max(0, Math.min(1, opts.mountain));
  const ampLand = 2 + 9 * d;
  const ampSea = 1 + 4 * d;
  const dist = distToOppositeSide(world, isLand);
  let changed = 0;
  for (const c of cells) {
    const i = c.id;
    const p0 = unitOf(c.center.lon, c.center.lat);
    const n1 = fbm(p0.x * 11, p0.y * 11, p0.z * 11, opts.seed + 501, 4);
    const r1 = ridged(p0.x * 3.4, p0.y * 3.4, p0.z * 3.4, opts.seed + 301, 5) - 0.5;
    // 贴边守卫：边界格（d=1）不加噪 → 海岸轮廓由扩散+侧 clamp 双保险
    const g = smoothstep(1, 4, dist[i]);
    let v: number;
    if (isLand[i]) {
      v = diffused[i] + g * ampLand * ((1 - 0.6 * mu) * n1 + mu * r1);
      v = Math.max(1, Math.min(64, v));
    } else {
      v = diffused[i] + g * ampSea * n1;
      v = Math.max(-63, Math.min(0, v));
    }
    const hv = clampHeight(Math.round(v));
    if (hv !== c.height) {
      c.height = hv;
      changed++;
    }
  }
  return changed;
}
