import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import type { Region } from '../src/core/types';
import {
  buildRoadSegments,
  dragRoadEndpoint,
  roadComponentCount,
} from '../src/core/draw/roads';
import { cellsInPolygon, adjustWeights } from '../src/core/draw/brush';

function makeWorld() {
  const w = createWorld({ seed: 77, count: 600 });
  generateDemoContinents(w, 77);
  return w;
}

describe('roads', () => {
  it('builds segments from adjacent cells', () => {
    const w = makeWorld();
    const land = w.cells.filter((c) => c.height > 0);
    const a = land[0];
    const b = a.neighbors.find((n) => w.cells[n].height > 0);
    expect(b).toBeDefined();
    const road: Region = {
      id: 'r1',
      layerId: 'road',
      name: '道',
      cells: [a.id, b!],
      color: '#fff',
      attributes: {},
    };
    const segs = buildRoadSegments(w, road);
    expect(segs.length).toBe(1);
    expect(roadComponentCount(w, road)).toBe(1);
  });

  it('detects breaks', () => {
    const w = makeWorld();
    const land = w.cells.filter((c) => c.height > 0);
    const road: Region = {
      id: 'r2',
      layerId: 'road',
      name: '断',
      cells: [land[0].id, land[land.length - 1].id],
      color: '#fff',
      attributes: {},
    };
    expect(roadComponentCount(w, road)).toBe(2);
  });

  it('drag endpoint transfer', () => {
    const w = makeWorld();
    const land = w.cells.filter((c) => c.height > 0);
    const a = land[0];
    const b = a.neighbors.find((n) => w.cells[n].height > 0)!;
    const c = land.find((x) => x.id !== a.id && x.id !== b && !a.neighbors.includes(x.id))!;
    const road: Region = {
      id: 'r3',
      layerId: 'road',
      name: '拖',
      cells: [a.id, b],
      color: '#fff',
      attributes: {},
    };
    const res = dragRoadEndpoint(w, road, a.id, c.center.lon, c.center.lat, c.id, false);
    expect(res).toBe('transfer');
    expect(road.cells).not.toContain(a.id);
    expect(road.cells).toContain(c.id);
  });
});

describe('lasso + weight', () => {
  it('polygon hit cells', () => {
    const w = makeWorld();
    const land = w.cells.filter((c) => c.height > 0)[0];
    const poly = [
      { lon: land.center.lon - 5, lat: land.center.lat - 5 },
      { lon: land.center.lon + 5, lat: land.center.lat - 5 },
      { lon: land.center.lon + 5, lat: land.center.lat + 5 },
      { lon: land.center.lon - 5, lat: land.center.lat + 5 },
    ];
    const hits = cellsInPolygon(w, poly);
    expect(hits.length).toBeGreaterThan(0);
  });

  it('weight to zero removes membership', () => {
    const w = makeWorld();
    const land = w.cells.find((c) => c.height > 0)!;
    const region: Region = {
      id: 'cul',
      layerId: 'culture',
      name: '文',
      cells: [land.id],
      color: '#fff',
      attributes: {},
    };
    adjustWeights(region, [land.id], -1);
    expect(region.cells).not.toContain(land.id);
  });
});
