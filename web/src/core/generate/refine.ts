/**
 * 基于已有陆块的**匹配扩散**（2026-10-06 第三次澄清后重写——第二版「新生成场+分位
 * 截取」被否："不再随机绘制，而是基于已有的陆地块进行重新扩散……根据已有的大陆块，
 * 寻找最匹配的扩散起点和扩散参数"）。
 *
 * 管线（结构 **完全由 mask 决定**，非随机场）：
 * 1. 同侧图测地距离场：dLand（陆内格→最近海岸）、dSea（海内格→最近陆地）；
 * 2. **最匹配扩散起点**：每个连通陆块取 argmax dLand（=最大内切点，离岸最厚处 =
 * 峰的唯一自然位置）；大块按面积再做 farthest-point 采样补多峰（确定性 tie-break）；
 * 3. **参数自动匹配**：峰高 ∝ 起点厚度（厚块出高峰）、峰的衰减跨度 span = 该峰
 * 分水岭域内最远格距（多源 BFS 天然给出）——半径/落差都由陆块几何推出，无随机自由度；
 * 4. 多源 BFS（起点集）→ 每格 (最近峰, 测地距 g)，陆内 h = peakH·falloff(g/span)
 *    （单峰递减 ⇒ max 合成 = 最近峰主导，分水岭脊线自然出现）；
 * 5. 海内 h = −63·pow(dSea/max, gamma)（贴岸 0 → 最深 −63，离岸越深）；
 * 6. 结构噪声（中尺度 fbm，打破距离场同心环/锥）+ 微扰（球面 fbm/ridged，seed
 *    相位可复现非随机；贴岸 smoothstep 归零保护轮廓）+ flatness 幂弯；
 * 7. 两级侵蚀（热+粒子水力）按旋钮**增量**生效（默认 2 = 关）。
 * 7. 量程收口：陆 [1,64] 海 [−63,0]、isOcean 同步。
 *
 * 不变量：mask 逐格不变；同 seed 同 shape 同输出；无陆世界 return 0。
 */
import type { World } from '../types';
import { isOcean } from '../types';
import { fbm, ridged, unitOf, smoothstep } from '../terrain';
import type { WorldShape } from '../layer/genTypes';
import { createRng, hashSeed } from '../rng';

export interface RefineOpts {
  seed: number;
  /** 地形旋钮（有效：detail/mountain/seaRugged/flatness；其余由 mask 匹配取代） */
  shape: WorldShape;
}

/** 多源 BFS：sources 标 0，返回到最近源的测地距离 + 归属源 */
function multiBfs(
  world: World,
  pass: (i: number) => boolean, // 可通行（同侧判定）
  sources: number[],
): { dist: Int32Array; owner: Int32Array } {
  const n = world.cells.length;
  const dist = new Int32Array(n).fill(-1);
  const owner = new Int32Array(n).fill(-1);
  const q: number[] = [];
  for (const s of sources) {
    if (dist[s] >= 0) continue;
    dist[s] = 0;
    owner[s] = s;
    q.push(s);
  }
  for (let head = 0; head < q.length; head++) {
    const i = q[head];
    for (const j of world.cells[i].neighbors) {
      if (!pass(j) || dist[j] >= 0) continue;
      dist[j] = dist[i] + 1;
      owner[j] = owner[i];
      q.push(j);
    }
  }
  return { dist, owner };
}

/**
 * ③ 热侵蚀（粗削：陡坡传质——削尖峰、堆坡脚；同侧约束 → mask 不变；
 * 峰格豁免扣减 → 顶峰只接收沉积、始终全局最高，保住「顶峰在最厚起点」断言）。
 * 作用在归一前的 base 连续域（陆 [0,1] / 海 [-1,0] 各自动态）。
 */
function thermalPass(
  world: World,
  h: Float64Array,
  side: Uint8Array,
  isPeak: Set<number>,
  iters: number,
): void {
  if (iters <= 0) return;
  const n = world.cells.length;
  const thr = 0.004;
  for (let t = 0; t < iters; t++) {
    const delta = new Float64Array(n);
    for (const c of world.cells) {
      const i = c.id;
      if (isPeak.has(i)) continue;
      const hv = h[i];
      for (const j of c.neighbors) {
        if (side[j] !== side[i]) continue;
        const d = hv - h[j];
        if (d > thr) {
          const move = (d - thr) * 0.3;
          delta[i] -= move;
          delta[j] += move;
        }
      }
    }
    for (let i = 0; i < n; i++) h[i] += delta[i];
  }
}

/**
 * ③ 粒子水力侵蚀（细刻：水滴沿同侧最邻下冲、沿途渐沉积、停处落扇——
 * 河谷下切 / 山脊细化 / 山脚冲积，行业共识的「自然感」来源；SimpleErosion 简化版）。
 * 同侧移动 + 峰格零侵蚀 → mask 与顶峰断言不破；rng 由 seed 派生 → 确定性。
 */
function hydraulicErode(
  world: World,
  h: Float64Array,
  side: Uint8Array,
  isPeak: Set<number>,
  drops: number,
  rng: () => number,
): void {
  if (drops <= 0) return;
  const cells = world.cells;
  const n = cells.length;
  for (let d = 0; d < drops; d++) {
    let cur = Math.min(n - 1, Math.floor(rng() * n));
    let carry = 0;
    for (let step = 0; step < 32; step++) {
      const c = cells[cur];
      let next = -1;
      let hmin = Infinity;
      for (const j of c.neighbors) {
        if (side[j] !== side[cur]) continue;
        if (h[j] < hmin) { hmin = h[j]; next = j; }
      }
      if (next < 0) break; // 孤立格：外循环统一沉积
      const slope = h[cur] - hmin;
      if (slope <= 0) break; // 平地/上坡：外循环沉积停下
      const e = Math.min(slope * 0.3, 0.5) * 0.18;
      if (!isPeak.has(cur)) { h[cur] -= e; carry += e; }
      const dep = carry * 0.3; // 沿途渐沉积（速度质量简化）
      h[cur] += dep;
      carry -= dep;
      cur = next;
    }
    h[cur] += carry; // 32 步耗尽或提前停：余沙落扇
  }
}

/**
 * 直接写 cells.height / isOcean；返回变更格数（0 = 无可依据海岸线）。
 * 调用方负责快照 → HeightCellsCommand 入栈 → flushHeightRegions。
 */
export function refineHeight(world: World, opts: RefineOpts): number {
  const cells = world.cells;
  const n = cells.length;
  if (!n) return 0;
  const h0 = new Int16Array(n);
  const land = new Uint8Array(n);
  let anyLand = false;
  for (const c of cells) {
    h0[c.id] = c.height;
    land[c.id] = c.height >= 1 ? 1 : 0;
    if (land[c.id]) anyLand = true;
  }
  if (!anyLand) return 0;
  const isLand = (i: number) => land[i] === 1;

  // ① 同侧测地距离场
  //    dLand：源 = 有海邻居的陆格（海岸线）；孤立纯陆图（无海岸）源 = 图边界格
  const coastSrc: number[] = [];
  for (const c of cells) {
    if (!isLand(c.id)) continue;
    let touchesSea = false;
    for (const j of c.neighbors) if (!isLand(j)) { touchesSea = true; break; }
    if (touchesSea) coastSrc.push(c.id);
  }
  if (!coastSrc.length) return 0; // 陆覆盖全图：无海岸可匹配 → 不动（与纯海对称保护）
  const dLand = multiBfs(world, isLand, coastSrc).dist;
  // dSea：源 = 海内有陆邻居的格（海岸的海侧）
  const shoreSea: number[] = [];
  for (const c of cells) {
    if (isLand(c.id)) continue;
    for (const j of c.neighbors) if (isLand(j)) { shoreSea.push(c.id); break; }
  }
  const seaDist = multiBfs(world, (i) => !isLand(i), shoreSea).dist;

  // ② 起点搜索（确定性）：逐连通陆块 argmax dLand；面积 > K_AREA 再 farthest-point 补峰
  const K_AREA = 5000;
  const seen = new Uint8Array(n);
  const peaks: number[] = [];
  for (const c of cells) {
    if (!isLand(c.id) || seen[c.id]) continue;
    // 连通块收集（BFS over land）
    const comp: number[] = [];
    const stack = [c.id];
    seen[c.id] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      for (const j of cells[i].neighbors) if (isLand(j) && !seen[j]) { seen[j] = 1; stack.push(j); }
    }
    const area = comp.length;
    // 首峰 = argmax dLand（tie → 最小 id）
    let p0 = comp[0];
    for (const i of comp) if (dLand[i] > dLand[p0] || (dLand[i] === dLand[p0] && i < p0)) p0 = i;
    const chosen = [p0];
    // 峰密度 = 每 ~5000 格一峰、上限 6（拍脑袋 600 曾给 2.4 万格大陆生成 41 座
    // 尖塔 = 观感灾难，2026-10-06「完全错误」修复之一）
    const K = Math.min(6, Math.max(1, Math.round(area / K_AREA)));
    while (chosen.length < K) {
      // farthest-point：离已选峰测地距离（以 comp 内 dLand 近似“同侧”度量，用多源
      // BFS 的粗略版——直接用与已选峰的 hop 距离由 dLand 不可得，改用坐标欧氏距离
      // 的 farthest（确定性、O(area·K)，块尺度下足够）
      let best = -1;
      let bestD = -1;
      for (const i of comp) {
        let dMin = Infinity;
        for (const p of chosen) {
          const dx = cells[i].center.lon - cells[p].center.lon;
          const dy = cells[i].center.lat - cells[p].center.lat;
          const d = dx * dx + dy * dy;
          if (d < dMin) dMin = d;
        }
        if (dMin > bestD || (dMin === bestD && i < best)) { bestD = dMin; best = i; }
      }
      if (best < 0 || bestD <= 0) break;
      chosen.push(best);
    }
    for (const p of chosen) peaks.push(p);
  }

  // ③ 多源 BFS（起点集）→ 每格 (最近峰, hop 距 g)
  const { dist: gArr, owner } = multiBfs(world, isLand, peaks);
  // 峰高匹配：peakH ∝ 起点厚度 dLand（最厚处最高峰；全局归一到满谱）
  let tMax = 1;
  for (const p of peaks) tMax = Math.max(tMax, dLand[p]);
  const peakH = new Map<number, number>();
  for (const p of peaks) peakH.set(p, dLand[p] / tMax); // (0,1]
  // 峰的衰减跨度 span = 其分水岭域内最远 g（自动匹配块尺度）
  const span = new Map<number, number>();
  for (const p of peaks) span.set(p, 1);
  for (let i = 0; i < n; i++) {
    if (!isLand(i) || gArr[i] < 0) continue;
    const p = owner[i];
    span.set(p, Math.max(span.get(p) ?? 1, gArr[i]));
  }

  // ④ 合成：陆 = peakH·falloff(g/span)；海 = −63·pow(norm, gammaSea)
  const gammaS = 1 + 1.2 * Math.max(0, Math.min(1, opts.shape.flatness));
  let seaMax = 1;
  for (const c of cells) if (!isLand(c.id) && seaDist[c.id] >= 0) seaMax = Math.max(seaMax, seaDist[c.id]);
  const base = new Float64Array(n);
  for (const c of cells) {
    const i = c.id;
    if (isLand(i)) {
      const g = gArr[i] >= 0 ? gArr[i] : 0;
      const sp = span.get(owner[i]) ?? 1;
      const t = Math.max(0, Math.min(1, 1 - g / sp));
      const fall = t * t * (3 - 2 * t); // smoothstep 衰减（厚处高、到分水岭/岸边归低）
      base[i] = (peakH.get(owner[i]) ?? 0.5) * fall;
    } else {
      const d = seaDist[i] >= 0 ? seaDist[i] : seaMax;
      base[i] = -Math.pow(d / seaMax, gammaS); // [-1, 0]，贴岸 0 → 深处 −1
    }
  }

  // ⑤ 微扰（seed 相位可复现；贴岸归零保轮廓）+ 量程收口
  const d0 = Math.max(0, Math.min(1, opts.shape.detail));
  const mu = Math.max(0, Math.min(1, opts.shape.mountain));
  const seaR = Math.max(0, Math.min(1, opts.shape.seaRugged));
  // 起点集合（峰格）：微扰与侵蚀共用
  const peakSet = new Set<number>(peaks);
  for (const c of cells) {
    const i = c.id;
    if (!isLand(i)) continue;
    // 峰顶保护：扩散起点（g=0）不加噪 + 峰域上界 cap → 顶峰唯一落最厚起点
    const isP = peakSet.has(i);
    const cap = peakH.get(owner[i]) ?? 1;
    const p0 = unitOf(c.center.lon, c.center.lat);
    const w = isP ? 0 : smoothstep(1, 4, dLand[i]);
    const n1 = fbm(p0.x * 11, p0.y * 11, p0.z * 11, opts.seed + 501, 4);
    const r1 = ridged(p0.x * 3.4, p0.y * 3.4, p0.z * 3.4, opts.seed + 301, 5) - 0.5;
    // 结构噪声（中尺度）：距离场本质是同心洋葱圈/锥，高频微噪救不了（v3「太差」
    // 的结构性根源）→ 幅度 0.22·detail 的中尺度分量打破同心性（结构层非毛刺层）；
    // 与海侧同种子同分量 → 海岸两侧地形连续
    const s1 = fbm(p0.x * 2.8, p0.y * 2.8, p0.z * 2.8, opts.seed + 701, 4);
    const v = base[i] + w * (0.22 * d0 * s1 + d0 * 0.07 * n1 + mu * 0.12 * r1);
    // 非起点格上界收 1%：防压平后邻格 round 仍到 64 并列（顶峰唯一归起点）
    base[i] = Math.max(0, Math.min(v, isP ? cap : cap * 0.99));
  }

  // ④ 两级侵蚀（2026-10-06 用户拍板 a）：热侵蚀粗削 + 粒子水力细刻——
  //    河谷/山脊/冲积的「自然感」来源；erosion 旋钮 = 强度（0=关）
  // 侵蚀默认关（「完全错误」修复之三）：细化路径 = 旋钮**增量**——常规生成默认 2
  // → 此处 0 不侵蚀（没调旋钮 = 干净的匹配扩散形态）；调到 4/6 → 2/4 逐级增强
  const eIters = Math.max(0, Math.min(4, Math.round(opts.shape.erosion) - 2));
  thermalPass(world, base, land, peakSet, eIters);
  const drops = eIters > 0 ? Math.round(6000 * eIters) : 0;
  if (drops > 0) {
    const rng = createRng(hashSeed(opts.seed, 777));
    hydraulicErode(world, base, land, peakSet, drops, rng);
    // 热侵蚀收尾：把水力刻出的碎尖角/沟壁毛刺再圆一遍（粗削 → 水刻 → 热收尾）
    thermalPass(world, base, land, peakSet, Math.max(2, eIters));
  }
  // 侵蚀后复 cap：峰 ≤cap（沉积可升但封顶）、非峰 ≤cap·0.99 → 唯一 64 断言不破
  for (const c of cells) {
    const i = c.id;
    if (!isLand(i)) continue;
    const cap = peakH.get(owner[i]) ?? 1;
    base[i] = Math.max(0, Math.min(base[i], peakSet.has(i) ? cap : cap * 0.99));
  }

  // ⑤ 量程收口：陆 [1,64]（归一基准=峰 → 唯一 64）；海按侵蚀后实际最深线性铺满 [-63,0]
  let landMax = EPS0;
  for (const c of cells) if (isLand(c.id)) landMax = Math.max(landMax, base[c.id]);
  let seaMin = -EPS0;
  for (const c of cells) if (!isLand(c.id)) seaMin = Math.min(seaMin, base[c.id]);
  let changed = 0;
  for (const c of cells) {
    const i = c.id;
    let v: number;
    if (isLand(i)) {
      const u = landMax > 0 ? base[i] / landMax : 0;
      v = Math.max(1, Math.min(64, Math.round(1 + u * 63)));
    } else {
      const p0 = unitOf(c.center.lon, c.center.lat);
      const w = smoothstep(1, 4, seaDist[i] >= 0 ? seaDist[i] : 0);
      const n1 = fbm(p0.x * 7, p0.y * 7, p0.z * 7, opts.seed + 611, 3);
      const s1 = fbm(p0.x * 2.8, p0.y * 2.8, p0.z * 2.8, opts.seed + 701, 4);
      // base∈[-1,0]：按侵蚀后实际最深线性铺满 → 端点 -63 必达；
      // 结构噪声（与陆侧同分量同种子）打破同心环观感；seaRugged=海侧结构/微扰幅度
      const norm = seaMin < 0 ? Math.pow(base[i] / seaMin, gammaS) : 0;
      const dv = -63 * norm + seaR * 16 * s1 * smoothstep(1, 4, seaDist[i] >= 0 ? seaDist[i] : 0) + w * seaR * 4 * n1;
      v = Math.max(-63, Math.min(0, Math.round(dv)));
    }
    if (c.height !== v) { c.height = v; changed++; }
    c.isOcean = isOcean({ height: v });
  }
  void h0;
  return changed;
}

const EPS0 = 1e-9;
