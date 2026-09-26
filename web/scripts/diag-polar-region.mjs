import { createWorld } from '../src/core/world';
import { getProjCache, invalidateProjCache } from '../src/render/projCache';
import { defaultProjParams, project } from '../src/core/project/projections';
import { FRAME_LAT } from '../src/render/space';
import { cellSetBoundaryRings } from '../src/core/ring/build';
import { prepareDisplayRings } from '../src/core/ring/normalize';

const w = createWorld({ seed: 42, count: 800 });
const pp = defaultProjParams();
invalidateProjCache();
const pcache = getProjCache(w, 'mercator', pp);
const projectFn = (ll) => project(ll, 'mercator', pp);

// Find the north polar cell
const northCell = w.cells.reduce((a, b) => b.center.lat > a.center.lat ? b : a);
console.log('North polar cell:', northCell.id, 'lat:', northCell.center.lat);

// Get region boundary for all cells near the pole (lat > 80)
const polarCells = w.cells.filter(c => c.center.lat > 80).map(c => c.id);
console.log('Polar cells (lat > 80):', polarCells.length);

// Get boundary rings for polar region
const frY = {
  minY: project({ lon: 0, lat: -FRAME_LAT }, 'mercator', pp).y,
  maxY: project({ lon: 0, lat: FRAME_LAT }, 'mercator', pp).y,
};
const rings = cellSetBoundaryRings(w, polarCells, projectFn);
console.log('Boundary rings:', rings.length);
for (let i = 0; i < rings.length; i++) {
  const ring = rings[i];
  const pts = ring.pts ?? [];
  console.log(`  Ring ${i}: pts=${pts.length} closed=${ring.closed}`);
  if (pts.length > 0) {
    const xs = pts.map(p => p.x);
    const ys = pts.map(p => p.y);
    const xSpan = Math.max(...xs) - Math.min(...xs);
    const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
    console.log(`    xSpan=${xSpan.toFixed(2)} meanY=${meanY.toFixed(2)} frameAbs=${frY.maxY.toFixed(2)}`);
    console.log(`    xRange=[${Math.min(...xs).toFixed(2)}, ${Math.max(...xs).toFixed(2)}]`);
    console.log(`    nearPole? ${Math.abs(meanY) >= frY.maxY * 0.7}`);
    console.log(`    wraps? ${xSpan > Math.PI * 0.85}`);
  }
  // Check if ring renders as DisplayRing
  const displayRings = prepareDisplayRings(ring, frY);
  console.log(`    DisplayRings: ${displayRings.length}`);
  for (let j = 0; j < displayRings.length; j++) {
    const dr = displayRings[j];
    const dxs = dr.pts.map(p => p.x);
    const dys = dr.pts.map(p => p.y);
    console.log(`      DR ${j}: pts=${dr.pts.length} closed=${dr.closed} xRange=[${Math.min(...dxs).toFixed(2)}, ${Math.max(...dxs).toFixed(2)}] yRange=[${Math.min(...dys).toFixed(2)}, ${Math.max(...dys).toFixed(2)}]`);
  }
}
