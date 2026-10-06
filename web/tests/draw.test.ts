import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { generatePolitical } from '../src/core/political';
import {
  addCellsToRegion,
  cellsInBrush,
  emptyDrawSession,
  floodFillCells,
  resolveDrawTarget,
  stealFromSiblings,
} from '../src/core/draw/brush';

function makeWorld() {
  const w = createWorld({ seed: 55, count: 800 });
  generateDemoContinents(w, 55);
  generatePolitical(w, 55, 4);
  return w;
}

describe('draw brush', () => {
  it('adds cells', () => {
    const w = makeWorld();
    const c = w.regions.find((r) => r.layerId === 'country')!;
    const land = w.cells.find((x) => x.height > 0)!;
    const hits = cellsInBrush(w, land.center.lon, land.center.lat, 5);
    expect(hits.length).toBeGreaterThan(0);
    // 清空后再加，确保 add 有增量
    c.cells = [];
    const n = addCellsToRegion(c, hits);
    expect(n).toBeGreaterThan(0);
    expect(c.cells.length).toBe(n);
  });

  it('country draw resolves to province child', () => {
    const w = makeWorld();
    const country = w.regions.find((r) => r.layerId === 'country')!;
    const session = emptyDrawSession();
    session.active = true;
    session.targetRegionId = country.id;
    const resolved = resolveDrawTarget(w, session);
    expect(resolved).toBeTruthy();
    expect(resolved!.region.layerId).toBe('province');
    expect(resolved!.parent?.id).toBe(country.id);
  });

  it('flood fill returns connected land', () => {
    const w = makeWorld();
    const land = w.cells.find((c) => c.height > 0)!;
    const filled = floodFillCells(w, land.id, true);
    expect(filled.length).toBeGreaterThan(5);
  });

  it('steal from siblings on exclusive layer', () => {
    const w = makeWorld();
    const countries = w.regions.filter((r) => r.layerId === 'country');
    if (countries.length < 2) return;
    const [a, b] = countries;
    const cell = b.cells[0];
    addCellsToRegion(a, [cell]);
    stealFromSiblings(w, a, [cell]);
    expect(b.cells).not.toContain(cell);
    expect(a.cells).toContain(cell);
  });
});
