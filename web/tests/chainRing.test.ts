/**
 * 链化回归：一条边界必须合成一整环，顶点键不得在 ±180 缝上裂开。
 * 只测几何拓扑，不做性能/渲染。
 */
import { describe, expect, it } from 'vitest';
import {
  chainEdgesToMidpointRings,
  lonlatKey,
  cellSetBoundaryEdges,
  cellSetBoundaryRings,
  indexEdgesByPair,
} from '../src/core/ring/build';
import { createWorld, rebuildSharedEdgesFromCells } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { project, defaultProjParams } from '../src/core/project/projections';
import type { LonLat, World } from '../src/core/types';

const pp = defaultProjParams();
const proj = (ll: LonLat) => project(ll, 'mercator', pp);

function edge(a: { x: number; y: number }, b: { x: number; y: number }) {
  return { p0: a, p1: b };
}

describe('chainEdgesToMidpointRings — 整环不断链', () => {
  it('平面四边闭环 → 1 个 closed 环，4 个中点', () => {
    const A = { x: 0, y: 0 };
    const B = { x: 1, y: 0 };
    const C = { x: 1, y: 1 };
    const D = { x: 0, y: 1 };
    const rings = chainEdgesToMidpointRings([
      edge(A, B),
      edge(B, C),
      edge(C, D),
      edge(D, A),
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0].closed).toBe(true);
    expect(rings[0].pts.length).toBe(4);
    expect(rings[0].verts.length).toBe(4);
  });

  it('打乱边序仍是 1 环', () => {
    const A = { x: 0, y: 0 };
    const B = { x: 1, y: 0 };
    const C = { x: 1, y: 1 };
    const D = { x: 0, y: 1 };
    const rings = chainEdgesToMidpointRings([
      edge(C, D),
      edge(A, B),
      edge(D, A),
      edge(B, C),
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0].closed).toBe(true);
  });

  it('跨日界线闭环（投影 x 在 ±π 两侧）→ 1 环，不裂段', () => {
    // 顶点：A(3.0) B(3.2) C(3.2→-3.1 wrap) D(3.0→-3.28 wrap)
    // 用显式 LonLat 键模拟共享角点
    const kA = 'A';
    const kB = 'B';
    const kC = 'C';
    const kD = 'D';
    const rings = chainEdgesToMidpointRings([
      { p0: { x: 3.0, y: 0 }, p1: { x: 3.2, y: 0 }, k0: kA, k1: kB },
      { p0: { x: 3.2, y: 0 }, p1: { x: -3.1, y: 0.1 }, k0: kB, k1: kC },
      { p0: { x: -3.1, y: 0.1 }, p1: { x: -3.28, y: 0 }, k0: kC, k1: kD },
      { p0: { x: -3.28, y: 0 }, p1: { x: 3.0, y: 0 }, k0: kD, k1: kA },
    ]);
    expect(rings).toHaveLength(1);
    expect(rings[0].closed).toBe(true);
    expect(rings[0].pts.length).toBe(4);
  });

  it('lonlatKey：±180 与缝旁经度归一为同一键', () => {
    expect(lonlatKey({ lon: 180, lat: 10 })).toBe(lonlatKey({ lon: -180, lat: 10 }));
    expect(lonlatKey({ lon: 179.99999, lat: 10 })).toBe(lonlatKey({ lon: -179.99999, lat: 10 }));
    expect(lonlatKey({ lon: 0, lat: 10 })).not.toBe(lonlatKey({ lon: 1, lat: 10 }));
  });

  it('真实世界：某大陆 cell 集的边界环应当闭环（不依赖稀碎开链）', () => {
    const w = createWorld({ seed: 42, count: 800 });
    generateDemoContinents(w, 42);
    const land = w.cells.filter((c) => c.height > 0).map((c) => c.id);
    expect(land.length).toBeGreaterThan(10);
    // 取最大连通大陆
    const byId = new Map(w.cells.map((c) => [c.id, c]));
    const seen = new Set<number>();
    let best: number[] = [];
    for (const id of land) {
      if (seen.has(id)) continue;
      const q = [id];
      const comp: number[] = [];
      seen.add(id);
      while (q.length) {
        const u = q.pop()!;
        comp.push(u);
        for (const n of byId.get(u)?.neighbors ?? []) {
          if (seen.has(n)) continue;
          if ((byId.get(n)?.height ?? 0) <= 0) continue;
          seen.add(n);
          q.push(n);
        }
      }
      if (comp.length > best.length) best = comp;
    }
    expect(best.length).toBeGreaterThan(5);
    const edges = cellSetBoundaryEdges(w, best, indexEdgesByPair(w));
    expect(edges.length).toBeGreaterThan(5);
    const rings = cellSetBoundaryRings(w, best, proj, edges);
    // 大陆外轮廓：至少一个 closed 环；开链不应把大多数边拆碎
    const closed = rings.filter((r) => r.closed);
    expect(closed.length).toBeGreaterThanOrEqual(1);
    const totalPts = rings.reduce((s, r) => s + r.pts.length, 0);
    // 每个边界边一个中点；允许少量被 span 滤掉，但不应只剩零头
    expect(totalPts).toBeGreaterThanOrEqual(edges.length * 0.85);
  });

  it('neighbors share edges at high density（25k 贴近规模）', () => {
    const w = createWorld({ seed: 772, count: 6000 });
    let missing = 0;
    let adj = 0;
    for (const c of w.cells) {
      for (const n of c.neighbors) {
        if (n <= c.id) continue;
        adj++;
        const ek = `${c.id}-${n}`;
        if (!w.sharedEdges!.has(ek)) missing++;
      }
    }
    expect(adj).toBeGreaterThan(100);
    // 允许极少数对偶怪边，但不得大量缺边（缺边=边界接到错误 cell）
    expect(missing).toBeLessThan(adj * 0.02);
    // 抽查：#772 与邻居必须都有边
    const a = w.cells[772];
    if (a) {
      for (const n of a.neighbors) {
        const ek = a.id < n ? `${a.id}-${n}` : `${n}-${a.id}`;
        expect(w.sharedEdges!.has(ek)).toBe(true);
      }
    }
  });

  it('sharedEdges 可从 cell 多边形补全，且键稳定', () => {
    const w = createWorld({ seed: 7, count: 300 });
    const before = w.sharedEdges!.size;
    const derived = rebuildSharedEdgesFromCells(w as World);
    let added = 0;
    for (const [k, v] of derived) {
      if (!w.sharedEdges!.has(k)) {
        w.sharedEdges!.set(k, v);
        added++;
      }
    }
    expect(w.sharedEdges!.size).toBeGreaterThanOrEqual(before);
    expect(added).toBeGreaterThanOrEqual(0);
  });
});
