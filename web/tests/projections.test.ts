import { describe, expect, it } from 'vitest';
import { project, unproject, defaultProjParams } from '../src/core/project/projections';
import { cellReliefHeights, displayHeight } from '../src/core/relief';
import { createWorld } from '../src/core/world';
import { buildFlatCellPoly, isPolarCellCenter } from '../src/core/project/polarPoly';
import { getProjCache, invalidateProjCache } from '../src/render/projCache';
import { FRAME_LAT } from '../src/render/space';
import type { Cell } from '../src/core/types';

const pp = defaultProjParams();

describe('projections', () => {
  it('mercator roundtrip', () => {
    const p = { lon: 30, lat: 40 };
    const xy = project(p, 'mercator', pp);
    const back = unproject(xy.x, xy.y, 'mercator', pp);
    expect(back.lon).toBeCloseTo(30, 5);
    expect(back.lat).toBeCloseTo(40, 5);
  });

  it('behrmann roundtrip near equator', () => {
    const p = { lon: 10, lat: 5 };
    const xy = project(p, 'behrmann', pp);
    const back = unproject(xy.x, xy.y, 'behrmann', pp);
    expect(back.lon).toBeCloseTo(10, 3);
    expect(back.lat).toBeCloseTo(5, 3);
  });

  it('aeqd center identity', () => {
    const c = { lon: 20, lat: 30 };
    const params = { ...pp, aeqdCenter: c };
    const xy = project(c, 'aeqd', params);
    expect(Math.hypot(xy.x, xy.y)).toBeLessThan(1e-6);
  });
});

describe('polar cell mercator poly', () => {
  const proj = (ll: { lon: number; lat: number }) => project(ll, 'mercator', pp);

  it('shared vertex projects to identical xy across cells（含近 ±180）', () => {
    const shared = { lon: 179.5, lat: 10 };
    const a: Cell = {
      id: 0,
      polygon: [
        shared,
        { lon: 175, lat: 5 },
        { lon: 170, lat: 12 },
      ],
      center: { lon: 175, lat: 9 },
      neighbors: [1],
      isOcean: true,
      height: 0,
      area: 1,
    };
    const b: Cell = {
      id: 1,
      polygon: [
        shared,
        { lon: -175, lat: 5 },
        { lon: -170, lat: 12 },
      ],
      center: { lon: -175, lat: 9 },
      neighbors: [0],
      isOcean: true,
      height: 0,
      area: 1,
    };
    const w = {
      meta: { seed: 1, cellCount: 2, formatVersion: 1, createdAt: 0 },
      cells: [a, b],
      rivers: new Map(),
      layers: [],
      regions: [],
      continents: [],
    } as Parameters<typeof getProjCache>[0];
    invalidateProjCache();
    const pc = getProjCache(w, 'mercator', pp);
    const find = (poly: Float64Array, y: number) => {
      for (let i = 0; i < poly.length; i += 2) {
        if (Math.abs(poly[i + 1] - y) < 1e-6 && Math.abs(poly[i] - 3.13) < 0.2) {
          return { x: poly[i], y: poly[i + 1] };
        }
      }
      // 共享点：lat 10 → 找 y 最接近 project(lat10)
      const y10 = project({ lon: 0, lat: 10 }, 'mercator', pp).y;
      for (let i = 0; i < poly.length; i += 2) {
        if (Math.abs(poly[i + 1] - y10) < 1e-3) {
          return { x: poly[i], y: poly[i + 1] };
        }
      }
      return null;
    };
    const ya = find(pc.polys[0], 0);
    const yb = find(pc.polys[1], 0);
    expect(ya && yb).toBeTruthy();
    // 圆柱面：允许差 2π（世界副本下重合）；微缝不允许
    const dx = Math.abs(ya!.x - yb!.x);
    const dWrap = Math.min(dx, Math.abs(dx - Math.PI * 2));
    expect(dWrap).toBeLessThan(1e-3);
    expect(ya!.y).toBeCloseTo(yb!.y, 6);
  });

  it('same-side cells share exact vertex xy', () => {
    const shared = { lon: 20.0, lat: 10 };
    const a: Cell = {
      id: 0,
      polygon: [shared, { lon: 15, lat: 5 }, { lon: 10, lat: 12 }],
      center: { lon: 15, lat: 9 },
      neighbors: [1],
      isOcean: true,
      height: 0,
      area: 1,
    };
    const b: Cell = {
      id: 1,
      polygon: [shared, { lon: 25, lat: 5 }, { lon: 30, lat: 12 }],
      center: { lon: 25, lat: 9 },
      neighbors: [0],
      isOcean: true,
      height: 0,
      area: 1,
    };
    const w = {
      meta: { seed: 1, cellCount: 2, formatVersion: 1, createdAt: 0 },
      cells: [a, b],
      rivers: new Map(),
      layers: [],
      regions: [],
      continents: [],
    } as Parameters<typeof getProjCache>[0];
    invalidateProjCache();
    const pc = getProjCache(w, 'mercator', pp);
    const pick = (poly: Float64Array) => {
      const y10 = project({ lon: 0, lat: 10 }, 'mercator', pp).y;
      for (let i = 0; i < poly.length; i += 2) {
        if (Math.abs(poly[i + 1] - y10) < 1e-3) return { x: poly[i], y: poly[i + 1] };
      }
      return null;
    };
    const xa = pick(pc.polys[0]);
    const xb = pick(pc.polys[1]);
    expect(xa!.x).toBeCloseTo(xb!.x, 9);
    expect(xa!.y).toBeCloseTo(xb!.y, 9);
  });

  it('detects polar center only near true poles', () => {
    expect(isPolarCellCenter({ lon: 0, lat: 90 })).toBe(true);
    expect(isPolarCellCenter({ lon: 0, lat: -89 })).toBe(true);
    expect(isPolarCellCenter({ lon: 0, lat: 80 })).toBe(false);
    expect(isPolarCellCenter({ lon: 0, lat: 87 })).toBe(false);
    expect(isPolarCellCenter({ lon: 0, lat: 40 })).toBe(false);
  });

  it('regular high-lat cell is NOT polar-flattened', () => {
    // 普通小格：中心 84°，环很小
    const ring = [
      { lon: 10, lat: 83 },
      { lon: 12, lat: 83 },
      { lon: 12, lat: 85.2 },
      { lon: 10, lat: 85.2 },
    ];
    const flat = buildFlatCellPoly(ring, { lon: 11, lat: 84 }, proj);
    expect(flat.polar).toBe(false);
    // 不应被压到同一条框线
    const ys = [flat.xy[1], flat.xy[3], flat.xy[5], flat.xy[7]];
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.01);
  });

  it('closes north polar cap along frame top without mid-span spikes', () => {
    // 模拟绕极边界环：lat≈80，lon 走满一圈
    const ring = [];
    for (let i = 0; i < 24; i++) {
      const lon = -180 + (360 * i) / 23;
      ring.push({ lon, lat: 80 + Math.sin(i) * 0.5 });
    }
    const flat = buildFlatCellPoly(ring, { lon: 0, lat: 90 }, proj);
    expect(flat.polar).toBe(true);
    const edgeY = proj({ lon: 0, lat: FRAME_LAT }).y;
    // 顶点不越过外框
    expect(flat.maxY).toBeLessThanOrEqual(edgeY + 1e-6);
    // 沿 x 连续：相邻顶点不出现跨半球长刺
    const xs: number[] = [];
    for (let i = 0; i < flat.xy.length; i += 2) xs.push(flat.xy[i]);
    for (let i = 1; i < xs.length - 2; i++) {
      expect(Math.abs(xs[i] - xs[i - 1])).toBeLessThan(Math.PI * 0.2);
    }
    // 闭合两点落在框线
    expect(flat.xy[flat.xy.length - 1]).toBeCloseTo(edgeY, 5);
    expect(flat.xy[flat.xy.length - 3]).toBeCloseTo(edgeY, 5);
  });

  it('south polar cap closes along frame bottom', () => {
    const ring = [];
    for (let i = 0; i < 16; i++) {
      const lon = -180 + (360 * i) / 15;
      ring.push({ lon, lat: -80 });
    }
    const flat = buildFlatCellPoly(ring, { lon: 0, lat: -90 }, proj);
    expect(flat.polar).toBe(true);
    const edgeY = proj({ lon: 0, lat: -FRAME_LAT }).y;
    expect(flat.minY).toBeGreaterThanOrEqual(edgeY - 1e-6);
  });

  it('world pole cells from createWorld build finite non-spike polys', () => {
    invalidateProjCache();
    const w = createWorld({ seed: 11, count: 400 });
    const pc = getProjCache(w, 'mercator', pp);
    const north = w.cells.reduce((a, b) => (b.center.lat > a.center.lat ? b : a));
    const south = w.cells.reduce((a, b) => (b.center.lat < a.center.lat ? b : a));
    for (const c of [north, south] as Cell[]) {
      const poly = pc.polys[c.id];
      expect(poly.length).toBeGreaterThanOrEqual(6);
      for (let i = 0; i < poly.length; i++) {
        expect(Number.isFinite(poly[i])).toBe(true);
      }
      // 相邻顶点 x 连续（无横穿全图长刺）
      for (let i = 2; i < poly.length - 4; i += 2) {
        const dx = Math.abs(poly[i] - poly[i - 2]);
        expect(dx).toBeLessThan(3.5);
      }
    }
  });

  it('no ordinary cell has mercator long spikes (sphere-ok / mercator-bad)', () => {
    invalidateProjCache();
    const w = createWorld({ seed: 22, count: 500 });
    const pc = getProjCache(w, 'mercator', pp);
    for (const cell of w.cells) {
      const poly = pc.polys[cell.id];
      if (!poly || poly.length < 6) continue;
      const n = poly.length / 2;
      for (let i = 1; i < n; i++) {
        const dx = Math.abs(poly[i * 2] - poly[(i - 1) * 2]);
        // 极冠最后一跳是沿框线闭合，允许大步；其余必须连续
        const isPolarClose = i >= n - 2;
        if (!isPolarClose) {
          expect(dx).toBeLessThan(Math.PI * 0.75);
        }
      }
    }
  });
});

describe('relief', () => {
  it('smooth blends toward neighbors', () => {
    const w = createWorld({ seed: 1, count: 50 });
    const cell = w.cells[0];
    cell.height = 1;
    for (const n of cell.neighbors) w.cells[n].height = 0;
    const s0 = cellReliefHeights(w, cell, 0);
    const s1 = cellReliefHeights(w, cell, 1);
    expect(s0.polyHeights[0]).toBeCloseTo(1, 5);
    expect(s1.polyHeights[0]).toBeCloseTo(0, 5);
    expect(displayHeight(cell, cell.neighbors.map((id) => w.cells[id]), 0)).toBe(1);
  });
});
