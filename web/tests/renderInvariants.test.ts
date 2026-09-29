/**
 * 渲染不变量测试：环拓扑 / 奇偶填充 / 周期窗 / 三角组的**结构性保证**。
 *
 * 这是「圈」「内外反」「错乱三角形」「换日线竖线」类 bug 的回归网——
 * 此前这些只在 /tmp 一次性对拍脚本里验证过，147 个既有用例抓不到。
 * 只测几何拓扑不变量，不做渲染/UI。
 */
import { describe, expect, it } from 'vitest';
import {
  chainEdgesToMidpointRings,
  cellSetBoundaryRings,
  cellSetBoundaryEdges,
  indexEdgesByPair,
  orientMemberLeft,
  pseudoEdgeList,
} from '../src/core/ring/build';
import { prepareDisplayRings } from '../src/core/ring/normalize';
import { sampleMidRing } from '../src/core/ring/hermite';
import { triangulateRings, trianglesMatchRings } from '../src/render/gl/triangulate';
import { frameRect } from '../src/render/space';
import { project, defaultProjParams, projectionWorldPeriod } from '../src/core/project/projections';
import { createWorld, rebuildSharedEdgesFromCells } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import type { LonLat, World } from '../src/core/types';

const pp = defaultProjParams();
const proj = (ll: LonLat) => project(ll, 'mercator', pp);
const PERIOD = projectionWorldPeriod('mercator')!;

/** 定向夹具：cell 0 中心在 (0, 2)，边 (0,1)→(1,1) 北侧 */
const worldOrient = {
  cells: [
    { id: 0, center: { lon: 0.5, lat: 2 }, neighbors: [1], height: 1, polygon: [] },
    { id: 1, center: { lon: 0.5, lat: 0 }, neighbors: [0], height: 1, polygon: [] },
  ],
  regions: [], layers: [], sharedEdges: new Map(),
} as unknown as World;

function e(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { p0: a, p1: b };
}

/** 有向面积×2（>0 = 规范手性） */
function area2(pts: { x: number; y: number }[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
  }
  return a;
}

/** 折线自交数（非相邻段相交） */
function selfIntersections(pts: { x: number; y: number }[]): number {
  let cross = 0;
  const n = pts.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    for (let k = i + 2, l = k - 1; k < n; l = k, k++) {
      if (i === 0 && k === n - 1) continue;
      const a = pts[j], b = pts[i], c = pts[l], d = pts[k];
      const den = (b.x - a.x) * (d.y - c.y) - (b.y - a.y) * (d.x - c.x);
      if (Math.abs(den) < 1e-15) continue;
      const t = ((c.x - a.x) * (d.y - c.y) - (c.y - a.y) * (d.x - c.x)) / den;
      const u = ((c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x)) / den;
      if (t > 0 && t < 1 && u > 0 && u < 1) cross++;
    }
  }
  return cross;
}

function parity(rings: { pts: { x: number; y: number }[] }[], x: number, y: number): number {
  let cross = 0;
  for (const ring of rings) {
    const pts = ring.pts;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[j], b = pts[i];
      if ((a.y > y) !== (b.y > y)) {
        const t = (y - a.y) / (b.y - a.y);
        if (x < a.x + t * (b.x - a.x)) cross++;
      }
    }
  }
  return cross & 1;
}

describe('链化构造保证', () => {
  it('8 字链在重复顶点处拆成简单环（无重复顶点）', () => {
    // 两个方框共用一个顶点 B（8 字）→ 必须拆成 2 环，任何环内不得重复顶点
    const A = { x: 0, y: 0 };
    const B = { x: 1, y: 0 };
    const C = { x: 1, y: 1 };
    const D = { x: 0, y: 1 };
    const F = { x: 2, y: 0 };
    const G = { x: 2, y: 1 };
    const rings = chainEdgesToMidpointRings([
      e(A, B), e(B, C), e(C, D), e(D, A),
      e(B, F), e(F, G), e(G, B),
    ]);
    expect(rings.length).toBeGreaterThanOrEqual(2);
    for (const r of rings) {
      const seen = new Set<string>();
      for (const p of r.pts) {
        const k = `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`;
        expect(seen.has(k)).toBe(false); // 不得重复顶点（8 字已拆）
        seen.add(k);
      }
    }
  });

  it('跨 ±180° 缝的链合成一整环（键归一，不裂开）', () => {
    const rings = chainEdgesToMidpointRings([
      e({ x: 179, y: 10 }, { x: 180, y: 11 }),
      e({ x: 180, y: 11 }, { x: -179, y: 10 }),
      e({ x: -179, y: 10 }, { x: -178, y: 9 }),
      e({ x: -178, y: 9 }, { x: 179, y: 10 }),
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0].closed).toBe(true);
    expect(rings[0].pts.length).toBe(4);
  });

  it('边界边定向：成员中心在有向边左侧（cell 归属定内外，非几何猜测）', () => {
    // 不再强转手性：方向由 orientMemberLeft（球面三重积）从成员侧给出。
    const set = new Set([0]);
    // ek='0-1'：成员 cell 0 在边的北侧 → 边必须东行（左=北）
    const e1 = { ek: '0-1', pa: { lon: 0, lat: 1 }, pb: { lon: 1, lat: 1 } };
    const o1 = orientMemberLeft(worldOrient, set, e1);
    expect(o1.pa).toEqual({ lon: 0, lat: 1 }); // 成员在 pa→pb 左侧，无需换向
    // 反向入参：成员在右侧 → 换向
    const o2 = orientMemberLeft(worldOrient, set, { ek: '0-1', pa: e1.pb, pb: e1.pa });
    expect(o2.pa).toEqual({ lon: 0, lat: 1 });
    // 链化保留输入方向（有向走链的输入契约）
    const A = { x: 0, y: 0 };
    const B = { x: 0, y: 1 };
    const C = { x: 1, y: 1 };
    const D = { x: 1, y: 0 };
    const rings = chainEdgesToMidpointRings([e(A, B), e(B, C), e(C, D), e(D, A)]);
    expect(rings.length).toBe(1);
    // 输入为顺时针 → 输出保持顺时针（不再强转）
    expect(area2(rings[0].pts)).toBeLessThan(0);
  });
});

describe('真实世界环不变量（600 cell 生成世界）', () => {
  const world: World = createWorld({ seed: 20260929, count: 600 });
  generateDemoContinents(world, 20260929);
  if (!world.sharedEdges?.size) world.sharedEdges = rebuildSharedEdgesFromCells(world);
  const pair = indexEdgesByPair(world);
  const pseudo = pseudoEdgeList(world, pair);

  // **真实集合 fixture**：generateDemoContinents 不建 regions（regions 由生成链后段的
  // biomes/nature 创建）→ 旧 fixtures 的区域迭代全部空转、断言从不执行
  // （"全绿但 bug 不断"的根源）。改用真实 cell 集：陆地 / 极冠（必产绕行环）/ 海洋 / 连通分量。
  const landSets: number[][] = (() => {
    const out: number[][] = [];
    const land = world.cells.filter((c) => c.height > 0).map((c) => c.id);
    if (land.length > 8) out.push(land);
    const polar = world.cells.filter((c) => Math.abs(c.center.lat) > 60).map((c) => c.id);
    if (polar.length > 8) out.push(polar); // 极冠 → 边界环绕极点 → 绕行环必现
    const sea = world.cells.filter((c) => c.height <= 0).map((c) => c.id);
    if (sea.length > 8) out.push(sea);
    const byId = new Map(world.cells.map((c) => [c.id, c]));
    const seen = new Set<number>();
    let best: number[] = [];
    for (const id of land) {
      if (seen.has(id)) continue;
      const q = [id]; const comp = [id]; seen.add(id);
      while (q.length) {
        const u = q.pop()!;
        for (const n of byId.get(u)?.neighbors ?? []) {
          if (seen.has(n) || (byId.get(n)?.height ?? 0) <= 0) continue;
          seen.add(n); q.push(n); comp.push(n);
        }
      }
      if (comp.length > best.length) best = comp;
    }
    if (best.length > 8) out.push(best);
    return out;
  })();

  const buildClosed = (cells: number[]) => {
    const edges = cellSetBoundaryEdges(world, new Set(cells), pair, pseudo);
    const rings = cellSetBoundaryRings(world, new Set(cells), proj, edges, PERIOD);
    const frameY = { ...frameRect(proj), cylindrical: true };
    const closed: { pts: { x: number; y: number }[] }[] = [];
    for (const r of rings) {
      for (const d of prepareDisplayRings(r, frameY)) closed.push(d);
    }
    return { rings, closed };
  };

  it('同件各环同周期窗（副本平铺不互相抵消）', () => {
    for (const cells of landSets) {
      const { rings } = buildClosed(cells);
      if (rings.length < 2) continue;
      const cx = (r: { pts: { x: number; y: number }[] }) => {
        let mn = Infinity, mx = -Infinity;
        for (const p of r.pts) { if (p.x < mn) mn = p.x; if (p.x > mx) mx = p.x; }
        return (mn + mx) / 2;
      };
      const ref = cx(rings[0]);
      for (let i = 1; i < rings.length; i++) {
        expect(Math.abs(cx(rings[i]) - ref)).toBeLessThan(PERIOD / 2);
      }
    }
  });

  it('绕行环补边侧 = 链净方向（成员在左 → k>0 补北、k<0 补南，环内侧≡成员侧）', () => {
    const frameMax = frameRect(proj).maxY;
    const frameMin = frameRect(proj).minY;
    let wrapChecked = 0;
    for (const cells of landSets) {
      const { rings } = buildClosed(cells);
      for (const r of rings) {
        if (!r.closed || r.pts.length < 3) continue;
        // virtualFrom 在 prepareDisplayRings 的**输出**上（原始 MidRing 没有该字段）
        const disp = prepareDisplayRings(r, { ...frameRect(proj), cylindrical: true });
        for (const d of disp) {
          const v = d.virtualFrom;
          if (v === undefined || v >= d.pts.length) continue; // 非绕行环无补边
          // 净方向（原始环 unwrap 后首尾 x 差的符号）
          const k = Math.sign(r.pts[r.pts.length - 1].x - r.pts[0].x);
          if (k === 0) continue;
          // 补边虚段 = 经线弧 + 极线段：必须贴**行进方向左侧**的极线
          // （k>0 成员在北→极线贴 maxY；k<0→minY）。经线弧点在中间高度，极线点在框边。
          const virtual = d.pts.slice(v);
          const side = k > 0 ? frameMax : frameMin;
          const onEdge = virtual.filter((q) => Math.abs(q.y - side) < 1e-9);
          expect(onEdge.length).toBeGreaterThanOrEqual(2); // 极线段两端点在框边上
          // 补边不过极线：虚拟点全部在成员侧（k>0 北闭合 ≤ maxY；k<0 ≥ minY）
          const inSide = virtual.every((q) => (k > 0 ? q.y <= side + 1e-9 : q.y >= side - 1e-9));
          expect(inSide).toBe(true);
          wrapChecked++;
        }
      }
    }
    expect(wrapChecked).toBeGreaterThan(0); // 极冠集必产绕行环（fixture 真实生效）
  });

  it('奇偶不变量：成员 ≡ XOR(采样闭合环) ⊕ flip（≥95% 吻合）', () => {
    let checked = 0;
    for (const cells of landSets) {
      if (cells.length < 8) continue;
      const { closed } = buildClosed(cells);
      if (!closed.length) continue;
      checked++;
      const sampled = closed.map((d) => ({ pts: sampleMidRing(d as never, 1, 'fill') }));
      const mem = new Set(cells);
      let plain = 0, flip = 0, tot = 0;
      for (let id = 0; id < world.cells.length; id += 3) {
        const c = world.cells[id];
        const p = proj(c.center);
        const par = parity(sampled, p.x, p.y);
        if (mem.has(id)) par ? plain++ : flip++;
        else par ? flip++ : plain++;
        tot++;
      }
      const rate = Math.max(plain, flip) / Math.max(1, tot);
      expect(rate).toBeGreaterThanOrEqual(0.95);
    }
    expect(checked).toBeGreaterThan(0); // fixture 必须真实生效（防空转）
  });

  it('三角组不变量：三角形 XOR 覆盖数 ≡ 环奇偶（earcut 与扇形同一语义）', () => {
    const covers = (tris: Float32Array, x: number, y: number) => {
      let hit = 0;
      for (let k = 0; k + 5 < tris.length; k += 6) {
        const x1 = tris[k], y1 = tris[k + 1], x2 = tris[k + 2], y2 = tris[k + 3], x3 = tris[k + 4], y3 = tris[k + 5];
        const d = (y2 - y3) * (x1 - x3) + (x3 - x2) * (y1 - y3);
        if (Math.abs(d) < 1e-15) continue;
        const a = ((y2 - y3) * (x - x3) + (x3 - x2) * (y - y3)) / d;
        const b = ((y3 - y1) * (x - x3) + (x1 - x3) * (y - y3)) / d;
        const c = 1 - a - b;
        if (a >= 0 && b >= 0 && c >= 0) hit++;
      }
      return hit & 1;
    };
    // 正例：正方形环（earcut 路径）
    const sq = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const okTri = triangulateRings([{ ring: { pts: sq, verts: [], closed: true } as never, pts: sq }]);
    expect(okTri?.areaOk).toBe(true);
    expect(trianglesMatchRings(okTri!.tris, [sq])).toBe(true);
    // 真实世界：每环取样点上「三角 XOR 覆盖 ≡ 环奇偶」
    for (const cells of landSets.slice(0, 3)) {
      const { rings, closed } = buildClosed(cells);
      for (let ri = 0; ri < rings.length; ri++) {
        const d = closed[ri];
        if (!d) continue;
        const pts = sampleMidRing(d as never, 1, 'fill');
        if (pts.length < 3 || pts.length > 400) continue;
        const tri = triangulateRings([{ ring: d as never, pts }]);
        const tris = tri?.areaOk && trianglesMatchRings(tri.tris, [pts]) ? tri.tris : null;
        if (!tris) continue; // 回退扇形路径（奇偶由构造保证）不在本断言内
        for (let t = 0; t < 12; t++) {
          const x = -Math.PI + ((t * 0.37) % 1) * 2 * Math.PI;
          const y = -1.5 + ((t * 0.61) % 1) * 3;
          expect(covers(tris, x, y)).toBe(parity([{ pts }], x, y));
        }
      }
    }
  });


  it('闭合环收尾弦必短：不得出现横穿地图的直连直线（用户报 8 cell 回归）', () => {
    // 用户报障 cell：#24978 #74180 #67089 #14919 #68217 #38317 #72451 #27173
    // 病症 = 环被误标 closed → 收尾弦直连两端 → 画面上一根直线边界
    for (const cells of landSets) {
      const { rings } = buildClosed(cells);
      for (const r of rings) {
        if (!r.closed || r.pts.length < 3) continue;
        // 绕行环（prepare 后带补边）平面首尾差一个周期是设计——先判类型再量弦
        const isWrap = prepareDisplayRings(r, { ...frameRect(proj), cylindrical: true })
          .some((d) => d.virtualFrom !== undefined && d.virtualFrom < d.pts.length);
        if (isWrap) continue;
        const n = r.pts.length;
        const segs: number[] = [];
        for (let i = 0, j = n - 1; i < n; j = i++) {
          segs.push(Math.hypot(r.pts[i].x - r.pts[j].x, r.pts[i].y - r.pts[j].y));
        }
        const med = [...segs].sort((a, b) => a - b)[Math.floor(n / 2)] || 1e-4;
        // 收尾弦（pts[n-1]→pts[0]）必须与普通段同量级（≤ 6×中位段）
        expect(segs[0]).toBeLessThanOrEqual(Math.max(0.02, med * 6));
      }
    }
  });

  it('Hermite 远角不甩尾：采样点不得大幅离开环包围盒', () => {
    // 角点被拉到远处（坏角）时，曲线仍须受段长约束
    const ring = {
      pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }],
      verts: [{ x: 50, y: 50 }, { x: 1, y: 0.5 }, { x: 0.5, y: 1 }, { x: 0, y: 0.5 }],
      closed: true,
    } as never;
    const pts = sampleMidRing(ring, 1, 'fill');
    for (const p of pts) {
      expect(Math.abs(p.x - 0.5)).toBeLessThan(1.2);
      expect(Math.abs(p.y - 0.5)).toBeLessThan(1.2);
    }
  });
});
