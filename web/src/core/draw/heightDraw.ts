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

export function heightIntervalList() {
  return HEIGHT_INTERVALS;
}
