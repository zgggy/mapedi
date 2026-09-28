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
  gk: { name: '高斯-克吕格', emoji: '📏' },
  globe: { name: '球面 3D', emoji: '🌐' },
};

/** Null means the projection has no horizontal world-copy period. */
export function projectionWorldPeriod(id: ProjectionId): number | null {
  if (id === 'mercator' || id === 'globe') return Math.PI * 2;
  if (id === 'behrmann') return Math.PI * 2 * Math.sin(30 * Math.PI / 180);
  return null;
}

// 罗宾森 PLEN（平行线长度）/ PDFE（距赤道距离），0°..90° 每 5°
const ROB_PLEN = [1.0, 0.9986, 0.9954, 0.99, 0.9822, 0.973, 0.96, 0.9427, 0.9216, 0.8962, 0.8679, 0.835, 0.7986, 0.7597, 0.7186, 0.6732, 0.6213, 0.5722, 0.5322];
const ROB_PDFE = [0.0, 0.062, 0.124, 0.186, 0.248, 0.31, 0.372, 0.434, 0.4958, 0.5571, 0.6176, 0.6769, 0.7346, 0.7903, 0.8435, 0.8936, 0.9394, 0.9761, 1.0];

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

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
      // 单带：横轴墨卡托近似（中央经线 params.centralMeridian）
      const λ = (p.lon - params.centralMeridian) * D2R;
      const φ = p.lat * D2R;
      const B = Math.cos(φ) * Math.sin(λ);
      // 克拉索夫斯基近似用简单公式
      const x = 0.5 * Math.log((1 + B) / (1 - B));
      const y = Math.atan(Math.tan(φ) / Math.cos(λ));
      return { x, y };
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
      const plen = ROB_PLEN[i] + (ROB_PLEN[i + 1] - ROB_PLEN[i]) * t;
      const lam = plen > 1e-9 ? x / (0.8487 * plen) : 0;
      return { lon: lam * R2D, lat: phi };
    }
    case 'aeqd': {
      const c = params.aeqdCenter;
      const φ1 = c.lat * D2R;
      const λ0 = c.lon * D2R;
      const ρ = Math.hypot(x, y);
      if (ρ < 1e-12) return { ...c };
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
      const φ = Math.atan(Math.sinh(y) * 0 + Math.tan(y) * 1); // 近似
      // y = atan(tan(φ)/cos(λ)) — 无闭式，用迭代少量
      let lam = 0;
      for (let i = 0; i < 8; i++) {
        // x = 0.5 ln((1+B)/(1-B)) => B = tanh(x)
        const B = Math.tanh(x);
        lam = Math.asin(Math.max(-1, Math.min(1, B / Math.max(1e-9, Math.cos(φ)))));
        void lam;
        break;
      }
      const B = Math.tanh(x);
      const λ = Math.asin(Math.max(-1, Math.min(1, B)));
      // y = atan(tan(φ)/cos(λ)) => tan(φ) = tan(y)*cos(λ)
      const phi = Math.atan(Math.tan(y) * Math.cos(λ));
      return { lon: λ * R2D + params.centralMeridian, lat: phi * R2D };
    }
    case 'globe':
      return { lon: x * R2D, lat: y * R2D };
  }
}
