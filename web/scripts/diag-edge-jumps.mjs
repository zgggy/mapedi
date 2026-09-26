import { createWorld } from '../src/core/world';
import { getProjCache, invalidateProjCache } from '../src/render/projCache';
import { defaultProjParams } from '../src/core/project/projections';

const w = createWorld({ seed: 42, count: 30000 });
const pp = defaultProjParams();
invalidateProjCache();
const pc = getProjCache(w, 'mercator', pp);

// Check ALL edges (including closePath) for large jumps
let bigEdgeCount = 0;
const bigEdgeEx = [];
for (const c of w.cells) {
  const poly = pc.polys[c.id];
  if (poly.length < 6) continue;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const x0 = poly[i * 2];
    const y0 = poly[i * 2 + 1];
    const x1 = poly[((i + 1) % n) * 2];
    const y1 = poly[((i + 1) % n) * 2 + 1];
    const dx = x1 - x0;
    if (Math.abs(dx) > Math.PI * 0.5) {
      bigEdgeCount++;
      if (bigEdgeEx.length < 10) {
        bigEdgeEx.push({
          cell: c.id,
          edge: `${i}->${(i+1)%n}`,
          dx: +dx.toFixed(2),
          from: [+x0.toFixed(2), +y0.toFixed(2)],
          to: [+x1.toFixed(2), +y1.toFixed(2)],
          center: c.center,
        });
      }
    }
  }
}
console.log('big edges (>π/2):', bigEdgeCount);
for (const e of bigEdgeEx) console.log(e);

// Also check if any cell has the horizontal frame line
let frameLineCells = 0;
const frameEx = [];
for (const c of w.cells) {
  const poly = pc.polys[c.id];
  if (poly.length < 6) continue;
  // Check if any edge is nearly horizontal and spans near 2π
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const x0 = poly[i * 2], y0 = poly[i * 2 + 1];
    const x1 = poly[((i+1)%n) * 2], y1 = poly[((i+1)%n) * 2 + 1];
    const dx = Math.abs(x1 - x0);
    const dy = Math.abs(y1 - y0);
    if (dx > Math.PI * 1.5 && dy < 0.1) {
      frameLineCells++;
      if (frameEx.length < 5) frameEx.push({ id: c.id, dx: +dx.toFixed(2), dy: +dy.toFixed(2), center: c.center, y: +y0.toFixed(2) });
    }
  }
}
console.log('frame line cells:', frameLineCells, frameEx);
