import { createWorld } from '../src/core/world';
import { getProjCache, invalidateProjCache } from '../src/render/projCache';
import { defaultProjParams } from '../src/core/project/projections';
import { project } from '../src/core/project/projections';
import { isPolarCellCenter } from '../src/core/project/polarPoly';
import { wrapPeriod } from '../src/render/space';

const w = createWorld({ seed: 42, count: 800 });
const pp = defaultProjParams();
invalidateProjCache();
const pc = getProjCache(w, 'mercator', pp);

function describe(c) {
  const lons = c.polygon.map(p => p.lon);
  const lats = c.polygon.map(p => p.lat);
  const xs = [];
  for (let i = 0; i < pc.polys[c.id].length; i += 2) xs.push(pc.polys[c.id][i]);
  let spanLon = 0;
  for (let i = 1; i < lons.length; i++) {
    let d = lons[i] - lons[0];
    // rough
  }
  // unwrap lon span
  let ul = [lons[0]];
  for (let i = 1; i < lons.length; i++) {
    let x = lons[i];
    const ref = ul[i-1];
    while (x - ref > 180) x -= 360;
    while (x - ref < -180) x += 360;
    ul.push(x);
  }
  const lonSpan = Math.max(...ul) - Math.min(...ul);
  const xSpan = xs.length ? Math.max(...xs) - Math.min(...xs) : 0;
  const bb = [pc.bboxes[c.id*4], pc.bboxes[c.id*4+1], pc.bboxes[c.id*4+2], pc.bboxes[c.id*4+3]];
  return {
    id: c.id,
    center: c.center,
    nVerts: c.polygon.length,
    nBs: c.neighbors.length,
    lons: lons.map(v => +v.toFixed(2)),
    lats: lats.map(v => +v.toFixed(2)),
    lonSpan: +lonSpan.toFixed(1),
    xSpan: +xSpan.toFixed(2),
    xRange: xs.length ? [+Math.min(...xs).toFixed(2), +Math.max(...xs).toFixed(2)] : null,
    polarCenter: isPolarCellCenter(c.center, 88.5),
    // close edge
    closeDx: xs.length >= 2 ? +(xs[0] - xs[xs.length-2]).toFixed(2) : null,
    firstLastDx: xs.length >= 2 ? +(xs[0] - xs[xs.length-2]).toFixed(2) : null,
    rawCloseDx: xs.length >= 4 ? +(xs[0] - xs[xs.length-2]).toFixed(2) : null,
    polyCloseDx: pc.polys[c.id].length >= 4
      ? +(pc.polys[c.id][0] - pc.polys[c.id][pc.polys[c.id].length-2]).toFixed(2)
      : null,
    bbox: bb.map(v => +v.toFixed(2)),
  };
}

const c0 = w.cells[0];
console.log('CELL 0', JSON.stringify(describe(c0), null, 2));

// poles
const north = w.cells.reduce((a,b) => b.center.lat > a.center.lat ? b : a);
const south = w.cells.reduce((a,b) => b.center.lat < a.center.lat ? b : a);
console.log('NORTH', JSON.stringify(describe(north), null, 2));
console.log('SOUTH', JSON.stringify(describe(south), null, 2));

// count cells with large close jump
let bigClose = 0, polarCount = 0, spanOverPi = 0;
const examples = [];
for (const c of w.cells) {
  const poly = pc.polys[c.id];
  if (poly.length < 4) continue;
  const xs = [];
  for (let i = 0; i < poly.length; i += 2) xs.push(poly[i]);
  // path edges including close
  let maxJump = 0;
  for (let i = 1; i < xs.length; i++) maxJump = Math.max(maxJump, Math.abs(xs[i]-xs[i-1]));
  maxJump = Math.max(maxJump, Math.abs(xs[0]-xs[xs.length-1])); // if closed by path2d to first... actually last added points
  // cellPolyPath2D closePath connects last to first of the ring as stored
  // stored ring may include polar close points; closePath is last→first of Float64Array
  const jumpClose = Math.abs(xs[0] - xs[xs.length-1]);
  const span = Math.max(...xs) - Math.min(...xs);
  const polar = isPolarCellCenter(c.center, 88.5) && span > Math.PI * 1.2;
  if (polar) polarCount++;
  if (span > Math.PI) spanOverPi++;
  if (jumpClose > Math.PI * 0.9) {
    bigClose++;
    if (examples.length < 6) examples.push({ id: c.id, jumpClose: +jumpClose.toFixed(2), span: +span.toFixed(2), polar, center: c.center, n: c.polygon.length });
  }
}
console.log({ bigClose, polarCount, spanOverPi, examples });
