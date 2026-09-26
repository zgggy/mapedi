import { createWorld } from '../src/core/world';
import { getProjCache, invalidateProjCache } from '../src/render/projCache';
import { defaultProjParams } from '../src/core/project/projections';

// Generate with a seed that produces 30k cells
const seed = 42;
const w = createWorld({ seed, count: 30000 });
const pp = defaultProjParams();
invalidateProjCache();
const pc = getProjCache(w, 'mercator', pp);

// Find cells with large closePath jumps (last→first)
let bigJumps = [];
for (const c of w.cells) {
  const poly = pc.polys[c.id];
  if (poly.length < 6) continue;
  const x0 = poly[0], y0 = poly[1];
  const xn = poly[poly.length-2], yn = poly[poly.length-1];
  const jump = Math.hypot(x0-xn, y0-yn);
  if (jump > Math.PI * 0.5) {
    bigJumps.push({ id: c.id, jump: +jump.toFixed(2), center: c.center, n: c.polygon.length });
  }
}
console.log('big closePath jumps:', bigJumps.length);
for (const j of bigJumps.slice(0, 10)) console.log(j);

// Also check for cells with span > π (date-line crossing)
let bigSpan = 0;
const spanEx = [];
for (const c of w.cells) {
  const poly = pc.polys[c.id];
  if (poly.length < 6) continue;
  const xs = [];
  for (let i = 0; i < poly.length; i += 2) xs.push(poly[i]);
  const span = Math.max(...xs) - Math.min(...xs);
  if (span > Math.PI) {
    bigSpan++;
    if (spanEx.length < 5) spanEx.push({ id: c.id, span: +span.toFixed(2), center: c.center });
  }
}
console.log('big span (>π):', bigSpan, spanEx);

// Check specific cell if it exists
if (w.cells[17967]) {
  const c = w.cells[17967];
  const poly = pc.polys[17967];
  const pts = [];
  for (let i = 0; i < poly.length; i += 2) pts.push([poly[i], poly[i+1]]);
  console.log('\ncell 17967:', c.center, 'n:', c.polygon.length);
  console.log('lons:', c.polygon.map(p => +p.lon.toFixed(1)));
  console.log('proj:', pts.map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]));
}
