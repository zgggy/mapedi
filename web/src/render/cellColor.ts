/**
 * cell 显示色 = **元素填充色**（Region.color）。
 * 不是独立概念——cell 的颜色就是它所属元素的填充色。
 * 只为 3D 球面纹理服务；2D 地图走 elementsLayer（同一 Region.color）。
 */
import type { World, CellId } from '../core/types';

/** 焦点层的 cell→填充色：来自该层 Region.color（后写覆盖前写，嵌套区间取最内层） */
export function buildFillsForFocus(
  world: World,
  focus: string,
): Map<CellId, string> | undefined {
  const m = new Map<CellId, string>();
  for (const r of world.regions) {
    if (r.layerId !== focus) continue;
    for (const id of r.cells) m.set(id, r.color);
  }
  return m.size ? m : undefined;
}

/** cell 显示色 = 元素填充色；不在任何元素内则用基础色 */
export function cellDisplayColor(
  world: World,
  cellId: number,
  _focus: string,
  fills?: Map<CellId, string>,
): string {
  const hit = fills?.get(cellId);
  if (hit) return hit;
  const cell = world.cells[cellId];
  if (!cell) return '#1a3348';
  return cell.isOcean ? '#1a3348' : '#c4a882';
}
