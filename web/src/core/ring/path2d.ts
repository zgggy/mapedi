/**
 * Path2D 缓存壳：几何只在 `hermite.appendMidRing`。
 */
import type { MidRing, DisplayRing } from './displayRing';
import { toDisplayRing } from './displayRing';
import { appendMidRing } from './hermite';
import { unwrapXAgainst } from '../../render/space';

const ringPaths = new WeakMap<object, Map<string, Path2D>>();
const cellPaths = new WeakMap<object, Map<number, Path2D>>();

function hasPath2D(): boolean {
  return typeof Path2D !== 'undefined';
}

function pathKey(smooth: number): string {
  return smooth.toFixed(2);
}

export function ringPath2D(
  ring: MidRing | DisplayRing,
  smooth = 0.65,
  mode: 'fill' | 'outline' = 'fill',
): Path2D | null {
  if (!hasPath2D()) return null;
  const key = `${mode}:${pathKey(smooth)}`;
  let bySmooth = ringPaths.get(ring as object);
  if (!bySmooth) {
    bySmooth = new Map();
    ringPaths.set(ring as object, bySmooth);
  }
  const hit = bySmooth.get(key);
  if (hit) return hit;
  const d = toDisplayRing(ring);
  if (!d) return null;
  const path = new Path2D();
  if (!appendMidRing(path, d, smooth, mode)) return null;
  bySmooth.set(key, path);
  return path;
}

export function cellPolyPath2D(
  owner: object,
  cellId: number,
  xy: Float64Array | number[],
  polarOutline = false,
  period = Math.PI * 2,
): Path2D | null {
  if (!hasPath2D()) return null;
  let byId = cellPaths.get(owner);
  if (!byId) {
    byId = new Map();
    cellPaths.set(owner, byId);
  }
  const hit = byId.get(cellId);
  if (hit) return hit;
  const path = new Path2D();
  if (xy.length >= 2) {
    path.moveTo(xy[0], xy[1]);
    for (let i = 2; i < xy.length; i += 2) path.lineTo(xy[i], xy[i + 1]);
    if (polarOutline) {
      // The last polygon edge meets the first point in the adjacent world copy.
      path.lineTo(unwrapXAgainst(xy[xy.length - 2], xy[0], period), xy[1]);
    } else {
      const dx = xy[0] - xy[xy.length - 2];
      if (Math.abs(dx) <= Math.PI * 0.9) path.closePath();
    }
  }
  byId.set(cellId, path);
  return path;
}
