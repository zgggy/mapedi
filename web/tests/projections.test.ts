import { describe, expect, it } from 'vitest';
import { project, unproject, defaultProjParams } from '../src/core/project/projections';
import { cellReliefHeights, displayHeight } from '../src/core/relief';
import { createWorld } from '../src/core/world';
import { polarCellIds } from '../src/core/voronoi';
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

  it('polar cells are nearest sites to poles (no lat threshold)', () => {
    const mk = (id: number, lon: number, lat: number): Cell => ({
      id,
      polygon: [],
      center: { lon, lat },
      neighbors: [],
      isOcean: true,
      height: 0,
      area: 1,
    });
    // 极点归属 = 距极方向最近站点（纬度极值派生）；无 88° 阈值、不强制站点贴极
    const cells = [mk(0, 0, 40), mk(1, 0, 80), mk(2, 0, 87), mk(3, 0, -60)];
    const poles = polarCellIds(cells);
    expect(poles.north).toBe(2);
    expect(poles.south).toBe(3);
  });

  it('regular high-lat cell is NOT polar-flattened', () => {
    // 84° 普通格：北面还有 87° 的极点 cell，本格不得压框
    const cells: Cell[] = [
      {
        id: 0,
        polygon: [
          { lon: 10, lat: 83 },
          { lon: 12, lat: 83 },
          { lon: 12, lat: 85.2 },
          { lon: 10, lat: 85.2 },
        ],
        center: { lon: 11, lat: 84 },
        neighbors: [1],
        isOcean: true,
        height: 0,
        area: 1,
      },
      {
        id: 1,
        polygon: [
          { lon: 10, lat: 86 },
          { lon: 12, lat: 86 },
          { lon: 12, lat: 88 },
          { lon: 10, lat: 88 },
        ],
        center: { lon: 11, lat: 87 },
        neighbors: [0],
        isOcean: true,
        height: 0,
        area: 1,
      },
      {
        id: 2,
        polygon: [
          { lon: 10, lat: -86 },
          { lon: 12, lat: -86 },
          { lon: 12, lat: -88 },
          { lon: 10, lat: -88 },
        ],
        center: { lon: 11, lat: -87 },
        neighbors: [],
        isOcean: true,
        height: 0,
        area: 1,
      },
    ];
    const w = {
      meta: { seed: 1, cellCount: 3, formatVersion: 1, createdAt: 0 },
      cells,
      rivers: new Map(),
      layers: [],
      regions: [],
    } as Parameters<typeof getProjCache>[0];
    invalidateProjCache();
    const pc = getProjCache(w, 'mercator', pp);
    const edgeY = proj({ lon: 0, lat: FRAME_LAT }).y;
    const poly = pc.polys[0];
    expect(poly.length).toBeGreaterThanOrEqual(6);
    // 不压框：y 保持真实落差，且无点贴框线（只有极点 cell 才补框闭合）
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < poly.length; i += 2) {
      minY = Math.min(minY, poly[i]);
      maxY = Math.max(maxY, poly[i]);
    }
    expect(maxY - minY).toBeGreaterThan(0.01);
    for (let i = 1; i < poly.length; i += 2) {
      expect(Math.abs(poly[i] - edgeY)).toBeGreaterThan(1e-6);
    }
    expect(pc.polarOutlines.has(0)).toBe(false);
  });

  it('closes north polar cap along frame top without mid-span spikes', () => {
    invalidateProjCache();
    const w = createWorld({ seed: 33, count: 500 });
    const pc = getProjCache(w, 'mercator', pp);
    const poles = polarCellIds(w.cells);
    const poly = pc.polys[poles.north];
    const edgeY = proj({ lon: 0, lat: FRAME_LAT }).y;
    // 真实末边到相邻副本首点，随后仅沿顶框线闭合
    expect(poly[poly.length - 1]).toBeCloseTo(edgeY, 5);
    expect(poly[poly.length - 3]).toBeCloseTo(edgeY, 5);
    // 网格只描真实边（polarOutlines）：无框线点、沿 x 连续无长刺
    const outline = pc.polarOutlines.get(poles.north)!;
    for (let i = 1; i < outline.length; i += 2) {
      expect(Math.abs(outline[i] - edgeY)).toBeGreaterThan(1e-6);
    }
    const n = outline.length / 2;
    for (let i = 1; i < n; i++) {
      const dx = Math.abs(outline[i * 2] - outline[(i - 1) * 2]);
      expect(dx).toBeLessThan(Math.PI * 0.75);
    }
  });

  it('south polar cap closes along frame bottom', () => {
    invalidateProjCache();
    const w = createWorld({ seed: 33, count: 500 });
    const pc = getProjCache(w, 'mercator', pp);
    const poles = polarCellIds(w.cells);
    const poly = pc.polys[poles.south];
    const edgeY = proj({ lon: 0, lat: -FRAME_LAT }).y;
    expect(poly[poly.length - 1]).toBeCloseTo(edgeY, 5);
    expect(poly[poly.length - 3]).toBeCloseTo(edgeY, 5);
    const outline = pc.polarOutlines.get(poles.south)!;
    for (let i = 1; i < outline.length; i += 2) {
      expect(Math.abs(outline[i] - edgeY)).toBeGreaterThan(1e-6);
    }
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

  it('no wrong-copy x steps in pick polys (|Δx| ≤ π; 极冠尾部结构步除外)', () => {
    invalidateProjCache();
    const w = createWorld({ seed: 22, count: 500 });
    const pc = getProjCache(w, 'mercator', pp);
    for (const cell of w.cells) {
      const poly = pc.polys[cell.id];
      if (!poly || poly.length < 6) continue;
      const n = poly.length / 2;
      const isPole = pc.polarOutlines.has(cell.id);
      for (let i = 1; i < n; i++) {
        const dx = Math.abs(poly[i * 2] - poly[(i - 1) * 2]);
        // 极冠尾部三步是结构步（末实边到相邻副本首点、竖直到框、沿框闭合）；
        // 其余相邻点 |Δx| ≤ π 是 unwrap 的结构保证——超过即错副本顶点（长刺）
        if (isPole && i >= n - 3) continue;
        expect(dx).toBeLessThanOrEqual(Math.PI + 1e-9);
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
