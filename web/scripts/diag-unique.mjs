/** 对准「1 个不共享顶点」样本：坐标差 vs 真缺失 */
import { createWorld } from '../src/core/world';
import { lonlatKey } from '../src/core/ring/build';

const w = createWorld({ seed: 42, count: 800 });

function distDeg(p, q) {
  let dLon = Math.abs(p.lon - q.lon);
  dLon = Math.min(dLon, 360 - dLon);
  return Math.hypot(dLon, p.lat - q.lat);
}

const uniqueRows = [];
for (const c of w.cells) {
  for (let vi = 0; vi < c.polygon.length; vi++) {
    const p = c.polygon[vi];
    const k = lonlatKey(p);
    let found = false;
    let nearest = null;
    let nearestD = Infinity;
    for (const n of c.neighbors) {
      const nc = w.cells[n];
      for (const q of nc.polygon) {
        if (lonlatKey(q) === k) {
          found = true;
          break;
        }
        const d = distDeg(p, q);
        if (d < nearestD) {
          nearestD = d;
          nearest = { n, q, d };
        }
      }
      if (found) break;
    }
    if (!found) {
      uniqueRows.push({
        cell: c.id,
        vi,
        p,
        nearestD: nearest?.d,
        nearest,
        verts: c.polygon.length,
        nbs: c.neighbors.length,
        // 该顶点是否像站点中心
        distToCenter: distDeg(p, c.center),
      });
    }
  }
}
console.log('unique verts:', uniqueRows.length);
for (const r of uniqueRows) {
  console.log(JSON.stringify(r, null, 0));
}

// share=1 对：缺的是哪一端
console.log('\n--- share=1 pair detail ---');
let shown = 0;
for (const c of w.cells) {
  for (const n of c.neighbors) {
    if (n <= c.id) continue;
    const nc = w.cells[n];
    const keysA = new Set(c.polygon.map(lonlatKey));
    const keysB = new Set(nc.polygon.map(lonlatKey));
    let shared = 0;
    for (const k of keysA) if (keysB.has(k)) shared++;
    if (shared >= 2) continue;
    const onlyA = c.polygon.filter((p) => !keysB.has(lonlatKey(p)));
    const onlyB = nc.polygon.filter((p) => !keysA.has(lonlatKey(p)));
    // onlyA/onlyB 里离对方最近的点
    const nearestOf = (ps, other) =>
      ps.map((p) => {
        let best = Infinity;
        let bq = null;
        for (const q of other.polygon) {
          const d = distDeg(p, q);
          if (d < best) {
            best = d;
            bq = q;
          }
        }
        return { p, best, bq };
      });
    if (shown < 10) {
      console.log(
        `pair ${c.id}-${n} shared=${shared} onlyA=${onlyA.length} onlyB=${onlyB.length}`,
        'nearestA→B',
        nearestOf(onlyA, nc),
        'nearestB→A',
        nearestOf(onlyB, c),
      );
      shown++;
    }
  }
}
