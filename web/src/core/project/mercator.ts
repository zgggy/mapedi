import type { LonLat } from '../types';

/**
 * 数值投影纬度上限（度）。
 * 极冠顶点必须能高于 `FRAME_LAT`(85°) 显示框，否则全被压平到框线。
 * 显示裁剪框 = `render/space.FRAME_LAT`；投影数值上限 = 本常量。
 */
export const PROJ_LAT_MAX = 89.5;

/** Mercator：输入经纬度（度），输出平面坐标，y 向上 */
export function projectMercator(p: LonLat): { x: number; y: number } {
  // 只夹到 89.5°：极冠顶点要能高于外框（85°），否则全被压平
  const lat = Math.max(-PROJ_LAT_MAX, Math.min(PROJ_LAT_MAX, p.lat));
  const x = (p.lon * Math.PI) / 180;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  return { x, y };
}

export function unprojectMercator(x: number, y: number): LonLat {
  const lon = (x * 180) / Math.PI;
  const lat = ((2 * Math.atan(Math.exp(y)) - Math.PI / 2) * 180) / Math.PI;
  return { lon, lat };
}
