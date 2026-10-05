/**
 * 高度绘制（v2 语义，2026-09-27 用户定）：
 * **先在工作区选定高度值（区间型元素配滑块），笔刷只把这一个值写入 cell**。
 * 旧的整数档位步进（落下赋 min / 再点 +1 / Shift±档 / Alt=0）整体移除。
 *
 * 按钮：左键 = 写入选定值；右键 = 擦除为 0（海平面）。
 * 元素↔值：区间型元素（如远海 [lo,hi]）用滑块在区间内取值；单值型元素不需要滑块。
 */
import type { CellId, World } from '../types';
import { isOcean } from '../types';
import { clampHeight, HEIGHT_INTERVALS } from '../layer/heightIntervals';

export interface HeightChange {
  id: CellId;
  from: number;
  to: number;
}

/**
 * 对命中集写入指定高度（erase=true 写 0）；返回实际变更。
 * 只改数据——归属/件环重算在 commitStroke 一次完成（绘制模型：拖动中色块高亮、松手重算）。
 */
export function setHeightStroke(
  world: World,
  cellIds: CellId[],
  value: number,
  erase = false,
): HeightChange[] {
  const target = erase ? 0 : clampHeight(value);
  const out: HeightChange[] = [];
  for (const id of cellIds) {
    const c = world.cells[id];
    if (!c) continue;
    const from = clampHeight(c.height);
    if (from === target) continue;
    c.height = target;
    c.isOcean = isOcean({ height: target });
    out.push({ id, from, to: target });
  }
  return out;
}

/**
 * 平滑笔刷（2026-10-06 用户拍板 2a：强度=迭代 1/3/5；3=海岸保护开关）：
 * 刷内格做**同侧**图拉普拉斯迭代 `h ← h + λ·feather·Σ(h_j−h_i)`——
 * 拉普拉斯不动常数区（平原内部零变化），只把有台阶的地方抹成缓坡；
 * feather = 刷内邻居占比（拓扑软边，刷缘不产生新台阶）；护岸开 = 只同侧邻居参与
 * + 侧 clamp（陆≥1/海≤0，海岸轮廓不动）；关 = 自由扩散（可把海岸抹平）。
 * 快照由 paint() 首触收集（HeightCellsCommand samples 自动含本函数变更）。
 */
export function smoothHeightBrush(
  world: World,
  inBrush: CellId[],
  iters: number,
  protectCoast: boolean,
): void {
  if (!inBrush.length || iters <= 0) return;
  const cells = world.cells;
  const ids = inBrush;
  const m = ids.length;
  const cur = new Float64Array(m);
  const side = new Uint8Array(m);
  const feather = new Float64Array(m);
  const idx = new Map<CellId, number>();
  for (let i = 0; i < m; i++) {
    const c = cells[ids[i]];
    if (!c) continue;
    idx.set(ids[i], i);
    cur[i] = c.height;
    side[i] = c.height >= 1 ? 1 : 0;
  }
  const LAMBDA = 0.9; // 每轮向刷内邻居均值靠拢上限（feather 加权后 ≤1）
  for (let i = 0; i < m; i++) {
    const c = cells[ids[i]];
    if (!c || !c.neighbors.length) { feather[i] = 1; continue; }
    let inCnt = 0;
    for (const j of c.neighbors) if (idx.has(j)) inCnt++;
    feather[i] = inCnt / c.neighbors.length;
  }
  let buf = cur;
  let next = new Float64Array(m);
  for (let t = 0; t < iters; t++) {
    for (let i = 0; i < m; i++) {
      const c = cells[ids[i]];
      if (!c) { next[i] = buf[i]; continue; }
      let sum = 0;
      let cnt = 0;
      for (const j of c.neighbors) {
        const ji = idx.get(j);
        // 邻居侧：刷内用初始侧快照，刷外用当前值的侧（护岸判定同一口径）
        const jSide = ji !== undefined ? side[ji] : cells[j].height >= 1 ? 1 : 0;
        if (protectCoast && jSide !== side[i]) continue;
        sum += ji !== undefined ? buf[ji] : cells[j].height;
        cnt++;
      }
      if (!cnt) { next[i] = buf[i]; continue; }
      // 归一化均值式（与 graphDiffuse 同核）：w=λ·feather≤1 → 凸组合恒稳定、保侧；
      // 显式式 h+λΣ 在 λ·度>1 会过冲（实测 0.4×6 曾反拉到 64，2026-10-06 修）
      const w = LAMBDA * feather[i];
      next[i] = buf[i] + w * (sum / cnt - buf[i]);
    }
    const tmp = buf;
    buf = next;
    next = tmp;
  }
  for (let i = 0; i < m; i++) {
    const c = cells[ids[i]];
    if (!c) continue;
    let v = clampHeight(Math.round(buf[i]));
    if (protectCoast) v = side[i] ? Math.max(1, Math.min(64, v)) : Math.max(-63, Math.min(0, v));
    if (v === c.height) continue;
    c.height = v;
    c.isOcean = isOcean({ height: v });
  }
}

export function heightIntervalList() {
  return HEIGHT_INTERVALS;
}
