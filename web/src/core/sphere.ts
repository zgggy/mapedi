import type { LonLat } from './types';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * 球面向量：与 2D 地图**同为北在上**（2026-10-02 用户指正对齐——本函数原按 Canvas
 * +y 向下写 north→−Y，属已归档 Canvas2D 时代约定；three.js +Y 朝画面上方，故翻正）。
 * - 北（+lat）→ +Y（画面上）
 * - 东（+lon）→ +X（画面右；相机面向本初子午线时）
 * - 本初子午线 → +Z（默认镜头看向 lon=0）
 */
export function lonLatToVec3(p: LonLat): [number, number, number] {
  const lon = p.lon * D2R;
  const lat = p.lat * D2R;
  const cl = Math.cos(lat);
  return [cl * Math.sin(lon), Math.sin(lat), cl * Math.cos(lon)];
}

export function vec3ToLonLat(v: [number, number, number]): LonLat {
  const [x, y, z] = v;
  const len = Math.hypot(x, y, z) || 1;
  return {
    lon: Math.atan2(x / len, z / len) * R2D,
    lat: Math.asin(Math.max(-1, Math.min(1, y / len))) * R2D,
  };
}

/** 大圆距离（度） */
export function gcDistanceDeg(a: LonLat, b: LonLat): number {
  const va = lonLatToVec3(a);
  const vb = lonLatToVec3(b);
  const dot = va[0] * vb[0] + va[1] * vb[1] + va[2] * vb[2];
  return Math.acos(Math.max(-1, Math.min(1, dot))) * R2D;
}

/** 球面均匀随机点 */
export function randomLonLat(rng: () => number): LonLat {
  const u = rng() * 2 - 1;
  const lon = rng() * 360 - 180;
  const lat = Math.asin(Math.max(-1, Math.min(1, u))) * R2D;
  return { lon, lat };
}

export function normalizeLon(lon: number): number {
  let x = lon;
  while (x > 180) x -= 360;
  while (x < -180) x += 360;
  return x;
}
