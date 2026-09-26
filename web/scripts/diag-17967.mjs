import { createWorld } from '../src/core/world';
import { getProjCache, invalidateProjCache } from '../src/render/projCache';
import { defaultProjParams } from '../src/core/project/projections';

const w = createWorld({ seed: Date.now() & 0xffff, count: 30000 });
const pp = defaultProjParams();
invalidateProjCache();
const pc = getProjCache(w, 'mercator', pp);

const c = w.cells[17967];
if (!c) { console.log('no cell 17967, total:', w.cells.length); process.exit(0); }
const poly = pc.polys[17967];
const pts = [];
for (let i = 0; i < poly.length; i += 2) pts.push([poly[i], poly[i+1]]);

console.log('cell 17967 center:', c.center);
console.log('polygon lons:', c.polygon.map(p => +p.lon.toFixed(1)));
console.log('polygon lats:', c.polygon.map(p => +p.lat.toFixed(1)));
console.log('projected x:', pts.map(p => +p[0].toFixed(3)));
console.log('projected y:', pts.map(p => +p[1].toFixed(3)));

// successive jumps
for (let i = 1; i < pts.length; i++) {
  const dx = pts[i][0] - pts[i-1][0];
  if (Math.abs(dx) > 1.5) console.log(`  JUMP at ${i}: dx=${dx.toFixed(3)}`);
}
// closePath
const dxClose = pts[0][0] - pts[pts.length-1][0];
console.log('closePath dx:', dxClose.toFixed(3), Math.abs(dxClose) > Math.PI ? '>> BIG (crosses map!)' : 'ok');

// check ALL cells with big closePath
let big = 0;
const ex = [];
for (const cl of w.cells) {
  const p = pc.polys[cl.id];
  if (p.length < 6) continue;
  const x0 = p[0], xn = p[p.length-2];
  const d = x0 - xn;
  if (Math.abs(d) > Math.PI * 0.5) {
    big++;
    if (ex.length < 8) ex.push({ id: cl.id, d: +d.toFixed(2), center: cl.center });
  }
}
console.log('\ncells with big closePath:', big, ex);
