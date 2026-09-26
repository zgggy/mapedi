import { createWorld } from '../src/core/world';
import { getProjCache, invalidateProjCache } from '../src/render/projCache';
import { defaultProjParams, project } from '../src/core/project/projections';
import { FRAME_LAT } from '../src/render/space';

const w = createWorld({ seed: 42, count: 800 });
const pp = defaultProjParams();
invalidateProjCache();
const pc = getProjCache(w, 'mercator', pp);

function describe(c) {
  const poly = pc.polys[c.id];
  const pts = [];
  for (let i = 0; i < poly.length; i += 2) pts.push([poly[i], poly[i+1]]);
  const xs = pts.map(p => p[0]);
  const ys = pts.map(p => p[1]);
  const bb = [pc.bboxes[c.id*4], pc.bboxes[c.id*4+1], pc.bboxes[c.id*4+2], pc.bboxes[c.id*4+3]];
  return { id: c.id, center: c.center, n: c.polygon.length, xs: xs.map(v => +v.toFixed(2)), ys: ys.map(v => +v.toFixed(2)), xSpan: +(Math.max(...xs)-Math.min(...xs)).toFixed(2), yRange: [+(Math.min(...ys)).toFixed(2), +(Math.max(...ys)).toFixed(2)], bbox: bb.map(v => +v.toFixed(2)) };
}

// Polar cells
for (const c of w.cells) {
  if (Math.abs(c.center.lat) < 88) continue;
  const d = describe(c);
  console.log(`cell ${d.id} (lat ${d.center.lat > 0 ? 'N' : 'S'}): xSpan=${d.xSpan} yRange=${d.yRange} bbox=${d.bbox}`);
  // Check if frame top/bottom is covered
  const edgeY = project({ lon: 0, lat: c.center.lat > 0 ? FRAME_LAT : -FRAME_LAT }, 'mercator', pp).y;
  const edgePts = d.ys.filter(y => Math.abs(y - edgeY) < 0.01);
  console.log(`  edgeY=${edgeY.toFixed(2)} pts_on_edge=${edgePts.length}`);
  // Check left/right frame edges
  const leftPts = d.xs.filter(x => Math.abs(x + Math.PI) < 0.1);
  const rightPts = d.xs.filter(x => Math.abs(x - Math.PI) < 0.1);
  console.log(`  left_edge_pts=${leftPts.length} right_edge_pts=${rightPts.length}`);
}

// Check big close jumps for all cells
let bigJumps = 0;
for (const c of w.cells) {
  const poly = pc.polys[c.id];
  if (poly.length < 6) continue;
  const x0 = poly[0], y0 = poly[1];
  const xn = poly[poly.length-2], yn = poly[poly.length-1];
  const jump = Math.hypot(x0-xn, y0-yn);
  if (jump > Math.PI * 0.5) bigJumps++;
}
console.log(`\nbig closePath jumps (>π/2): ${bigJumps}`);

// Cell #0
const c0 = w.cells[0];
const d0 = describe(c0);
console.log('\ncell #0:', JSON.stringify(d0));
