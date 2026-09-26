/** Vec3 级：凸包对偶胞腔邻接共享顶点 + 近重合顶点对 */
import { createRng } from '../src/core/rng';
import {
  blueNoiseSphere,
  sphericalVoronoi,
} from '../src/core/voronoiSphere';
import { weldVertices } from '../src/core/voronoi';

const seed = 42;
const count = 800;
const rng = createRng(seed);
const body = blueNoiseSphere(count, rng, 0.8).filter((p) => Math.abs(p[1]) < 0.985);
const north = [0, 1, 0];
const south = [0, -1, 0];
const pts = [...body, north, south];
const { polys, neighbors, sharedEdges } = sphericalVoronoi(pts, 18);

function countShare(polys, neighbors, tag) {
  let s0 = 0, s1 = 0, s2p = 0;
  const gaps = [];
  for (let i = 0; i < polys.length; i++) {
    for (const j of neighbors[i]) {
      if (j <= i) continue;
      let shared = 0;
      for (const a of polys[i]) {
        for (const b of polys[j]) {
          if (a === b || a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.99998) {
            shared++;
            break;
          }
        }
      }
      if (shared === 0) s0++;
      else if (shared === 1) {
        s1++;
        if (gaps.length < 8) gaps.push({ i, j, shared });
      } else s2p++;
    }
  }
  console.log(tag, 'adj share: 0:', s0, ' 1:', s1, ' >=2:', s2p);
  console.log(tag, 'share=1 gaps:', gaps);
}

countShare(polys, neighbors, 'RAW');

let nearDupPairs = 0;
const allV = [];
for (const p of polys) for (const v of p) allV.push(v);
for (let i = 0; i < allV.length; i++) {
  for (let j = i + 1; j < allV.length; j++) {
    if (allV[i] === allV[j]) continue;
    const d = allV[i][0] * allV[j][0] + allV[i][1] * allV[j][1] + allV[i][2] * allV[j][2];
    if (d > 0.999999) nearDupPairs++;
  }
}
console.log('near-dup vertex pairs (dot>0.999999, not same ref):', nearDupPairs);

const { polys: wp } = weldVertices(polys);
countShare(wp, neighbors, 'WELDED');

let cellsU = 0, maxU = 0, totU = 0;
const ex = [];
for (let i = 0; i < wp.length; i++) {
  let u = 0;
  for (const a of wp[i]) {
    let found = false;
    for (const j of neighbors[i]) {
      for (const b of wp[j]) {
        if (a === b || a[0] * b[0] + a[1] * b[1] + a[2] * b[2] > 0.99998) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (!found) u++;
  }
  if (u > 0) {
    cellsU++;
    totU += u;
    if (u > maxU) maxU = u;
    if (ex.length < 6) {
      ex.push({ i, u, verts: wp[i].length, nbs: neighbors[i].length });
    }
  }
}
console.log(
  'WELDED cells with unique verts:',
  cellsU,
  '/',
  wp.length,
  'total',
  totU,
  'max',
  maxU,
  ex,
);
console.log('sharedEdges:', sharedEdges.size, 'sites:', pts.length);
