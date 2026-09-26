/**
 * DisplayRing 样条描边辅助。路径只调 `appendMidRing`（hermite.ts）。
 */
import type { MidRing, DisplayRing } from './displayRing';
import { appendMidRing } from './hermite';

export function traceMidRing(
  ctx: CanvasRenderingContext2D,
  ring: MidRing | DisplayRing,
  smooth = 0.65,
): void {
  appendMidRing(ctx, ring, smooth);
}
