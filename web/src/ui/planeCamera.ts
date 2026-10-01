/**
 * 平面相机运算（还债步骤 5-b3，2026-10-01）：Viewport 内嵌的相机数学抽为纯函数——
 * 坐标原语本已在 render/space.ts 与 render/map2d.ts（MapTransform 早已成形），
 * 本模块收编的是**手势运算与 C7 露出反解**：滚轮锚点缩放、拖动增量、
 * 可见副本挑选、遮挡区反解、露出补间。全部无 DOM/无组件态 → 独立可测。
 * 手势监听与绘制/路径状态机留在 Viewport（事件边界不动）。
 */
import { screenToWorld, type Camera } from '../render/map2d';
import {
  contentOffsetAt,
  worldCopyKs,
  worldToScreenX,
  worldToScreenY,
} from '../render/space';
import { projectionXScale, type ProjectionId } from '../core/project/projections';

export const CAM_SCALE_MIN = 40;
export const CAM_SCALE_MAX = 4000;

/**
 * 滚轮缩放（锚定光标）：先取光标下世界点，改 scale 后重解同屏点，
 * 差值回写 cam → 缩放中心恒为光标位置。
 */
export function zoomCamAt(
  cam: Camera,
  factor: number,
  sx: number,
  sy: number,
  w: number,
  h: number,
): Camera {
  const before = screenToWorld(cam, sx, sy, w, h);
  const scale = Math.max(CAM_SCALE_MIN, Math.min(CAM_SCALE_MAX, cam.scale * factor));
  const next: Camera = { ...cam, scale };
  const after = screenToWorld(next, sx, sy, w, h);
  return { ...next, x: next.x + (before.x - after.x), y: next.y + (before.y - after.y) };
}

/** 中键相机拖动：屏幕像素 → 相机增量（不 wrap cam.x——wrap 会把相机扔回 [-π,π] 瞬移） */
export function panCam(cam: Camera, dx: number, dy: number): Camera {
  return { ...cam, x: cam.x - dx / cam.scale, y: cam.y + dy / cam.scale };
}

/**
 * 右键内容平移增量（构图摆放，与改相机是两个概念，C2）：
 * Δλ 使内容位移 scale(cam.y)·Δλ，除以相机纬度 scale → 拖动跟手；
 * 墨卡托 projectionXScale=1 退化为原行为。
 */
export function contentPanDeltaX(
  dx: number,
  cam: Camera,
  projection: ProjectionId,
): number {
  const sRef = projectionXScale(projection, cam.y) ?? 1;
  return dx / (cam.scale * sRef);
}

/**
 * C7 露出：挑**可见副本**的 drawDx（2026-10-01 用户反馈——右键平移整圈后
 * 可见副本是 k≠0 那份）。取渲染同口径可见 k 集（worldCopyKs）扩 k±1（元素级
 * 绘制口径），在候选中选离相机最近的一份；非回绕投影恒 [0] 走原路。
 */
export function bestDrawDxFor(
  projection: ProjectionId,
  x: number,
  y: number,
  contentOffsetX: number,
  cam: Camera,
  wpx: number,
): number {
  let drawDx = contentOffsetAt(projection, y, contentOffsetX);
  const ks = worldCopyKs(contentOffsetX, cam, wpx, projection);
  if (ks.length > 1 || (ks[0] ?? 0) !== 0) {
    const cand = new Set<number>();
    for (const k of ks) {
      cand.add(k - 1);
      cand.add(k);
      cand.add(k + 1);
    }
    let best = drawDx;
    let bestD = Infinity;
    for (const k of cand) {
      const d = contentOffsetAt(projection, y, contentOffsetX + k * Math.PI * 2);
      const dist = Math.abs(x + d - cam.x);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    drawDx = best;
  }
  return drawDx;
}

/**
 * C7 露出反解：可见区=减左轨(railW)/顶8/底状态栏48；越界维度才修
 * （未遮挡维度不动，避免多余平移）。返回 null = 已在可见区内。
 * 反解式：sx=(x+drawDx-cam.x)·scale+w/2；sy=-(y-cam.y)·scale+h/2。
 */
export function revealCamTarget(
  cam: Camera,
  x: number,
  y: number,
  drawDx: number,
  wpx: number,
  hpx: number,
  railW: number,
): { tx: number; ty: number } | null {
  const sx = worldToScreenX(x, cam, wpx, drawDx);
  const sy = worldToScreenY(y, cam, hpx);
  const L = railW + 16;
  const R = wpx - 8;
  const T = 8;
  const B = hpx - 48;
  if (sx >= L && sx <= R && sy >= T && sy <= B) return null;
  let tx = cam.x;
  let ty = cam.y;
  if (sx < L || sx > R) tx = x + drawDx - ((L + R) / 2 - wpx / 2) / cam.scale;
  if (sy < T || sy > B) ty = y + ((T + B) / 2 - hpx / 2) / cam.scale;
  if (tx === cam.x && ty === cam.y) return null;
  return { tx, ty };
}

/**
 * 露出补间：180ms easeOutCubic 从 (fx,fy) 到 (tx,ty)，每帧 apply 写 cam。
 * 返回 cancel。**渲染是命令式驱动：只改 cam 不会自动重绘**（调用方在 apply 里 requestRender）。
 */
export function startCamTween(
  fx: number,
  fy: number,
  tx: number,
  ty: number,
  apply: (x: number, y: number) => void,
): () => void {
  const t0 = performance.now();
  let raf = 0;
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / 180);
    const e = 1 - (1 - k) ** 3; // easeOutCubic
    apply(fx + (tx - fx) * e, fy + (ty - fy) * e);
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}
