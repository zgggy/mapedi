/** 验收：全局顶点表后，邻接共享角点必须同一坐标 */
import { createWorld, serializeWorld, deserializeWorld } from '../src/core/world';
import { lonlatKey } from '../src/core/ring/build';

function distDeg(p, q) {
  let dLon = Math.abs(p.lon - q.lon);
  dLon = Math.min(dLon, 360 - dLon);
  return Math.hypot(dLon, p.lat - q.lat);
}

function shareStats(world, label) {
  let s0 = 0, s1 = 0, s2p = 0;
  let uniqueTotal = 0, cellsU = 0, maxU = 0;
  let nearMiss = 0;
  const nearEx = [];
  for (const c of world.cells) {
    for (const n of c.neighbors) {
      if (n <= c.id) continue;
      const nc = world.cells[n];
      const keysB = new Set(nc.polygon.map(lonlatKey));
      let shared = 0;
      for (const p of c.polygon) if (keysB.has(lonlatKey(p))) shared++;
      if (shared === 0) s0++;
      else if (shared === 1) s1++;
      else s2p++;
    }
  }
  for (const c of world.cells) {
    let u = 0;
    for (const p of c.polygon) {
      const k = lonlatKey(p);
      let found = false;
      let best = Infinity;
      for (const n of c.neighbors) {
        for (const q of world.cells[n].polygon) {
          if (lonlatKey(q) === k) { found = true; break; }
          const d = distDeg(p, q);
          if (d < best) best = d;
        }
        if (found) break;
      }
      if (!found) {
        u++;
        if (best < 0.1 && best > 0) {
          nearMiss++;
          if (nearEx.length < 5) nearEx.push({ cell: c.id, best });
        }
      }
    }
    if (u > 0) {
      cellsU++;
      uniqueTotal += u;
      if (u > maxU) maxU = u;
    }
  }
  // sharedEdges 端点是否落在 polygon 上（引用/键）
  let edgeOk = 0, edgeBad = 0;
  if (world.sharedEdges) {
    for (const [ek, [a, b]] of world.sharedEdges) {
      const [i, j] = ek.split('-').map(Number);
      const ka = lonlatKey(a), kb = lonlatKey(b);
      const pi = new Set(world.cells[i].polygon.map(lonlatKey));
      const pj = new Set(world.cells[j].polygon.map(lonlatKey));
      const ok = pi.has(ka) && pi.has(kb) && pj.has(ka) && pj.has(kb) && ka !== kb;
      if (ok) edgeOk++;
      else edgeBad++;
    }
  }
  console.log('===', label, '===');
  console.log('adj share: 0:', s0, ' 1:', s1, ' >=2:', s2p);
  console.log('unique verts:', uniqueTotal, 'cells', cellsU, 'max', maxU);
  console.log('near-miss (0<d<0.1°):', nearMiss, nearEx);
  console.log('sharedEdges endpoints on both polys:', edgeOk, 'bad', edgeBad, 'total', edgeOk + edgeBad);
}

const w = createWorld({ seed: 42, count: 800 });
shareStats(w, 'createWorld');
shareStats(deserializeWorld(serializeWorld(w, { stripSharedEdges: true })), 'strip+rebuild');
shareStats(deserializeWorld(serializeWorld(w)), 'full serialize');
