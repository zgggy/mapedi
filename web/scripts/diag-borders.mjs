/** 诊断边界：共享边长度分布、异常边、缝隙 */
import { createRng } from '../src/core/rng.ts';
import { blueNoiseSphere, sphericalVoronoi, angleBetween, vec3ToLonLat } from '../src/core/voronoiSphere.ts';
import { weldVertices } from '../src/core/voronoi.ts';

const seed = 42;
const count = 800;
const rng = createRng(seed);
const pts = blueNoiseSphere(count, rng, 0.8);
const { polys: raw, neighbors, sharedEdges } = sphericalVoronoi(pts, 18);
const { polys } = weldVertices(raw);

// 1) 共享边长度（角距）
const edgeLens = [];
for (const [k, e] of sharedEdges) {
  const ang = angleBetween(e.a, e.b);
  edgeLens.push({ k, ang, a: e.a, b: e.b });
}
edgeLens.sort((x, y) => x.ang - y.ang);
console.log('shared edges:', edgeLens.length);
console.log('edge ang min/p50/p95/max:',
  edgeLens[0]?.ang.toFixed(6),
  edgeLens[Math.floor(edgeLens.length*0.5)]?.ang.toFixed(6),
  edgeLens[Math.floor(edgeLens.length*0.95)]?.ang.toFixed(6),
  edgeLens[edgeLens.length-1]?.ang.toFixed(6));

// 超长边（可能是“中心连线”）
const long = edgeLens.filter(e => e.ang > 0.35);
console.log('long edges (>0.35 rad):', long.length);
for (const e of long.slice(0, 8)) {
  const [i, j] = e.k.split('-').map(Number);
  console.log('  ', e.k, 'ang', e.ang.toFixed(4),
    'siteDist', angleBetween(pts[i], pts[j]).toFixed(4),
    'll', vec3ToLonLat(e.a), vec3ToLonLat(e.b));
}

// 2) 每个胞腔顶点数
const vc = polys.map(p => p?.length ?? 0);
const bad = vc.filter(v => v < 3).length;
const thin = vc.filter(v => v >= 3 && v < 5).length;
console.log('poly verts: <3:', bad, '3-4:', thin, 'ok:', vc.filter(v=>v>=5).length);

// 3) 相邻胞腔共享顶点数量（应 >=2）
let share0 = 0, share1 = 0, share2p = 0;
const gaps = [];
for (let i = 0; i < polys.length; i++) {
  for (const j of neighbors[i]) {
    if (j <= i) continue;
    let shared = 0;
    for (const a of polys[i]) {
      for (const b of polys[j]) {
        if (a === b || (a[0]*b[0]+a[1]*b[1]+a[2]*b[2]) > 0.99998) { shared++; break; }
      }
    }
    if (shared === 0) share0++;
    else if (shared === 1) share1++;
    else share2p++;
    if (shared < 2) gaps.push({ i, j, shared, si: vec3ToLonLat(pts[i]), sj: vec3ToLonLat(pts[j]) });
  }
}
console.log('adj share verts: 0:', share0, '1:', share1, '>=2:', share2p);
console.log('gap examples:', gaps.slice(0, 10));

// 4) sharedEdges 中边长 vs 两端站点距离（正常应接近）
console.log('\n--- edge vs site chord ---');
let weird = 0;
for (const e of edgeLens) {
  const [i, j] = e.k.split('-').map(Number);
  const siteAng = angleBetween(pts[i], pts[j]);
  // Voronoi 边长度通常 << 站点间距
  if (e.ang > siteAng * 0.9) {
    weird++;
    if (weird <= 6) {
      console.log('  edge~sites', e.k, 'edge', e.ang.toFixed(4), 'sites', siteAng.toFixed(4));
    }
  }
}
console.log('edge≈siteDist count:', weird);
