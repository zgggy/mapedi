import { createWorld } from '../src/core/world';
import { getProjCache, invalidateProjCache } from '../src/render/projCache';
import { defaultProjParams, project } from '../src/core/project/projections';
import { FRAME_LAT, wrapPeriod } from '../src/render/space';

const w = createWorld({ seed: 42, count: 800 });
const pp = defaultProjParams();
invalidateProjCache();
const pc = getProjCache(w, 'mercator', pp);
const edgeY = project({ lon: 0, lat: FRAME_LAT }, 'mercator', pp).y;
const edgeYs = project({ lon: 0, lat: -FRAME_LAT }, 'mercator', pp).y;
console.log('edgeY N/S', edgeY, edgeYs, 'pi', Math.PI);

for (const c of w.cells) {
  if (Math.abs(c.center.lat) < 88) continue;
  const poly = pc.polys[c.id];
  const pts = [];
  for (let i = 0; i < poly.length; i += 2) pts.push([poly[i], poly[i+1]]);
  console.log('\n=== cell', c.id, 'center', c.center, '===');
  console.log('lon order', c.polygon.map(p => +p.lon.toFixed(1)));
  console.log('lat order', c.polygon.map(p => +p.lat.toFixed(1)));
  console.log('projected pts', pts.map(p => [+p[0].toFixed(2), +p[1].toFixed(2)]));
  const xs = pts.map(p => p[0]);
  console.log('x span', Math.max(...xs)-Math.min(...xs), 'range', Math.min(...xs), Math.max(...xs));
  // gaps along top: does path cover [-pi,pi] at edgeY?
  const onEdge = pts.filter(p => Math.abs(p[1]-edgeY)<1e-6 || Math.abs(p[1]-edgeYs)<1e-6);
  console.log('pts on frame', onEdge);
  // successive x jumps
  for (let i = 1; i < xs.length; i++) {
    const dx = xs[i]-xs[i-1];
    if (Math.abs(dx) > 1.5) console.log('  jump', i, dx.toFixed(2));
  }
  const dclose = xs[0]-xs[xs.length-1];
  console.log('closePath dx (last→first)', dclose.toFixed(2));
}

// How many cells have closePath jump > 0.5π
let big = 0;
const ex = [];
for (const c of w.cells) {
  const poly = pc.polys[c.id];
  if (poly.length < 6) continue;
  const x0 = poly[0], y0 = poly[1];
  const xn = poly[poly.length-2], yn = poly[poly.length-1];
  const jump = Math.hypot(x0-xn, y0-yn);
  if (jump > Math.PI * 0.5) {
    big++;
    if (ex.length < 8) ex.push({ id: c.id, jump: +jump.toFixed(2), center: c.center, n: c.polygon.length });
  }
}
console.log('\nbig closePath jumps', big, ex);
