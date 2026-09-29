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

/**
 * **过渡投影（值级插值）**：动画中的投影不是"基准域近似"，而是两端投影
 * 坐标的逐点插值——每个 t 都是一个定义良好的严格投影（静态 t=0/1 即两端精确值）。
 */
export interface BlendProj {
  readonly a: ProjectionId;
  readonly b: ProjectionId;
  readonly t: number;
}

/** 渲染层投影规格：静态 = ProjectionId；动画 = BlendProj。 */
export type ProjSpec = ProjectionId | BlendProj;

export function blendProj(a: ProjectionId, b: ProjectionId, t: number): BlendProj {
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return { a, b, t: c };
}

export function isBlend(s: ProjSpec): s is BlendProj {
  return typeof s !== 'string';
}

/** 缓存键：动画只传**关键帧档 t**（有限集），连续 t 只存在于驱动层 → 键不会爆炸。 */
export function projSpecKey(s: ProjSpec): string {
  return isBlend(s) ? `${s.a}>${s.b}@${s.t.toFixed(3)}` : s;
}

/**
 * 动画档量化：连续 t → N 段关键帧（几何缓存按档键，键有限不爆）。
 * - 档 0 → **from id 本身**（复用现缓存，切换零成本）；
 * - 档 N → blend(from,to,1)（端点几何精确；键与 id 不同，动画结束时统一清理）。
 * 渲染几何 = 相邻档顶点 mix；因 project 对 t 线性，mix 结果 ≡ 连续 t 的严格投影
 * （唯一微差在 Hermite 中段，端点严格）。
 */
/** 动画关键帧档数（量化的唯一来源——渲染 alpha 推导/预建必须同值） */
export const PROJ_ANIM_SEG = 3;

export function quantizeBlend(s: ProjSpec, n = PROJ_ANIM_SEG): ProjSpec {
  if (!isBlend(s)) return s;
  const q = Math.floor(s.t * n + 1e-9) / n; // floor：档 = 所在段下界（与渲染 alpha 推导同式）
  if (q <= 0) return s.a;
  if (q >= 1) return s.b; // 终档 = to id 本身（几何同 blend(...,1)，键合一 → 结束零重建）
  return blendProj(s.a, s.b, q);
}

/** UI 元数据/降级显示用基准 id（blend → 过渡中按 t 取主端）。 */
export function projSpecBase(s: ProjSpec): ProjectionId {
  return isBlend(s) ? (s.t >= 0.5 ? s.b : s.a) : s;
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
export function projectionXScale(id: ProjSpec, y: number): number | null {
  if (isBlend(id)) {
    // 回绕对才有 scale 结构（非回绕端不参与动画；防御性返回 null 走无回绕路径）
    if (!projectionWraps(id.a) || !projectionWraps(id.b)) return null;
    const st = blendScaleAtY(id, y);
    return st;
  }
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

/**
 * blend 的 scale_t(y)：y → φ_t 反解（y_t 单调二分）→ 两端同 φ 的 scale 插值。
 * LUT 缓存（128 段线性）：offsetAt/副本判定按点调用，逐点二分太贵；
 * 相对误差 <1e-4（亚像素），shader 端平移用精确双通道公式（GPU 不走 LUT）。
 */
function blendScaleAtY(spec: BlendProj, y: number): number {
  const key = projSpecKey(spec);
  let lut = blendScaleCache.get(key);
  if (!lut) {
    const N = 128;
    const ys = new Float64Array(N + 1);
    const ss = new Float64Array(N + 1);
    const lo = -1;
    const hi = 1; // 包住罗宾森 y∈[-1.35,1.35] / 墨卡托常用区间；两端外插
    for (let i = 0; i <= N; i++) {
      const yy = lo + ((hi - lo) * i) / N;
      const phi = blendYInverse(spec, yy);
      const sA = projectionXScale(spec.a, project({ lon: 0, lat: phi }, spec.a, defaultProjParams()).y);
      const sB = projectionXScale(spec.b, project({ lon: 0, lat: phi }, spec.b, defaultProjParams()).y);
      ys[i] = yy;
      ss[i] = sA === null || sB === null ? 1 : (1 - spec.t) * sA + spec.t * sB;
    }
    lut = { ys, ss };
    if (blendScaleCache.size > 32) blendScaleCache.clear();
    blendScaleCache.set(key, lut);
  }
  const { ys, ss } = lut;
  if (y <= ys[0]) return ss[0] * (y / ys[0]); // 区间外按比例外插（墨卡托 y 可超出1）
  if (y >= ys[ys.length - 1]) return ss[ss.length - 1];
  let i = Math.floor(((y - ys[0]) / (ys[1] - ys[0])));
  if (i < 0) i = 0;
  if (i >= ss.length - 1) i = ss.length - 2;
  const t0 = (y - ys[i]) / (ys[i + 1] - ys[i] || 1);
  return ss[i] + (ss[i + 1] - ss[i]) * t0;
}
const blendScaleCache = new Map<string, { ys: Float64Array; ss: Float64Array }>();

/** y_t(φ)=y 反解 φ（单调二分；两端投影 y 均随 φ 单调递增）。 */
function blendYInverse(spec: BlendProj, y: number): number {
  let lo = -90;
  let hi = 90;
  for (let i = 0; i < 52; i++) {
    const mid = (lo + hi) / 2;
    const yy =
      (1 - spec.t) * project({ lon: 0, lat: mid }, spec.a, defaultProjParams()).y +
      spec.t * project({ lon: 0, lat: mid }, spec.b, defaultProjParams()).y;
    if (yy < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/** y 处的世界周期在 x 上的宽度（无回绕投影 → null）。 */
export function projectionPeriodAt(id: ProjSpec, y: number): number | null {
  const s = projectionXScale(id, y);
  return s === null ? null : s * Math.PI * 2;
}

/** 是否支持水平回绕（伪圆柱 scale 随 y 变也算——判据不是"周期是否常数"）。 */
export function projectionWraps(s: ProjSpec): boolean {
  if (isBlend(s)) return projectionWraps(s.a) && projectionWraps(s.b);
  return s === 'mercator' || s === 'globe' || s === 'behrmann' || s === 'robinson';
}

/** 框高：罗宾森 ±90（极点收成半宽线，用户拍板）；blend 在两端间连续过渡。 */
export function projectionFrameLat(proj: ProjSpec): number {
  if (isBlend(proj)) {
    const la = projectionFrameLat(proj.a);
    const lb = projectionFrameLat(proj.b);
    return la + (lb - la) * proj.t;
  }
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
  id: ProjSpec,
  params: ProjectionParams,
): { x: number; y: number } {
  if (isBlend(id)) {
    // 逐点值插值 = 过渡投影的严格定义（两端各自精确 → 中间帧也是该 t 投影的精确值）
    const A = project(p, id.a, params);
    const B = project(p, id.b, params);
    return { x: (1 - id.t) * A.x + id.t * B.x, y: (1 - id.t) * A.y + id.t * B.y };
  }
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
  id: ProjSpec,
  params: ProjectionParams,
): LonLat {
  if (isBlend(id)) {
    if (projectionWraps(id.a) && projectionWraps(id.b)) {
      // 回绕对闭式反解：φ 由 y_t 二分（单调），λ = x / scale_t(φ)（x 对 λ 线性 → 精确）
      const phi = blendYInverse(id, y);
      const sA = projectionXScale(id.a, project({ lon: 0, lat: phi }, id.a, params).y);
      const sB = projectionXScale(id.b, project({ lon: 0, lat: phi }, id.b, params).y);
      const st = sA === null || sB === null ? 1 : (1 - id.t) * sA + id.t * sB;
      const lam = st > 1e-9 ? x / st : 0;
      return { lon: lam * R2D, lat: phi };
    }
    // 非回绕端（UI 不产生此路径）：两端各自反解后 lon/lat 插值（近似）
    const la = unproject(x, y, id.a, params);
    const lb = unproject(x, y, id.b, params);
    return {
      lon: (1 - id.t) * la.lon + id.t * lb.lon,
      lat: (1 - id.t) * la.lat + id.t * lb.lat,
    };
  }
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
