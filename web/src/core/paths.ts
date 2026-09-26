/**
 * 自由路径：道路 / 航线 / 河流。
 *
 * 模型：与 cell 无关；`points` 为**曲线上必过**的控制点（≥2）。
 * 曲线：Catmull-Rom（过点插值，端点重复），2 点为直线。
 * 样式：三类各自绘制（casing / dash / 河宽渐变）。
 */
import type { LonLat } from './types';

export type PathKind = 'road' | 'route' | 'river';

export interface PathFeature {
  id: string;
  layerId: PathKind;
  name: string;
  /** 控制点：位于曲线上的顶点，按顺序 */
  points: LonLat[];
  color: string;
  /** 河流宽度因子（投影单位量级） */
  widthStart?: number;
  widthEnd?: number;
  attributes?: Record<string, unknown>;
}

export const PATH_DRAW_STYLE: Record<
  PathKind,
  {
    core: string;
    casing: string | null;
    casingScale: number;
    dash: number[];
    width: number;
    taper: boolean;
  }
> = {
  // 参考制图：道路用双线 casing，像公路
  road: {
    core: '#e8c36a',
    casing: 'rgba(30,24,12,0.45)',
    casingScale: 1.7,
    dash: [],
    width: 1.6,
    taper: false,
  },
  // 航线：疏虚线，偏冷色
  route: {
    core: '#7ec8e3',
    casing: 'rgba(20,40,60,0.25)',
    casingScale: 1.4,
    dash: [7, 5],
    width: 1.4,
    taper: false,
  },
  // 河流：上游细、下游粗，深蓝
  river: {
    core: '#3d8ec9',
    casing: 'rgba(10,28,48,0.35)',
    casingScale: 1.35,
    dash: [],
    width: 1.2,
    taper: true,
  },
};

export function defaultPathColor(kind: PathKind): string {
  return PATH_DRAW_STYLE[kind].core;
}

/** 旧 BezierPath → PathFeature */
export function migrateToPathFeature(raw: Record<string, unknown>): PathFeature {
  if (Array.isArray(raw.points) && raw.points.length) {
    return raw as unknown as PathFeature;
  }
  const start = raw.start as LonLat | undefined;
  const end = raw.end as LonLat | undefined;
  const controls = (raw.controls as LonLat[] | undefined) ?? [];
  const pts: LonLat[] = [];
  if (start) pts.push(start);
  for (const c of controls) pts.push(c);
  if (end) pts.push(end);
  return {
    id: String(raw.id ?? `path-${Date.now()}`),
    layerId: (raw.layerId as PathKind) ?? 'road',
    name: String(raw.name ?? '路径'),
    points: pts.length >= 2 ? pts : pts.length ? [pts[0], pts[0]] : [],
    color: String(raw.color ?? defaultPathColor((raw.layerId as PathKind) ?? 'road')),
    widthStart: raw.widthStart as number | undefined,
    widthEnd: raw.widthEnd as number | undefined,
    attributes: (raw.attributes as Record<string, unknown>) ?? {},
  };
}

/**
 * Catmull-Rom 采样：输出折线点（投影平面 xy，或球面 xyz）。
 * pts: 顺序控制点；返回插值折线（含端点）。
 * 输入带 z（球面）则按同一公式插值 z；纯 2D 输出保持 {x,y} 不带 z。
 */
export function catmullRomPolyline(
  pts: { x: number; y: number; z: number }[],
  samplesPerSeg?: number,
): { x: number; y: number; z: number }[];
export function catmullRomPolyline(
  pts: { x: number; y: number }[],
  samplesPerSeg?: number,
): { x: number; y: number }[];
export function catmullRomPolyline(
  pts: { x: number; y: number; z?: number }[],
  samplesPerSeg = 12,
): { x: number; y: number; z?: number }[] {
  const n = pts.length;
  const hasZ = pts.some((p) => p.z !== undefined);
  const zOf = (p: { z?: number }): number => p.z ?? 0;
  if (n === 0) return [];
  if (n === 1) return [{ ...pts[0] }];
  if (n === 2) {
    return [{ ...pts[0] }, { ...pts[1] }];
  }
  const out: { x: number; y: number; z?: number }[] = [];
  // 端点虚拟邻点
  const at = (i: number): { x: number; y: number; z?: number } => {
    if (i < 0) {
      return {
        x: 2 * pts[0].x - pts[1].x,
        y: 2 * pts[0].y - pts[1].y,
        z: 2 * zOf(pts[0]) - zOf(pts[1]),
      };
    }
    if (i >= n) {
      const a = pts[n - 1];
      const b = pts[n - 2];
      return { x: 2 * a.x - b.x, y: 2 * a.y - b.y, z: 2 * zOf(a) - zOf(b) };
    }
    return pts[i];
  };
  for (let i = 0; i < n - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const steps = i === 0 ? samplesPerSeg : samplesPerSeg;
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      // 均匀 Catmull-Rom → 三次多项式
      const x =
        0.5 *
        (2 * p1.x +
          (-p0.x + p2.x) * t +
          (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
          (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
      const y =
        0.5 *
        (2 * p1.y +
          (-p0.y + p2.y) * t +
          (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
          (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
      if (hasZ) {
        const z =
          0.5 *
          (2 * zOf(p1) +
            (-zOf(p0) + zOf(p2)) * t +
            (2 * zOf(p0) - 5 * zOf(p1) + 4 * zOf(p2) - zOf(p3)) * t2 +
            (-zOf(p0) + 3 * zOf(p1) - 3 * zOf(p2) + zOf(p3)) * t3);
        out.push({ x, y, z });
      } else {
        out.push({ x, y });
      }
    }
  }
  out.push({ ...pts[n - 1] });
  return out;
}

/** 点到折线最近距离与插入下标（在第 i 段后插入） */
export function nearestOnPolyline(
  poly: { x: number; y: number }[],
  x: number,
  y: number,
): { dist: number; seg: number; t: number; px: number; py: number } {
  let best = { dist: Infinity, seg: 0, t: 0, px: poly[0]?.x ?? 0, py: poly[0]?.y ?? 0 };
  if (poly.length < 2) return best;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i];
    const b = poly[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    let t = ((x - a.x) * dx + (y - a.y) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const dist = Math.hypot(px - x, py - y);
    if (dist < best.dist) best = { dist, seg: i, t, px, py };
  }
  return best;
}

/**
 * 在曲线上插入控制点：
 * 把点击位置映射到折线段，再在对应控制点区间插入。
 * 返回新 points（经纬度插值）。
 */
/**
 * 在曲线上插入控制点：投影命中段 → 在对应控制点区间插入。
 * 返回新数组与插入下标（便于立即拖动该点）。
 */
export function insertControlPointOnPath(
  points: LonLat[],
  hitSeg: number,
  hitT: number,
): { points: LonLat[]; index: number } {
  if (points.length < 2) return { points: [...points], index: points.length - 1 };
  const samplesPerSeg = 10;
  const ctrlSeg = Math.min(points.length - 2, Math.max(0, Math.floor(hitSeg / samplesPerSeg)));
  const a = points[ctrlSeg];
  const b = points[ctrlSeg + 1];
  const t = Math.max(0, Math.min(1, hitT));
  const mid: LonLat = {
    lon: a.lon + (b.lon - a.lon) * t,
    lat: a.lat + (b.lat - a.lat) * t,
  };
  const next = points.slice();
  const index = ctrlSeg + 1;
  next.splice(index, 0, mid);
  return { points: next, index };
}

/** 把点击经纬度投影到折线（已 unwrap 的投影坐标）最近点，返回段号与 t */
/**
 * 删除控制点。
 * - 普通点：直接删
 * - 端点：其「下一/上一」控制点在曲线上的投影（过点样条上≈该点）成为新端点，
 *   并删掉那个普通控制点
 * - 至少保留 2 个点
 */
export function deleteControlPoint(points: LonLat[], index: number): LonLat[] {
  const n = points.length;
  if (n <= 2) return points;
  const next = points.slice();
  if (index === 0) {
    // 起点 → 用下一点（虚线连到的曲线点）作新起点，并删掉该中间点
    const promoted = next[1];
    next.splice(0, 2, { ...promoted });
    return next;
  }
  if (index === n - 1) {
    const promoted = next[n - 2];
    next.splice(n - 2, 2, { ...promoted });
    return next;
  }
  next.splice(index, 1);
  return next;
}

/** 取本层唯一曲线（一个元素只允许一条） */
export function solePathOfKind<T extends { layerId: string }>(
  paths: T[] | undefined,
  kind: string,
): T | null {
  if (!paths?.length) return null;
  return paths.find((p) => p.layerId === kind) ?? null;
}

export function projectClickToPolyline(
  poly: { x: number; y: number }[],
  x: number,
  y: number,
): { seg: number; t: number; dist: number; px: number; py: number } {
  return nearestOnPolyline(poly, x, y);
}

export function createPathFeature(
  kind: PathKind,
  points: LonLat[],
  name?: string,
): PathFeature {
  return {
    id: `${kind}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1000)}`,
    layerId: kind,
    name: name ?? `${LAYER_CN[kind]} ${Date.now() % 10000}`,
    points: points.map((p) => ({ ...p })),
    color: defaultPathColor(kind),
    widthStart: kind === 'river' ? 0.55 : undefined,
    widthEnd: kind === 'river' ? 1.0 : undefined,
    attributes: {},
  };
}

const LAYER_CN: Record<PathKind, string> = {
  road: '道路',
  route: '航线',
  river: '河流',
};
