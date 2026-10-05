import type { World } from '../types';
import { coreCellOf } from '../regionCenter';
import { createRng, hashSeed } from '../rng';
import { gcDistanceDeg } from '../sphere';
import { pickCell } from '../world';
import { ensureBiome } from '../biomes';

/** 陆地 A*（简化 Dijkstra），返回路径 cell 序列 */
function pathBetween(
  world: World,
  start: number,
  goal: number,
  slopeCost: number,
  forestCost: number,
): number[] | null {
  const n = world.cells.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  dist[start] = 0;
  const heap: { id: number; f: number }[] = [{ id: start, f: 0 }];
  const push = (id: number, f: number) => {
    heap.push({ id, f });
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p].f <= heap[i].f) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l].f < heap[m].f) m = l;
        if (r < heap.length && heap[r].f < heap[m].f) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };

  while (heap.length) {
    const cur = pop();
    if (done[cur.id]) continue;
    done[cur.id] = 1;
    if (cur.id === goal) break;
    const cell = world.cells[cur.id];
    for (const nb of cell.neighbors) {
      const nc = world.cells[nb];
      if (nc.height <= 0) continue;
      let c = 1 + Math.abs(nc.height - cell.height) * slopeCost;
      const b = world.biome?.get(nb);
      if (b === 'taiga' || b === 'temperate_forest' || b === 'rainforest') c *= forestCost;
      if (b === 'mountain') c *= 1.6;
      if (b === 'desert') c *= 1.3;
      const nd = dist[cur.id] + c;
      if (nd < dist[nb]) {
        dist[nb] = nd;
        prev[nb] = cur.id;
        const h = gcDistanceDeg(nc.center, world.cells[goal].center) * 0.01;
        push(nb, nd + h);
      }
    }
  }
  if (!done[goal] && prev[goal] < 0 && goal !== start) return null;
  const path: number[] = [];
  let cur = goal;
  const guard = new Set<number>();
  while (cur >= 0 && !guard.has(cur)) {
    guard.add(cur);
    path.push(cur);
    cur = prev[cur];
  }
  path.reverse();
  return path[0] === start ? path : null;
}

/** 首都 kNN + 近似 MST 连边，再 A* 铺路 */
export function generateRoads(
  world: World,
  seed: number,
  k = 3,
  slopeCost = 2,
  forestCost = 1.2,
): void {
  // 群系代价（森林/沙漠/山地系数）按**当前地形**取——缓存不落盘+rev 失效（还债步骤 4）
  ensureBiome(world);
  // 首都格 = 核心格单源（coreCellOf：支持「核心=子元素」形态，选项1）
  const capitals = world.regions
    .filter((r) => r.layerId === 'country' && coreCellOf(world, r) !== undefined)
    .map((r) => ({ id: r.id, cell: coreCellOf(world, r)!, name: r.name, color: r.color }));
  // 校验先于清空（步骤7 已知问题修复）：无法重建时保留既有路网，杜绝「路网归零不可复」
  if (capitals.length < 2) return;
  world.regions = world.regions.filter((r) => r.layerId !== 'road');
  const rng = createRng(hashSeed(seed, 505));
  void rng;

  // Prim MST on capitals
  const n = capitals.length;
  const inTree = new Array(n).fill(false);
  const edges: [number, number][] = [];
  inTree[0] = true;
  for (let e = 1; e < n; e++) {
    let bestI = -1;
    let bestJ = -1;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      if (!inTree[i]) continue;
      for (let j = 0; j < n; j++) {
        if (inTree[j]) continue;
        const d = gcDistanceDeg(
          world.cells[capitals[i].cell].center,
          world.cells[capitals[j].cell].center,
        );
        if (d < bestD) {
          bestD = d;
          bestI = i;
          bestJ = j;
        }
      }
    }
    if (bestJ < 0) break;
    inTree[bestJ] = true;
    edges.push([bestI, bestJ]);
    void bestI;
  }
  // 额外 k 近邻边少量
  for (let i = 0; i < n; i++) {
    const dists = capitals
      .map((c, j) => ({
        j,
        d: gcDistanceDeg(world.cells[capitals[i].cell].center, world.cells[c.cell].center),
      }))
      .filter((x) => x.j !== i)
      .sort((a, b) => a.d - b.d)
      .slice(0, k);
    for (const d of dists) {
      const a = Math.min(i, d.j);
      const b = Math.max(i, d.j);
      if (!edges.some(([x, y]) => x === a && y === b)) edges.push([a, d.j]);
    }
  }

  let ri = 0;
  for (const [a, b] of edges) {
    const path = pathBetween(
      world,
      capitals[a].cell,
      capitals[b].cell,
      slopeCost,
      forestCost,
    );
    if (!path || path.length < 2) continue;
    world.regions.push({
      id: `road-${ri}`,
      layerId: 'road',
      name: `${capitals[a].name}—${capitals[b].name}`,
      cells: path,
      centerCellId: path[0],
      color: '#e8c46a',
      attributes: { from: capitals[a].name, to: capitals[b].name },
    });
    ri++;
  }
}

/** 海港间大圆航线，采样陆地跳过 */
export function generateRoutes(world: World, seed: number, maxPorts = 8): void {
  const ports: { cell: number; lon: number; lat: number }[] = [];
  for (const c of world.cells) {
    if (c.height > 0 && c.neighbors.some((n) => world.cells[n].height <= 0)) {
      ports.push({ cell: c.id, lon: c.center.lon, lat: c.center.lat });
    }
    if (ports.length >= maxPorts * 2) break;
  }
  if (ports.length < 2) return;
  // 均匀抽 maxPorts
  const step = Math.max(1, Math.floor(ports.length / maxPorts));
  const selected = ports.filter((_, i) => i % step === 0).slice(0, maxPorts);
  // 校验先于清空（同 generateRoads）：无法重建时保留既有航线
  if (selected.length < 2) return;
  world.regions = world.regions.filter((r) => r.layerId !== 'route');

  let ri = 0;
  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      const a = selected[i];
      const b = selected[j];
      // 采样大圆中间点，尽量落在海洋 cell
      const cells = new Set<number>([a.cell, b.cell]);
      const steps = 12;
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        const lon = a.lon + (b.lon - a.lon) * t;
        const lat = a.lat + (b.lat - a.lat) * t;
        const hit = pickCell(world, lon, lat);
        if (hit && hit.height <= 0) cells.add(hit.id);
      }
      if (cells.size < 3) continue;
      world.regions.push({
        id: `route-${ri}`,
        layerId: 'route',
        name: `航线${ri + 1}`,
        cells: [...cells],
        color: '#6ab0d8',
        attributes: { ports: selected.length },
      });
      ri++;
      if (ri > 12) return;
    }
  }
}
