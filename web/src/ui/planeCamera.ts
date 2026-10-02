/**
 * 平面相机运算（还债步骤 5-b3，2026-10-01）：Viewport 内嵌的相机数学抽为纯函数——
 * 坐标原语本已在 render/space.ts 与 render/map2d.ts（MapTransform 早已成形），
 * 本模块收编的是**手势运算**：滚轮锚点缩放、拖动增量、可见副本挑选。
 * 全部无 DOM/无组件态 → 独立可测。（C7 露出反解/补间已删——2026-10-02 用户拍板
 * 「点击之后镜头对准地图中元素」功能移除。）
 * 手势监听与绘制/路径状态机留在 Viewport（事件边界不动）。
 */
import { screenToWorld, type Camera } from '../render/map2d';
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
