/**
 * 行星与恒星系统参数。
 *
 * 3D 球面视图可可视化：
 * - 自转轴、黄道面、黄赤交角、赤道圈、进动示意
 * - 恒星、本星轨道、同系统其它行星轨道
 * - 卫星个数与绕转轨道
 *
 * 数值为架空世界设定，不强制与真实天文一致。
 */
import { EPS_FP } from './tolerances';
import type { ClimateParams } from './types';

export interface OrbitParams {
  /** 半长轴：行星 = AU；卫星 = 主星赤道半径倍数 */
  semiMajor: number;
  /** 离心率 0–0.85 */
  eccentricity: number;
  /** 轨道倾角（度） */
  inclinationDeg: number;
  /** 公转周期：行星 = 年；卫星 = 天 */
  period: number;
  /** t=0 时的平近点角（度） */
  phaseDeg: number;
  /** 升交点黄经 Ω（度） */
  nodeDeg?: number;
  /** 近日点幅角 ω（度）— 开普勒轨道形状 */
  periapsisDeg?: number;
}

export interface MoonParams {
  id: string;
  name: string;
  /** 相对本星半径 */
  radiusEarth: number;
  color: string;
  orbit: OrbitParams;
}

export interface PlanetVisualParams {
  id: string;
  name: string;
  /** 相对地球半径 */
  radiusEarth: number;
  color: string;
  /** 自转周期（小时） */
  rotationHours: number;
  rotationPrograde: boolean;
  /** 黄赤交角（度） */
  axialTiltDeg: number;
  /** 展示用：赤道半径 km */
  radiusKm: number;
  /** 表面重力（g） */
  gravityG: number;
  /** 大气压（atm） */
  atmosphereAtm: number;
  /** 几何反照率 0–1 */
  albedo: number;
  /** 磁场强度（相对地球） */
  magneticField: number;
  /** 自转轴进动周期（年） */
  precessionYears: number;
  orbit: OrbitParams;
  moons: MoonParams[];
}

export interface StarParams {
  id: string;
  name: string;
  /** 相对太阳半径 */
  radiusSolar: number;
  /** 相对太阳质量 */
  massSolar: number;
  /** 光度 L☉ */
  luminosity: number;
  /** 有效温度 K */
  temperatureK: number;
  /** 显示色 */
  color: string;
}

export interface StarSystem {
  star: StarParams;
  /** 本架空星球 */
  home: PlanetVisualParams;
  /** 系统内其它行星（不含 home） */
  planets: PlanetVisualParams[];
  /** 星系显示开关默认值 */
  showAxis: boolean;
  showEcliptic: boolean;
  showOrbits: boolean;
  showMoons: boolean;
  /** 历法 / 公转时间（3D 动画用） */
  calendar?: CalendarParams;
}

/**
 * 历法与公转时间。
 * - 一年 = daysPerYear 个「本星日」
 * - 一月 ≈ daysPerMonth（默认对齐主卫星）
 * - 每颗卫星可单独设公转天数
 */
export interface CalendarParams {
  /** 一年 = 多少本星日 */
  daysPerYear: number;
  /** 一月 = 多少本星日（主卫星默认） */
  daysPerMonth: number;
  /** 行星公转天数：id → 天；缺省用 orbit.period * daysPerYear */
  planetPeriodDays?: Record<string, number>;
  /** 卫星周期录入方式：恒星月（真轨道）或朔望月（相对主星） */
  moonPeriodMode?: 'sidereal' | 'synodic';
  /** 卫星公转天数（按 moonPeriodMode 解释） */
  moonPeriodDays?: Record<string, number>;
  /** 动画速度：模拟日 / 真实秒 */
  simSpeed?: number;
}

export type MoonPeriodMode = 'sidereal' | 'synodic';

/** 朔望月 → 恒星月（真轨道周期，日） */
export function synodicToSidereal(synodicDays: number, planetYearDays: number): number {
  const s = Math.max(0.2, synodicDays);
  const y = Math.max(s + 0.2, planetYearDays);
  // 1/P_sid = 1/P_syn + 1/P_year （顺行）
  return (s * y) / (y + s);
}

/** 恒星月 → 朔望月（日） */
export function siderealToSynodic(siderealDays: number, planetYearDays: number): number {
  const p = Math.max(0.2, siderealDays);
  const y = Math.max(0.2, planetYearDays);
  if (p >= y * 0.98) return p * 1.02;
  return (p * y) / (y - p);
}

export function defaultCalendar(sys: Pick<StarSystem, 'home'>): CalendarParams {
  const daysPerYear = 365;
  const mainMoon = sys.home.moons[0];
  const daysPerMonth = Math.max(1, Math.round(mainMoon?.orbit.period ?? 30));
  const moonPeriodDays: Record<string, number> = {};
  for (const m of sys.home.moons) {
    moonPeriodDays[m.id] = Math.max(0.5, m.orbit.period);
  }
  return {
    daysPerYear,
    daysPerMonth,
    moonPeriodMode: 'sidereal',
    moonPeriodDays,
    simSpeed: 8,
  };
}

export function moonPeriodMode(sys: StarSystem): MoonPeriodMode {
  return sys.calendar?.moonPeriodMode ?? 'sidereal';
}

/** 动画用：始终返回恒星月（真轨道日数） */
export function moonPeriodDays(
  sys: StarSystem,
  moonId: string,
  parentPlanetId: string,
): number {
  const cal = sys.calendar;
  const mode = moonPeriodMode(sys);
  const yd = homeYearDays(sys);
  const raw = cal?.moonPeriodDays?.[moonId];
  const all = [sys.home, ...sys.planets];
  const parent = all.find((x) => x.id === parentPlanetId);
  const m = parent?.moons.find((x) => x.id === moonId);
  const fallback = raw ?? m?.orbit.period ?? cal?.daysPerMonth ?? 30;
  const stored = Math.max(0.2, fallback);
  if (mode === 'synodic') return synodicToSidereal(stored, yd);
  return stored;
}

/** 面板显示：按当前模式的录入值（日） */
export function moonPeriodDisplay(
  sys: StarSystem,
  moonId: string,
  parentPlanetId: string,
): number {
  const mode = moonPeriodMode(sys);
  const sid = moonPeriodDays(sys, moonId, parentPlanetId);
  if (mode === 'sidereal') return sid;
  return siderealToSynodic(sid, homeYearDays(sys));
}

/** 写入面板数值：按当前模式解释并写入 calendar */
export function setMoonPeriodValue(
  sys: StarSystem,
  moonId: string,
  parentPlanetId: string,
  displayDays: number,
): CalendarParams {
  const cal = { ...(sys.calendar ?? defaultCalendar(sys)) };
  const mode = cal.moonPeriodMode ?? 'sidereal';
  const yd = homeYearDays(sys);
  const v = Math.max(0.2, displayDays);
  // 统一存恒星月，动画始终用真轨道周期
  const sid = mode === 'synodic' ? synodicToSidereal(v, yd) : v;
  cal.moonPeriodMode = mode;
  cal.moonPeriodDays = { ...(cal.moonPeriodDays ?? {}), [moonId]: sid };
  // 主卫星同步「一月」显示值（按模式）
  const home = sys.home;
  if (home.moons[0]?.id === moonId) {
    cal.daysPerMonth =
      mode === 'synodic' ? Math.max(1, Math.round(v)) : Math.max(1, Math.round(sid));
  }
  return cal;
}

/** 切换恒星月/朔望月：已存恒星月，仅改解释模式；daysPerMonth 跟随主星显示值 */
export function switchMoonPeriodMode(
  sys: StarSystem,
  mode: MoonPeriodMode,
): CalendarParams {
  const cal = { ...(sys.calendar ?? defaultCalendar(sys)), moonPeriodMode: mode };
  const yd = homeYearDays(sys);
  const mainId = sys.home.moons[0]?.id;
  if (mainId) {
    const sid = cal.moonPeriodDays?.[mainId] ?? sys.home.moons[0].orbit.period;
    const disp =
      mode === 'synodic' ? siderealToSynodic(sid, yd) : sid;
    cal.daysPerMonth = Math.max(1, Math.round(disp));
  }
  return cal;
}

export type BodyRef =
  | { kind: 'star'; id: string }
  | { kind: 'planet'; id: string }
  | { kind: 'moon'; id: string; parentPlanetId: string };

/** 本星一年对应的模拟日数 */
export function homeYearDays(sys: StarSystem): number {
  return Math.max(1, sys.calendar?.daysPerYear ?? 365);
}

/** 某行星公转周期（模拟日） */
export function planetPeriodDays(sys: StarSystem, planetId: string): number {
  const cal = sys.calendar;
  if (cal?.planetPeriodDays?.[planetId] != null) {
    return Math.max(0.2, cal.planetPeriodDays[planetId]);
  }
  const all = [sys.home, ...sys.planets];
  const p = all.find((x) => x.id === planetId);
  if (!p) return homeYearDays(sys);
  return Math.max(0.2, p.orbit.period * homeYearDays(sys));
}

/**
 * 开普勒轨道位置（黄道系，恒星在焦点/原点）。
 * aScene：半长轴对应的场景长度；太阳系式默认参数见 defaultStarSystem。
 * 轨道要素：a, e, i, Ω(node), ω(periapsis), M0(phase)。
 */
export function keplerPoint(
  o: OrbitParams,
  aScene: number,
  tDays: number,
  periodDays: number,
): { x: number; y: number; z: number } {
  const e = Math.min(0.85, Math.max(0, o.eccentricity));
  const a = Math.max(0.01, aScene);
  const M0 = (o.phaseDeg * Math.PI) / 180;
  const M = M0 + (tDays / Math.max(0.2, periodDays)) * Math.PI * 2;
  // 牛顿迭代解 Kepler 方程 E - e sin E = M
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 10; k++) {
    const f = E - e * Math.sin(E) - M;
    const fp = 1 - e * Math.cos(E);
    if (Math.abs(fp) < EPS_FP) break;
    E -= f / fp;
  }
  // 轨道平面（焦点在原点）：x = a(cos E - e), z = a√(1-e²) sin E
  const xOrb = a * (Math.cos(E) - e);
  const zOrb = a * Math.sqrt(Math.max(1e-6, 1 - e * e)) * Math.sin(E);
  const w = ((o.periapsisDeg ?? 0) * Math.PI) / 180;
  const inc = (o.inclinationDeg * Math.PI) / 180;
  const om = ((o.nodeDeg ?? 0) * Math.PI) / 180;
  // ω → i → Ω
  const xw = xOrb * Math.cos(w) - zOrb * Math.sin(w);
  const zw = xOrb * Math.sin(w) + zOrb * Math.cos(w);
  const y = zw * Math.sin(inc);
  const z2 = zw * Math.cos(inc);
  return {
    x: xw * Math.cos(om) - z2 * Math.sin(om),
    y,
    z: xw * Math.sin(om) + z2 * Math.cos(om),
  };
}

/** 开普勒椭圆采样（场景坐标，焦点在原点） */
export function keplerEllipsePoints(
  o: OrbitParams,
  aScene: number,
  segments = 128,
): number[] {
  const e = Math.min(0.85, Math.max(0, o.eccentricity));
  const a = Math.max(0.01, aScene);
  const w = ((o.periapsisDeg ?? 0) * Math.PI) / 180;
  const inc = (o.inclinationDeg * Math.PI) / 180;
  const om = ((o.nodeDeg ?? 0) * Math.PI) / 180;
  const pts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const E = (i / segments) * Math.PI * 2;
    const xOrb = a * (Math.cos(E) - e);
    const zOrb = a * Math.sqrt(Math.max(1e-6, 1 - e * e)) * Math.sin(E);
    const xw = xOrb * Math.cos(w) - zOrb * Math.sin(w);
    const zw = xOrb * Math.sin(w) + zOrb * Math.cos(w);
    const y = zw * Math.sin(inc);
    const z2 = zw * Math.cos(inc);
    pts.push(xw * Math.cos(om) - z2 * Math.sin(om), y, xw * Math.sin(om) + z2 * Math.cos(om));
  }
  return pts;
}

/** 兼容旧调用：把真近点角当平近点角的简化版（新代码请用 keplerPoint） */
export function orbitPosAt(
  o: OrbitParams,
  aScene: number,
  thetaRad: number,
): { x: number; y: number; z: number } {
  return keplerPoint({ ...o, phaseDeg: (thetaRad * 180) / Math.PI }, aScene, 0, 1);
}

export function orbitTheta(o: OrbitParams, periodDays: number, tDays: number): number {
  const phase = ((o.phaseDeg + (o.nodeDeg ?? 0)) * Math.PI) / 180;
  return phase + (tDays / Math.max(0.2, periodDays)) * Math.PI * 2;
}

/** 列出系统内全部天体（供点击/面板） */
export function listBodies(sys: StarSystem): {
  ref: BodyRef;
  name: string;
  color: string;
  radiusScene: number;
  periodDays?: number;
  extra?: Record<string, string | number>;
}[] {
  const out: {
    ref: BodyRef;
    name: string;
    color: string;
    radiusScene: number;
    periodDays?: number;
    extra?: Record<string, string | number>;
  }[] = [];
  out.push({
    ref: { kind: 'star', id: sys.star.id },
    name: sys.star.name,
    color: sys.star.color,
    radiusScene: 0.22 + sys.star.radiusSolar * 0.1,
    extra: {
      光度: sys.star.luminosity,
      质量: sys.star.massSolar,
      温度K: sys.star.temperatureK,
    },
  });
  const planets = [sys.home, ...sys.planets];
  for (const p of planets) {
    out.push({
      ref: { kind: 'planet', id: p.id },
      name: p.name,
      color: p.color,
      radiusScene: Math.max(0.06, Math.min(0.22, p.radiusEarth * 0.1)),
      periodDays: planetPeriodDays(sys, p.id),
      extra: {
        半径: p.radiusEarth,
        自转h: p.rotationHours,
        倾角deg: p.axialTiltDeg,
      },
    });
    for (const m of p.moons) {
      out.push({
        ref: { kind: 'moon', id: m.id, parentPlanetId: p.id },
        name: m.name,
        color: m.color,
        radiusScene: Math.max(0.025, m.radiusEarth * 0.04),
        periodDays: moonPeriodDays(sys, m.id, p.id),
      });
    }
  }
  return out;
}

/** 由气候参数同步本星自转/倾角 */
export function syncHomeFromClimate(sys: StarSystem, climate: ClimateParams): StarSystem {
  return {
    ...sys,
    home: {
      ...sys.home,
      axialTiltDeg: climate.axialTiltDeg,
      rotationHours: climate.rotationHours,
      rotationPrograde: climate.rotationPrograde,
    },
  };
}

function moon(
  i: number,
  semiMajor: number,
  periodDays: number,
  radiusEarth = 0.27,
): MoonParams {
  return {
    id: `moon-${i}`,
    name: `卫星 ${i + 1}`,
    radiusEarth,
    color: '#b8c0c8',
    orbit: {
      semiMajor,
      eccentricity: 0.02 + (i % 3) * 0.03,
      inclinationDeg: (i * 7) % 25,
      period: periodDays,
      phaseDeg: (i * 97) % 360,
      nodeDeg: (i * 40) % 360,
    },
  };
}

function planet(
  id: string,
  name: string,
  color: string,
  radiusEarth: number,
  aAU: number,
  periodY: number,
  e = 0.05,
  inc = 2,
  tilt = 10,
  node = 0,
  peri = 0,
  phase = 0,
): PlanetVisualParams {
  return {
    id,
    name,
    radiusEarth,
    color,
    rotationHours: 10 + radiusEarth * 8,
    rotationPrograde: true,
    axialTiltDeg: tilt,
    radiusKm: 6371 * radiusEarth,
    gravityG: radiusEarth * 0.95,
    atmosphereAtm: radiusEarth > 0.8 ? 0.8 : 0.05,
    albedo: 0.2 + (radiusEarth % 0.3),
    magneticField: radiusEarth > 0.7 ? 0.6 : 0.05,
    precessionYears: 20000 + radiusEarth * 5000,
    orbit: {
      semiMajor: aAU,
      eccentricity: e,
      inclinationDeg: inc,
      period: periodY,
      phaseDeg: phase,
      nodeDeg: node,
      periapsisDeg: peri,
    },
    moons: [],
  };
}

/**
 * 默认恒星系：轨道要素按 **太阳系同类** 量级（开普勒 a/e/i/Ω/ω/M）。
 * 本星 = 地球位（1 AU, e≈0.017）；周围类水/金/火与外行星。
 */
export function defaultStarSystem(seed: number, climate: ClimateParams): StarSystem {
  const s = Math.abs(seed | 0);
  const r = (n: number) => ((s * 9973 + n * 7919) % 1000) / 1000;

  const star: StarParams = {
    id: 'star-0',
    name: ['赫利俄斯', '曙光', '赤曜', '银心余晖'][s % 4],
    radiusSolar: 0.9 + r(1) * 0.3,
    massSolar: 0.85 + r(2) * 0.4,
    luminosity: 0.75 + r(3) * 0.6,
    temperatureK: 5200 + Math.floor(r(4) * 1200),
    color: r(5) > 0.5 ? '#ffb347' : '#ffd27a',
  };

  // 太阳系式轨道（AU / 年 / e / i° / Ω° / ω° / M0°）
  const homeAU = 1.0;
  const homePeriodY = 1.0;
  const moons: MoonParams[] = [
    moon(0, 8.2, 27.3, 0.27), // 类月：恒星月 ~27 日
  ];
  if (r(7) > 0.55) moons.push(moon(1, 12 + r(8) * 4, 45 + r(9) * 40, 0.08));

  const home: PlanetVisualParams = {
    id: 'home',
    name: '本星',
    radiusEarth: 1.0,
    color: '#4a8f6a',
    rotationHours: climate.rotationHours,
    rotationPrograde: climate.rotationPrograde,
    axialTiltDeg: climate.axialTiltDeg,
    radiusKm: 6371,
    gravityG: 1.0,
    atmosphereAtm: 1.0,
    albedo: 0.3,
    magneticField: 1.0,
    precessionYears: 26000,
    orbit: {
      semiMajor: homeAU,
      eccentricity: 0.0167,
      inclinationDeg: 0,
      period: homePeriodY,
      phaseDeg: (r(10) * 360) | 0,
      nodeDeg: 0,
      periapsisDeg: 102,
    },
    moons,
  };

  const mass = star.massSolar;
  const yr = (a: number) => Math.pow(a, 1.5) / Math.sqrt(mass);
  // 内行星 + 外行星（太阳系骨架，数值可微扰）
  const others: PlanetVisualParams[] = [
    planet('mercury-like', '水内', '#a89080', 0.38, 0.39, yr(0.39), 0.206, 7.0, 0.03, 48, 29, (r(20) * 360) | 0),
    planet('venus-like', '金内', '#c4a882', 0.95, 0.72, yr(0.72), 0.007, 3.4, 177, 77, 55, (r(21) * 360) | 0),
    planet('mars-like', '火外', '#c47a5c', 0.53, 1.52, yr(1.52), 0.093, 1.85, 25, 49, 286, (r(22) * 360) | 0),
    planet('jupiter-like', '木外', '#c4b87a', 11.2, 5.2, yr(5.2), 0.048, 1.3, 3, 100, 273, (r(23) * 360) | 0),
    planet('saturn-like', '土外', '#d4c89a', 9.4, 9.54, yr(9.54), 0.056, 2.49, 49, 93, 17, (r(24) * 360) | 0),
  ];
  others[3].moons = [moon(0, 2.8, 1.8, 0.18), moon(1, 4.5, 3.5, 0.12)];
  others[4].moons = [moon(0, 3.2, 2.2, 0.14)];

  return {
    star,
    home,
    planets: others,
    showAxis: true,
    showEcliptic: true,
    showOrbits: true,
    showMoons: true,
    calendar: defaultCalendar({ home }),
  };
}

/** 轨道椭圆上一点（场景坐标，黄道 = XZ） */
export function orbitPoint(o: OrbitParams, aScale: number, planetR = 0): { x: number; y: number; z: number } {
  const a = Math.max(0.01, o.semiMajor) * aScale;
  const e = Math.min(0.85, Math.max(0, o.eccentricity));
  const b = a * Math.sqrt(Math.max(0.02, 1 - e * e));
  const th = ((o.phaseDeg + (o.nodeDeg ?? 0)) * Math.PI) / 180;
  // 近焦点简化：中心在原点，忽略焦点偏移的视觉差
  const x = a * Math.cos(th);
  const z = b * Math.sin(th);
  const inc = (o.inclinationDeg * Math.PI) / 180;
  const node = ((o.nodeDeg ?? 0) * Math.PI) / 180;
  // 绕 X 倾角后再绕 Y 升交点
  let y = z * Math.sin(inc);
  let z2 = z * Math.cos(inc);
  const xn = x * Math.cos(node) - z2 * Math.sin(node);
  const zn = x * Math.sin(node) + z2 * Math.cos(node);
  void planetR;
  return { x: xn, y, z: zn };
}

/** 开普勒轨道线：用场景 a 采样 */
export function orbitEllipsePoints(
  o: OrbitParams,
  aScale: number,
  segments = 96,
): number[] {
  return keplerEllipsePoints(o, aScale, segments);
}

/** AU → 星系场景单位（压缩尺度，便于同屏显示） */
export function auToScene(au: number): number {
  // 对数压缩：0.25AU→~1.2，1AU→~2.2，2.5AU→~3.2
  return 0.8 + Math.log(1 + Math.max(0, au) * 3) * 1.35;
}

/** 卫星轨道半长轴（主星半径倍）→ 场景单位 */
export function moonOrbitScene(aPlanetRadii: number, planetSceneR: number): number {
  return planetSceneR * (1.35 + Math.min(3.5, aPlanetRadii) * 0.35);
}
