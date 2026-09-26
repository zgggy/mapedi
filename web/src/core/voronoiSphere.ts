/**
 * 球面 Voronoi：先在单位球上均匀撒点，用平分面裁剪得到球面多边形。
 * 真相始终是球面点；平面投影只用于显示。
 */

export type Vec3 = [number, number, number];

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vec3ToLonLat(v: Vec3): { lon: number; lat: number } {
  const [x, y, z] = normalize(v);
  return {
    lon: Math.atan2(z, x) * R2D,
    lat: Math.asin(Math.max(-1, Math.min(1, y))) * R2D,
  };
}

export function lonLatToVec3(lon: number, lat: number): Vec3 {
  const λ = lon * D2R;
  const φ = lat * D2R;
  const cl = Math.cos(φ);
  return [cl * Math.cos(λ), Math.sin(φ), cl * Math.sin(λ)];
}

/**
 * 球面蓝噪声撒点：随机投标 + 最小弦距，有机、无明显“中心/格点感”。
 * 极区与其他纬度采用相同的采样规则，极点归属于最近站点的普通胞腔。
 */
export function blueNoiseSphere(
  n: number,
  rng: () => number,
  minDistFactor = 0.82,
): Vec3[] {
  const target = Math.max(16, n);
  const avg = Math.sqrt((4 * Math.PI) / target);
  const pts: Vec3[] = [];

  const randomPt = (): Vec3 => {
    const u = rng() * 2 - 1;
    const lon = rng() * Math.PI * 2 - Math.PI;
    const r = Math.sqrt(Math.max(0, 1 - u * u));
    return normalize([r * Math.cos(lon), u, r * Math.sin(lon)]);
  };

  let factor = minDistFactor;
  for (let attempt = 0; attempt < 8; attempt++) {
    pts.length = 0;
    const minD = avg * factor;
    const minD2 = minD * minD;
    const cell = Math.max(minD, 0.015);
    const grid = new Map<string, number[]>();
    const keyOf = (p: Vec3) =>
      `${Math.floor(p[0] / cell)},${Math.floor(p[1] / cell)},${Math.floor(p[2] / cell)}`;

    const tryPush = (p: Vec3): boolean => {
      const cx = Math.floor(p[0] / cell);
      const cy = Math.floor(p[1] / cell);
      const cz = Math.floor(p[2] / cell);
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const a = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (!a) continue;
            for (const j of a) {
              const q = pts[j];
              const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
              if (d2 < minD2) return false;
            }
          }
      pts.push(p);
      const k = keyOf(p);
      let arr = grid.get(k);
      if (!arr) {
        arr = [];
        grid.set(k, arr);
      }
      arr.push(pts.length - 1);
      return true;
    };

    const tries = target * 28;
    for (let t = 0; t < tries && pts.length < target; t++) tryPush(randomPt());
    if (pts.length >= target * 0.9) break;
    factor *= 0.85;
  }

  while (pts.length < target) pts.push(randomPt());
  return pts.slice(0, target);
}

/** 兼容旧名：Fibonacci（过正则，仅作对照） */
export function fibonacciSphere(n: number, rng?: () => number): Vec3[] {
  const pts: Vec3[] = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    let y = 1 - (i / Math.max(1, n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = ga * i;
    let x = Math.cos(theta) * r;
    let z = Math.sin(theta) * r;
    if (rng) {
      const j = 0.4 / Math.sqrt(n);
      x += (rng() - 0.5) * j;
      y += (rng() - 0.5) * j;
      z += (rng() - 0.5) * j;
    }
    pts.push(normalize([x, y, z]));
  }
  return pts;
}

/** 3D 网格最近邻 */
export class Vec3Grid {
  private cellSize: number;
  private map = new Map<string, number[]>();
  constructor(
    private pts: Vec3[],
    expectedNeighbors = 16,
  ) {
    // 平均角距 ~ 2*sqrt(pi/n)，弦长近似
    // 蓝噪声间距不均，邻域格稍放大
    this.cellSize = Math.max(0.03, (2.8 * Math.sqrt(4 * Math.PI)) / Math.sqrt(pts.length));
    void expectedNeighbors;
    pts.forEach((p, i) => {
      const k = this.key(p);
      let a = this.map.get(k);
      if (!a) {
        a = [];
        this.map.set(k, a);
      }
      a.push(i);
    });
  }

  private key(p: Vec3): string {
    return `${Math.floor(p[0] / this.cellSize)},${Math.floor(p[1] / this.cellSize)},${Math.floor(p[2] / this.cellSize)}`;
  }

  neighbors(i: number, maxCount = 24): number[] {
    const p = this.pts[i];
    const cx = Math.floor(p[0] / this.cellSize);
    const cy = Math.floor(p[1] / this.cellSize);
    const cz = Math.floor(p[2] / this.cellSize);
    const cands: number[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const a = this.map.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (a) cands.push(...a);
        }
    const scored = cands
      .filter((j) => j !== i)
      .map((j) => ({
        j,
        d: (this.pts[j][0] - p[0]) ** 2 + (this.pts[j][1] - p[1]) ** 2 + (this.pts[j][2] - p[2]) ** 2,
      }))
      .sort((a, b) => a.d - b.d);
    return scored.slice(0, maxCount).map((s) => s.j);
  }

  /** 搜单位球上角距 ≤ radiusRad 内的点索引 */
  pointsNear(c: Vec3, radiusRad: number): number[] {
    const rr = Math.max(radiusRad, 1e-4);
    const chord = 2 * Math.sin(Math.min(Math.PI / 2, rr / 2));
    const ring = Math.max(1, Math.min(3, Math.ceil(chord / this.cellSize) + 1));
    const cx = Math.floor(c[0] / this.cellSize);
    const cy = Math.floor(c[1] / this.cellSize);
    const cz = Math.floor(c[2] / this.cellSize);
    const cosR = Math.cos(Math.min(Math.PI, rr));
    const out: number[] = [];
    for (let dx = -ring; dx <= ring; dx++)
      for (let dy = -ring; dy <= ring; dy++)
        for (let dz = -ring; dz <= ring; dz++) {
          const a = this.map.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!a) continue;
          for (const j of a) {
            const p = this.pts[j];
            const d = p[0] * c[0] + p[1] * c[1] + p[2] * c[2];
            if (d >= cosR - 1e-12) out.push(j);
          }
        }
    return out;
  }
}

/** 用平面 n·p >= 0 裁剪球面多边形（大圆） */
export function clipSphericalPolygon(
  poly: Vec3[],
  normal: Vec3,
): Vec3[] {
  if (poly.length < 3) return [];
  const n = normalize(normal);
  const out: Vec3[] = [];
  const side = (p: Vec3) => dot(p, n);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const sa = side(a);
    const sb = side(b);
    if (sa >= -1e-12) out.push(a);
    if ((sa > 0 && sb < 0) || (sa < 0 && sb > 0)) {
      // 大圆 ab 与平面 n 的交：normalize( (a×b) × n )
      const e = cross(a, b);
      let t = cross(e, n);
      if (Math.hypot(t[0], t[1], t[2]) > 1e-12) out.push(normalize(t));
    }
  }
  return out;
}

/** 站点 i 周围的初始多边形（切平面上的小正多边形） */
function seedPolygon(u: Vec3, radiusRad: number, sides = 12): Vec3[] {
  // 构造正交基
  const up: Vec3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const e1 = normalize(cross(up, u));
  const e2 = normalize(cross(u, e1));
  const poly: Vec3[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2;
    const dx = Math.cos(a) * Math.sin(radiusRad);
    const dy = Math.sin(a) * Math.sin(radiusRad);
    const c = Math.cos(radiusRad);
    poly.push(normalize([
      u[0] * c + e1[0] * dx + e2[0] * dy,
      u[1] * c + e1[1] * dx + e2[1] * dy,
      u[2] * c + e1[2] * dx + e2[2] * dy,
    ]));
  }
  return poly;
}

export interface SharedEdge {
  a: Vec3;
  b: Vec3;
}

export interface SphereVoronoiResult {
  /** 每个站点的球面多边形（单位向量环） */
  polys: Vec3[][];
  sites: Vec3[];
  neighbors: number[][];
  /** 邻接站点对 → 共享 Voronoi 边（两外心）；key = `i-j` (i<j) */
  sharedEdges: Map<string, SharedEdge>;
}

/** 球面三角形外心 */
export function sphericalCircumcenter(a: Vec3, b: Vec3, c: Vec3): Vec3 | null {
  const n = cross(
    [b[0] - a[0], b[1] - a[1], b[2] - a[2]],
    [c[0] - a[0], c[1] - a[1], c[2] - a[2]],
  );
  const len = Math.hypot(n[0], n[1], n[2]);
  if (len < 1e-12) return null;
  const pole: Vec3 = [n[0] / len, n[1] / len, n[2] / len];
  const cen: Vec3 = [a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]];
  return dot(pole, cen) >= 0 ? pole : [-pole[0], -pole[1], -pole[2]];
}

/**
 * 全局顶点表 snap：邻近球面点焊到同一代表。
 * 消除对偶近重合外心（短 Voronoi 边 / 近退化三角）在不同胞腔各留各的角。
 */
export function createVertexSnap(epsDot = 0.999999): (v: Vec3) => Vec3 {
  // 25k 时平均边长约 0.02rad；焊接阈须吸收浮点/对偶误差，又不能吞掉真角点
  const cell = Math.sqrt(2 * (1 - epsDot));
  const g = Math.max(cell, 1e-4);
  const grid = new Map<string, Vec3[]>();
  const key = (v: Vec3) =>
    `${Math.floor(v[0] / g)},${Math.floor(v[1] / g)},${Math.floor(v[2] / g)}`;

  return (v: Vec3): Vec3 => {
    const cx = Math.floor(v[0] / g);
    const cy = Math.floor(v[1] / g);
    const cz = Math.floor(v[2] / g);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const bucket = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
          if (!bucket) continue;
          for (const r of bucket) {
            const d = r[0] * v[0] + r[1] * v[1] + r[2] * v[2];
            if (d >= epsDot) return r;
          }
        }
    const rep: Vec3 = [v[0], v[1], v[2]];
    const k = key(rep);
    let a = grid.get(k);
    if (!a) {
      a = [];
      grid.set(k, a);
    }
    a.push(rep);
    return rep;
  };
}

/** 将邻近球面顶点焊到同一代表点，消除相邻胞腔缝；返回 snap 函数供外部复用 */
export function weldVertices(
  polys: Vec3[][],
  epsDot = 0.999999,
): { polys: Vec3[][]; snap: (v: Vec3) => Vec3 } {
  const snap = createVertexSnap(epsDot);
  return { polys: polys.map((poly) => poly.map(snap)), snap };
}

function angleBetween(u: Vec3, v: Vec3): number {
  return Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
}

/**
 * 3D 凸包（增量法）→ 外向三角面。
 * 点在单位球上时，**球面 Delaunay = 凸包外表面**，O(n log n) 级，替代 n·k² 暴力枚举。
 */
function convexHullTriangles(
  pts: Vec3[],
  onProgress?: (done: number, total: number) => void,
): [number, number, number][] {
  const n = pts.length;
  if (n < 4) return [];

  // 初始四面体：四点不共面
  let i0 = 0;
  let i1 = -1;
  for (let i = 1; i < n; i++) {
    if (Math.hypot(pts[i][0] - pts[i0][0], pts[i][1] - pts[i0][1], pts[i][2] - pts[i0][2]) > 1e-6) {
      i1 = i;
      break;
    }
  }
  if (i1 < 0) return [];
  let i2 = -1;
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1) continue;
    const a = pts[i0];
    const b = pts[i1];
    const c = pts[i];
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cr = cross(ab, ac);
    if (Math.hypot(cr[0], cr[1], cr[2]) > 1e-8) {
      i2 = i;
      break;
    }
  }
  if (i2 < 0) return [];
  let i3 = -1;
  for (let i = 0; i < n; i++) {
    if (i === i0 || i === i1 || i === i2) continue;
    const a = pts[i0];
    const b = pts[i1];
    const c = pts[i2];
    const d = pts[i];
    const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ac: Vec3 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const ad: Vec3 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const cr = cross(ab, ac);
    const vol = dot(cr, ad);
    if (Math.abs(vol) > 1e-10) {
      i3 = i;
      break;
    }
  }
  if (i3 < 0) return [];

  type Face = { a: number; b: number; c: number; dead: boolean };
  const faces: Face[] = [];
  // 外向：法线背离四面体内部（用未在面上的点定向）
  const addFace = (a: number, b: number, c: number, out: number) => {
    const p = pts[a];
    const q = pts[b];
    const r = pts[c];
    const nrm = cross(
      [q[0] - p[0], q[1] - p[1], q[2] - p[2]],
      [r[0] - p[0], r[1] - p[1], r[2] - p[2]],
    );
    const o = pts[out];
    const d = nrm[0] * (o[0] - p[0]) + nrm[1] * (o[1] - p[1]) + nrm[2] * (o[2] - p[2]);
    if (d > 0) faces.push({ a, b: c, c: b, dead: false });
    else faces.push({ a, b, c, dead: false });
  };
  addFace(i0, i1, i2, i3);
  addFace(i0, i1, i3, i2);
  addFace(i0, i2, i3, i1);
  addFace(i1, i2, i3, i0);

  const faceNormal = (f: Face): Vec3 => {
    const p = pts[f.a];
    const q = pts[f.b];
    const r = pts[f.c];
    return cross(
      [q[0] - p[0], q[1] - p[1], q[2] - p[2]],
      [r[0] - p[0], r[1] - p[1], r[2] - p[2]],
    );
  };
  const planeDist = (f: Face, i: number) => {
    const nrm = faceNormal(f);
    const p = pts[f.a];
    const q = pts[i];
    return nrm[0] * (q[0] - p[0]) + nrm[1] * (q[1] - p[1]) + nrm[2] * (q[2] - p[2]);
  };

  const used = new Uint8Array(n);
  used[i0] = used[i1] = used[i2] = used[i3] = 1;

  // 剩余点（球面上大多在包上）
  for (let pi = 0; pi < n; pi++) {
    if (used[pi]) continue;
    if (onProgress && (pi & 511) === 0) onProgress(pi, n);
    used[pi] = 1;
    const visible: number[] = [];
    for (let fi = 0; fi < faces.length; fi++) {
      const f = faces[fi];
      if (f.dead) continue;
      if (planeDist(f, pi) > 1e-12) {
        visible.push(fi);
        f.dead = true;
      }
    }
    if (!visible.length) continue; // 在内部
    // 地平线：只被一个可见面使用的边
    const edgeCount = new Map<string, { u: number; v: number; c: number }>();
    const ekey = (u: number, v: number) => (u < v ? `${u}_${v}` : `${v}_${u}`);
    for (const fi of visible) {
      const f = faces[fi];
      for (const [u, v] of [
        [f.a, f.b],
        [f.b, f.c],
        [f.c, f.a],
      ] as const) {
        const k = ekey(u, v);
        const e = edgeCount.get(k);
        if (e) e.c++;
        else edgeCount.set(k, { u, v, c: 1 });
      }
    }
    for (const e of edgeCount.values()) {
      if (e.c !== 1) continue;
      faces.push({ a: e.u, b: e.v, c: pi, dead: false });
    }
    // 紧凑掉 dead，防数组膨胀
    if (faces.length > 0 && faces.length > n * 8) {
      const live = faces.filter((f) => !f.dead);
      faces.length = 0;
      faces.push(...live);
    }
  }

  const out: [number, number, number][] = [];
  for (const f of faces) {
    if (f.dead) continue;
    out.push([f.a, f.b, f.c]);
  }
  return out;
}

/**
 * 球面 Voronoi：**凸包三角 = 球面 Delaunay**，再对偶成胞腔。
 * 外心只算一次 → **全局顶点表 snap** → 三站共角同一引用 → 无缝。
 * 短 Voronoi 边两端塌成一点时丢掉退化 sharedEdge。
 */
export function sphericalVoronoi(
  sites: Vec3[],
  neighborCount = 16,
  onProgress?: (done: number, total: number) => void,
): SphereVoronoiResult {
  const n = sites.length;
  void neighborCount;

  onProgress?.(0, n * 2);
  const hull = convexHullTriangles(sites, (d, t) => onProgress?.(d, t));
  onProgress?.(n, n * 2);

  const triangles: [number, number, number][] = hull;
  // 全局顶点表：所有外心先焊成代表，禁止 per-cell first-wins 分裂
  const snap = createVertexSnap();
  const circum: Vec3[] = [];
  for (let t = 0; t < triangles.length; t++) {
    const [a, b, c] = triangles[t];
    const cc =
      sphericalCircumcenter(sites[a], sites[b], sites[c]) ??
      normalize([
        sites[a][0] + sites[b][0] + sites[c][0],
        sites[a][1] + sites[b][1] + sites[c][1],
        sites[a][2] + sites[b][2] + sites[c][2],
      ]);
    circum.push(snap(cc));
  }

  // 2) 仅由 faces 建拓扑：邻接 = Delaunay 共边；sharedEdges = 该边两外心（与 poly 同一引用）
  const vertsBySite: Vec3[][] = Array.from({ length: n }, () => []);
  const adjSets: Set<number>[] = Array.from({ length: n }, () => new Set());
  const edgeCC = new Map<number, Vec3[]>();
  const eKey = (i: number, j: number) => (i < j ? i * n + j : j * n + i);
  for (let t = 0; t < triangles.length; t++) {
    const [a, b, c] = triangles[t];
    const cc = circum[t];
    vertsBySite[a].push(cc);
    vertsBySite[b].push(cc);
    vertsBySite[c].push(cc);
    adjSets[a].add(b);
    adjSets[a].add(c);
    adjSets[b].add(a);
    adjSets[b].add(c);
    adjSets[c].add(a);
    adjSets[c].add(b);
    for (const [u, v] of [
      [a, b],
      [b, c],
      [c, a],
    ] as const) {
      const k = eKey(u, v);
      let arr = edgeCC.get(k);
      if (!arr) {
        arr = [];
        edgeCC.set(k, arr);
      }
      arr.push(cc);
    }
  }

  // sharedEdges：一 Delaunay 边两侧的两个外心 = 一条 Voronoi 边（**同一 Vec3 引用**）
  // 两端焊成同一点 → 短边塌缩，无边可画
  const sharedEdges = new Map<string, SharedEdge>();
  for (const [k, ccs] of edgeCC) {
    const uniq = [...new Set(ccs)];
    if (uniq.length < 2) continue;
    const i = Math.floor(k / n);
    const j = k % n;
    sharedEdges.set(`${i}-${j}`, { a: uniq[0], b: uniq[1] });
  }

  // 3) 每站角点去重排序 → 胞腔；引用与 sharedEdges 一致（已全局 snap，按引用去重）
  const polys: Vec3[][] = new Array(n);
  const neigh: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const u = sites[i];
    const uniq = [...new Set(vertsBySite[i])];
    const up: Vec3 = Math.abs(u[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = normalize(cross(up, u));
    const e2 = normalize(cross(u, e1));
    uniq.sort((p, q) => {
      const ap = Math.atan2(dot(p, e2), dot(p, e1));
      const aq = Math.atan2(dot(q, e2), dot(q, e1));
      return ap - aq;
    });
    polys[i] = uniq;
    neigh[i] = [...adjSets[i]];
  }

  return { polys, sites, neighbors: neigh, sharedEdges };
}

/** 球面多边形质心（归一化顶点平均） */
export function sphericalCentroid(poly: Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of poly) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  if (Math.hypot(x, y, z) < 1e-9) return poly[0];
  return normalize([x, y, z]);
}

export function lloydRelax(sites: Vec3[], iterations = 1): Vec3[] {
  let cur = sites.map((s) => normalize(s));
  for (let it = 0; it < iterations; it++) {
    const { polys } = sphericalVoronoi(cur, 16);
    cur = cur.map((s, i) => {
      const p = polys[i];
      if (!p || p.length < 3) return s;
      return sphericalCentroid(p);
    });
  }
  return cur;
}

export function polyToLonLat(poly: Vec3[]): { lon: number; lat: number }[] {
  return poly.map(vec3ToLonLat);
}

/** 球面多边形近似面积（球面多余角） */
export function sphericalArea(poly: Vec3[]): number {
  if (poly.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const c = poly[(i + 2) % poly.length];
    // 角
    const ab = normalize(cross(a, b));
    const bc = normalize(cross(b, c));
    const cosAng = Math.max(-1, Math.min(1, dot(ab, bc)));
    const ang = Math.acos(cosAng);
    sum += ang;
  }
  return Math.abs(sum - (poly.length - 2) * Math.PI);
}
