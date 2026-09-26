/**
 * 高度绘制：整数场 + 12 档迁移。
 *
 * 左键落下 = 当前档 min；左键长按/再点 = +1
 * Shift+左 = 升 1 档；右键 = −1；Shift+右 = 降 1 档；Alt+左 = 0
 * 跨档自动换元素（由 cell.height 派生）。
 */
import type { CellId, World } from '../types';
import { isOcean } from '../types';
import {
  clampHeight,
  heightToIntervalIndex,
  setHeightToInterval,
  stepHeight,
  stepLevel,
  HEIGHT_INTERVALS,
} from '../layer/heightIntervals';

export type HeightDrawOp =
  | { kind: 'setInterval'; intervalId: string }
  | { kind: 'step'; delta: 1 | -1 }
  | { kind: 'stepLevel'; dir: 1 | -1 }
  | { kind: 'set'; value: number };

export interface HeightDrawInput {
  cellIds: CellId[];
  pointer: 'left' | 'right';
  phase: 'down' | 'move' | 'up' | 'hold';
  shift: boolean;
  alt: boolean;
  /** 当前工作区间（落下赋 min） */
  intervalId: string;
  /** 本笔刷会话里已经碰过的 cell（再碰 = step） */
  touched: Set<CellId>;
}

export interface HeightChange {
  id: CellId;
  from: number;
  to: number;
}

export function resolveHeightOp(input: HeightDrawInput): HeightDrawOp {
  const { pointer, shift, alt, intervalId, phase, touched, cellIds } = input;
  if (alt && pointer === 'left') return { kind: 'set', value: 0 };
  if (shift && pointer === 'left') return { kind: 'stepLevel', dir: 1 };
  if (shift && pointer === 'right') return { kind: 'stepLevel', dir: -1 };
  // 落下：未碰过的 cell 赋档 min；已碰过的 +1/−1
  // hold/move：一律 step
  const allTouched = phase === 'down' && cellIds.length > 0 && cellIds.every((id) => touched.has(id));
  if (phase === 'hold' || phase === 'move' || allTouched) {
    return { kind: 'step', delta: pointer === 'left' ? 1 : -1 };
  }
  if (pointer === 'right') return { kind: 'step', delta: -1 };
  return { kind: 'setInterval', intervalId };
}

export function applyHeightOp(
  world: World,
  cellId: CellId,
  op: HeightDrawOp,
  intervalId: string,
): HeightChange | null {
  const c = world.cells[cellId];
  if (!c) return null;
  const from = clampHeight(c.height);
  let to = from;
  switch (op.kind) {
    case 'setInterval':
      to = setHeightToInterval(from, intervalId);
      break;
    case 'step':
      to = stepHeight(from, op.delta);
      break;
    case 'stepLevel':
      to = stepLevel(from, op.dir);
      break;
    case 'set':
      to = clampHeight(op.value);
      break;
  }
  if (to === from) {
    c.height = from;
    c.isOcean = isOcean({ height: from });
    return null;
  }
  c.height = to;
  c.isOcean = isOcean({ height: to });
  return { id: cellId, from, to: to };
}

/** 对笔刷命中集应用；返回变更列表 */
export function heightDrawStroke(
  world: World,
  input: HeightDrawInput,
): HeightChange[] {
  const op = resolveHeightOp(input);
  const out: HeightChange[] = [];
  for (const id of input.cellIds) {
    const ch = applyHeightOp(world, id, op, input.intervalId);
    if (ch) out.push(ch);
    input.touched.add(id);
  }
  return out;
}

export function heightIntervalList() {
  return HEIGHT_INTERVALS;
}

export { heightToIntervalIndex };
