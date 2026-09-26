import type { Cell, RiverEdge, World } from './types';
import { edgeKey } from './world';

/** D8 流向 + 流量累积，生成河网（写入 world.rivers） */
export function generateRivers(world: World, accumulationThreshold = 8): void {
  const cells = world.cells;
  const n = cells.length;
  const flowTo = new Int32Array(n).fill(-1);
  const acc = new Float64Array(n).fill(1);

  // 按高度降序处理，流向最低邻居
  const order = cells
    .map((c) => c.id)
    .filter((id) => cells[id].height > 0)
    .sort((a, b) => cells[b].height - cells[a].height);

  for (const id of order) {
    const cell = cells[id];
    let best = -1;
    let bestH = cell.height;
    for (const nid of cell.neighbors) {
      const h = cells[nid].height;
      if (h < bestH) {
        bestH = h;
        best = nid;
      }
    }
    // 入海：邻居高度 <= 0
    if (best >= 0) flowTo[id] = best;
  }

  // 累积（从高到低已保证上游先算）
  for (const id of order) {
    const t = flowTo[id];
    if (t >= 0) acc[t] += acc[id];
  }

  world.rivers.clear();
  for (const id of order) {
    const t = flowTo[id];
    if (t < 0) continue;
    const target = cells[t];
    if (acc[id] < accumulationThreshold && target.height > 0) continue;
    // 入海或高流量河段
    if (acc[id] >= accumulationThreshold || target.height <= 0) {
      if (acc[id] < accumulationThreshold * 0.5) continue;
      const orderN = Math.min(5, 1 + Math.floor(Math.log2(Math.max(1, acc[id]))));
      const key = edgeKey(id, t);
      const river: RiverEdge = {
        a: Math.min(id, t),
        b: Math.max(id, t),
        widthFactor: 0.5 + orderN * 0.35,
        order: orderN,
      };
      world.rivers.set(key, river);
    }
  }
}

export function riverSegments(world: World): RiverEdge[] {
  return [...world.rivers.values()];
}
