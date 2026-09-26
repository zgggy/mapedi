import { createWorld } from '../src/core/world';
import { getProjCache, invalidateProjCache } from '../src/render/projCache';
import { defaultProjParams } from '../src/core/project/projections';
import { isPolarCellCenter } from '../src/core/project/polarPoly';

const w = createWorld({ seed: 42, count: 30000 });
const pp = defaultProjParams();
invalidateProjCache();
const pc = getProjCache(w, 'mercator', pp);

// Find cells that would be detected as polar with new threshold
let polarCount = 0;
for (const c of w.cells) {
  const poly = pc.polys[c.id];
  if (poly.length < 6) continue;
  const xs = [];
  for (let i = 0; i < poly.length; i += 2) xs.push(poly[i]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const polar = isPolarCellCenter(c.center, 89.5) && spanX > Math.PI * 1.95;
  if (polar) {
    polarCount++;
    console.log(`polar cell ${c.id}: lat=${c.center.lat.toFixed(2)} spanX=${spanX.toFixed(2)} (${(spanX/Math.PI).toFixed(2)}π)`);
  }
}
console.log('total polar cells:', polarCount);

// Also check cells with spanX > 1.2π (old threshold) but lat < 89.5
let falsePositives = 0;
for (const c of w.cells) {
  const poly = pc.polys[c.id];
  if (poly.length < 6) continue;
  const xs = [];
  for (let i = 0; i < poly.length; i += 2) xs.push(poly[i]);
  const spanX = Math.max(...xs) - Math.min(...xs);
  const oldPolar = isPolarCellCenter(c.center, 88.5) && spanX > Math.PI * 1.2;
  const newPolar = isPolarCellCenter(c.center, 89.5) && spanX > Math.PI * 1.95;
  if (oldPolar && !newPolar) {
    falsePositives++;
    if (falsePositives <= 5) console.log(`  old=true new=false: cell ${c.id} lat=${c.center.lat.toFixed(2)} spanX=${(spanX/Math.PI).toFixed(2)}π`);
  }
}
console.log('cells that would be false positives with old threshold:', falsePositives);
