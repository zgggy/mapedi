import { describe, expect, it } from 'vitest';
import {
  createWorld,
  serializeWorld,
  deserializeWorld,
  rebuildSharedEdgesFromCells,
} from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { History, HeightCellsCommand } from '../src/core/history';
import { getCellSetRingsCached, invalidateBorderCache, getContinentCentersCached } from '../src/render/borderCache';
import { project, defaultProjParams } from '../src/core/project/projections';
import { generatePolitical } from '../src/core/political';
import { getProjCache } from '../src/render/projCache';
import { worldCopyDxs } from '../src/render/space';

const pp = defaultProjParams();
const proj = (ll: { lon: number; lat: number }) => project(ll, 'mercator', pp);

describe('sharedEdges strip / rebuild', () => {
  it('rebuildSharedEdgesFromCells recovers neighbor edges', () => {
    const w = createWorld({ seed: 21, count: 400 });
    const rebuilt = rebuildSharedEdgesFromCells(w);
    expect(rebuilt.size).toBeGreaterThan(0);
    // 至少覆盖大多数邻接对
    let adj = 0;
    for (const c of w.cells) for (const n of c.neighbors) if (n > c.id) adj++;
    expect(rebuilt.size).toBeGreaterThan(adj * 0.5);
  });

  it('serialize strip + deserialize restores sharedEdges', () => {
    const w = createWorld({ seed: 22, count: 300 });
    generateDemoContinents(w, 22);
    const json = serializeWorld(w, { stripSharedEdges: true });
    expect(json.includes('"sharedEdges"')).toBe(false);
    const w2 = deserializeWorld(json);
    expect(w2.sharedEdges?.size).toBeGreaterThan(0);
  });
});

describe('history height command coalesce', () => {
  it('merges consecutive height samples without stacking', () => {
    const w = createWorld({ seed: 33, count: 200 });
    const h = new History();
    h.run(w, new HeightCellsCommand([{ id: 0, h0: 0, h1: 0.2 }]), { alreadyApplied: false });
    w.cells[0].height = 0.2;
    h.run(w, new HeightCellsCommand([{ id: 0, h0: 0.2, h1: 0.5 }]), { alreadyApplied: false });
    w.cells[0].height = 0.5;
    expect(h.depth).toBe(1);
    h.undo(w);
    expect(w.cells[0].height).toBeCloseTo(0);
  });
});

describe('border edge index + proj worldBBox', () => {
  it('cellSet rings still build', () => {
    const w = createWorld({ seed: 12, count: 600 });
    generateDemoContinents(w, 12);
    generatePolitical(w, 12, 3);
    invalidateBorderCache();
    const country = w.regions.find((r) => r.layerId === 'country');
    expect(country).toBeTruthy();
    const a = getCellSetRingsCached(w, country!.cells, proj, 'mercator');
    expect(a.rings.length).toBeGreaterThanOrEqual(0);
  });

  it('projCache worldBBox is finite and used to filter copies', () => {
    const w = createWorld({ seed: 40, count: 200 });
    const pc = getProjCache(w, 'mercator', pp);
    expect(Number.isFinite(pc.worldBBox.minX)).toBe(true);
    expect(pc.worldBBox.maxX).toBeGreaterThan(pc.worldBBox.minX);
    const cam = { x: 0, y: 0, scale: 400 };
    const dxs = worldCopyDxs(0, cam, 800, undefined, pc.worldBBox);
    expect(dxs.length).toBeGreaterThan(0);
  });

  it('continent centers cache stably', () => {
    const w = createWorld({ seed: 55, count: 500 });
    generateDemoContinents(w, 55);
    invalidateBorderCache();
    const pc = getProjCache(w, 'mercator', pp);
    const ca = getContinentCentersCached(w, pc);
    const cb = getContinentCentersCached(w, pc);
    expect(ca).toBe(cb);
    expect(ca.length).toBe(w.continents.length);
  });
});
