/** 量化邻接 cell 共享顶点：键级 / 近邻级；对比 serialize 路径 */
import {
  createWorld,
  serializeWorld,
  deserializeWorld,
} from '../src/core/world';
import { lonlatKey } from '../src/core/ring/build';

function shareStats(world, label) {
  let s0 = 0, s1 = 0, s2p = 0;
  const gaps = [];
  for (const c of world.cells) {
    for (const n of c.neighbors) {
      if (n <= c.id) continue;
      const nc = world.cells[n];
      if (!nc) continue;
      const keysA = new Set(c.polygon.map(lonlatKey));
      const keysB = new Set(nc.polygon.map(lonlatKey));
      let shared = 0;
      for (const k of keysA) if (keysB.has(k)) shared++;
      if (shared < 2) {
        let near = 0;
        for (const p of c.polygon) {
          for (const q of nc.polygon) {
            let dLon = Math.abs(p.lon - q.lon);
            dLon = Math.min(dLon, 360 - dLon);
            const d = Math.hypot(dLon, p.lat - q.lat);
            if (d < 0.05) {
              near++;
              break;
            }
          }
        }
        if (near > shared) shared = near;
      }
      if (shared === 0) s0++;
      else if (shared === 1) {
        s1++;
        if (gaps.length < 8) gaps.push({ i: c.id, j: n, shared });
      } else s2p++;
    }
  }
  let cellsWithUnique = 0, uniqueVertTotal = 0, maxUnique = 0;
  const uniqueExamples = [];
  for (const c of world.cells) {
    let unique = 0;
    for (const p of c.polygon) {
      const k = lonlatKey(p);
      let found = false;
      for (const n of c.neighbors) {
        const nc = world.cells[n];
        if (!nc) continue;
        for (const q of nc.polygon) {
          if (lonlatKey(q) === k) {
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (!found) unique++;
    }
    if (unique > 0) {
      cellsWithUnique++;
      uniqueVertTotal += unique;
      if (unique > maxUnique) maxUnique = unique;
      if (uniqueExamples.length < 6) {
        uniqueExamples.push({
          id: c.id,
          unique,
          verts: c.polygon.length,
          nbs: c.neighbors.length,
        });
      }
    }
  }
  console.log('===', label, '===');
  console.log('adj share verts: 0:', s0, ' 1:', s1, ' >=2:', s2p);
  console.log(
    'cells with unmatched verts:',
    cellsWithUnique,
    '/',
    world.cells.length,
    ' total unmatched:',
    uniqueVertTotal,
    ' max per cell:',
    maxUnique,
  );
  console.log('examples:', uniqueExamples);
  console.log('share=1 gaps:', gaps);
}

const w = createWorld({ seed: 42, count: 800 });
shareStats(w, 'createWorld in-memory');
const w2 = deserializeWorld(serializeWorld(w, { stripSharedEdges: true }));
shareStats(w2, 'after strip+rebuild');
const w3 = deserializeWorld(serializeWorld(w, { stripSharedEdges: false }));
shareStats(w3, 'after full serialize');
