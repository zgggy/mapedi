import { GEOM_EPS } from '../tolerances';
import type { LonLat } from '../types';
import { PROJ_LAT_MAX } from './mercator';

export type ProjectionId =
  | 'mercator'
  | 'robinson'
  | 'behrmann'
  | 'aeqd'
  | 'gk'
  | 'globe';

export interface ProjectionParams {
  /** GK 中央经线 */
  centralMeridian: number;
  /** 等距方位中心 */
  aeqdCenter: LonLat;
}

export function defaultProjParams(): ProjectionParams {
  return {
    centralMeridian: 0,
    aeqdCenter: { lon: 0, lat: 20 },
  };
}

export const PROJ_META: Record<
  ProjectionId,
  { name: string; emoji: string }
> = {
  mercator: { name: '墨卡托', emoji: '🗺️' },
  robinson: { name: '罗宾森（两极内收）', emoji: '🧭' },
  behrmann: { name: '贝尔曼', emoji: '📐' },
  aeqd: { name: '等距方位', emoji: '🎯' },
  gk: { name: '墨卡托·中经', emoji: '📏' }, // 原「高斯-克吕格」为克拉索夫斯基残骸（前向 2 对 1 折叠），2026-10-01 换为可逆单带实现
  globe: { name: '球面 3D', emoji: '🌐' },
};

/** Null means the projection has no horizontal world-copy period. */
export function projectionWorldPeriod(id: ProjectionId): number | null {
  if (id === 'mercator' || id === 'globe') return Math.PI * 2;
  if (id === 'behrmann') return Math.PI * 2 * Math.sin(30 * Math.PI / 180);
  return null;
}

/**
 * **水平结构统一真相源**：支持水平回绕的投影一律写成 `x = scale(y)·λ`。
 *
 * - 圆柱族（墨卡托/球面平铺/贝尔曼）：scale 是**常数**（1 / 1 / sin30°）→
 *   经度平移、世界副本、环连续化退化为刚性 x 平移 = 现有行为，零差异。
 * - 伪圆柱（罗宾森）：scale(y) = 0.8487·plen(φ(y))，随纬度内收——透镜轮廓的
 *   半宽在 y 处恰为 `scale(y)·π`，**世界宽度 = 局部周期 scale(y)·2π**：
 *   轮廓、周期副本、平移三者由同一个 scale(y) 派生 → 副本偏移下轮廓自我
 *   复制对齐（相邻副本边重合），这是弧形视口 + 无缝回绕的数学前提。
 * - aeqd/gk：非回绕投影，无水平结构 → null。
 *
 * 消费方（连续化 / 副本 / 平移 / 命中反解）只准经由此函数派生，禁止再散落
 * `projectionWorldPeriod ?? 2π` 常数假设——那正是罗宾森跨缝错位（+0.951）
 * 与平移撕裂的根因。
 */
export function projectionXScale(id: ProjectionId, y: number): number | null {
  switch (id) {
    case 'mercator':
    case 'globe':
      return 1;
    case 'behrmann':
      return Math.sin(30 * D2R);
    case 'robinson':
      return 0.8487 * robinsonPlenAtY(y);
    default:
      return null;
  }
}

/** y 处的世界周期在 x 上的宽度（无回绕投影 → null）。 */
export function projectionPeriodAt(id: ProjectionId, y: number): number | null {
  const s = projectionXScale(id, y);
  return s === null ? null : s * Math.PI * 2;
}

/** 是否支持水平回绕（伪圆柱 scale 随 y 变也算——判据不是"周期是否常数"）。 */
export function projectionWraps(id: ProjectionId): boolean {
  return id === 'mercator' || id === 'globe' || id === 'behrmann' || id === 'robinson';
}

/** 罗宾森框到 ±90（极点收成半宽线，透镜完整；用户拍板）。其余投影维持 ±85。 */
export function projectionFrameLat(proj: ProjectionId): number {
  return proj === 'robinson' ? 90 : 85;
}

// 罗宾森 PLEN（平行线长度）/ PDFE（距赤道距离），0°..90° 每 5°
export const ROB_PLEN = [1.0, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322];
export const ROB_PDFE = [0.0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0];

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/**
 * 罗宾森：由投影 y 反查纬度再插值 PLEN —— `x = scale(y)·λ` 的 scale 因子核心。
 * 与 `unproject` robinson 分支同一套反查（单一实现，勿复制）。
 */
function robinsonPlenAtY(y: number): number {
  const a = Math.min(1, Math.abs(y) / 1.3523);
  let i = 0;
  while (i < 17 && ROB_PDFE[i + 1] < a) i++;
  const span = ROB_PDFE[i + 1] - ROB_PDFE[i] || 1;
  const t = Math.max(0, Math.min(1, (a - ROB_PDFE[i]) / span));
  return ROB_PLEN[i] + (ROB_PLEN[i + 1] - ROB_PLEN[i]) * t;
}

export function project(
  p: LonLat,
  id: ProjectionId,
  params: ProjectionParams,
): { x: number; y: number } {
  switch (id) {
    case 'mercator': {
      // 夹到 89.5° 而不是 85°：极冠顶点必须能高于外框，否则全被压平到框线
      const lat = Math.max(-PROJ_LAT_MAX, Math.min(PROJ_LAT_MAX, p.lat));
      return {
        x: p.lon * D2R,
        y: Math.log(Math.tan(Math.PI / 4 + (lat * D2R) / 2)),
      };
    }
    case 'behrmann': {
      // 等面积圆柱，标准纬线 30°
      const phi = Math.sin(30 * D2R);
      return {
        x: p.lon * D2R * phi,
        y: Math.sin(p.lat * D2R) / phi,
      };
    }
    case 'robinson': {
      // 罗宾森：伪圆柱——两极「往内收」（极点是半宽线），高纬不再拉伸；
      // 经典 PLEN/PDFE 5° 表 + 线性插值；x = 0.8487·λ·PLEN(φ), y = 1.3523·PDFE(φ)
      const lam = p.lon * D2R;
      const phi = Math.max(-90, Math.min(90, p.lat));
      const a = Math.abs(phi);
      const i = Math.min(17, Math.floor(a / 5));
      const t = (a - i * 5) / 5;
      const plen = ROB_PLEN[i] + (ROB_PLEN[i + 1] - ROB_PLEN[i]) * t;
      const pdfe = ROB_PDFE[i] + (ROB_PDFE[i + 1] - ROB_PDFE[i]) * t;
      return { x: 0.8487 * lam * plen, y: Math.sign(phi) * 1.3523 * pdfe };
    }
    case 'aeqd': {
      const c = params.aeqdCenter;
      const φ = p.lat * D2R;
      const λ = p.lon * D2R;
      const φ1 = c.lat * D2R;
      const λ0 = c.lon * D2R;
      const cosφ = Math.cos(φ);
      const sinφ = Math.sin(φ);
      const cosφ1 = Math.cos(φ1);
      const sinφ1 = Math.sin(φ1);
      const dλ = λ - λ0;
      const cosc = sinφ1 * sinφ + cosφ1 * cosφ * Math.cos(dλ);
      const cAng = Math.acos(Math.max(-1, Math.min(1, cosc)));
      const k = cAng === 0 ? 1 : cAng / Math.sin(cAng);
      const x = k * cosφ * Math.sin(dλ);
      const y = k * (cosφ1 * sinφ - sinφ1 * cosφ * Math.cos(dλ));
      return { x, y };
    }
    case 'gk': {
      // 单带柱面（墨卡托纬 + 相对中央经线的经差）——2026-10-01 替换原「克拉索夫斯基近似」
      // 残骸：旧式 x=artanh(cosφ·sinλ), y=atan(tanφ/cosλ) 关于 (φ,λ)↔(−φ,π−λ) 2 对 1 折叠
      // （渲染重叠 + 逆解无解）。本实现注入、逆解闭式，且尊重 params.centralMeridian
      // （mercator 分支不带中经线偏移，故本项保留区分价值）。
      const λ = (p.lon - params.centralMeridian) * D2R;
      const φ = p.lat * D2R;
      const sinφ = Math.max(-1 + 1e-15, Math.min(1 - 1e-15, Math.sin(φ)));
      return { x: λ, y: 0.5 * Math.log((1 + sinφ) / (1 - sinφ)) };
    }
    case 'globe':
      // 2D 视图下 globe 退化为 equirect
      return { x: p.lon * D2R, y: p.lat * D2R };
    default:
      // 未知投影必须有返回值，禁止 fall-through 导致 undefined.y
      return { x: p.lon * D2R, y: p.lat * D2R };
  }
}

export function unproject(
  x: number,
  y: number,
  id: ProjectionId,
  params: ProjectionParams,
): LonLat {
  switch (id) {
    case 'mercator': {
      const lon = x * R2D;
      const lat = (2 * Math.atan(Math.exp(y)) - Math.PI / 2) * R2D;
      return { lon, lat };
    }
    case 'behrmann': {
      const phi = Math.sin(30 * D2R);
      const lon = (x / phi) * R2D;
      const lat = Math.asin(Math.max(-1, Math.min(1, y * phi))) * R2D;
      return { lon, lat };
    }
    case 'robinson': {
      const a = Math.abs(y) / 1.3523;
      let i = 0;
      while (i < 17 && ROB_PDFE[i + 1] < a) i++;
      const span = ROB_PDFE[i + 1] - ROB_PDFE[i] || 1;
      const t = Math.max(0, Math.min(1, (a - ROB_PDFE[i]) / span));
      const phi = (i + t) * 5 * Math.sign(y || 1);
      const plen = robinsonPlenAtY(y); // 与 scale 因子同源（单一反查）
      const lam = plen > 1e-9 ? x / (0.8487 * plen) : 0;
      return { lon: lam * R2D, lat: phi };
    }
    case 'aeqd': {
      const c = params.aeqdCenter;
      const φ1 = c.lat * D2R;
      const λ0 = c.lon * D2R;
      const ρ = Math.hypot(x, y);
      if (ρ < GEOM_EPS) return { ...c };
      const cAng = ρ;
      const sinC = Math.sin(cAng);
      const cosC = Math.cos(cAng);
      const φ = Math.asin(cosC * Math.sin(φ1) + (y * sinC * Math.cos(φ1)) / ρ);
      const λ =
        λ0 +
        Math.atan2(
          x * sinC,
          ρ * Math.cos(φ1) * cosC - y * Math.sin(φ1) * sinC,
        );
      return { lon: λ * R2D, lat: φ * R2D };
    }
    case 'gk': {
      // 与 project 精确互逆：λ = x，φ = asin(tanh y)
      const lon = x * R2D + params.centralMeridian;
      const lat = Math.asin(Math.tanh(y)) * R2D;
      return { lon, lat };
    }
    case 'globe':
      return { lon: x * R2D, lat: y * R2D };
  }
}
