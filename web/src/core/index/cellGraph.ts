import type { CellId, World } from '../types';

/** 压缩邻接：nbrOff[i]..nbrOff[i+1] 为 cell i 的邻居 */
export class CellGraph {
  readonly nbrOff: Uint32Array;
  readonly nbr: Uint32Array;
  readonly cellCount: number;

  constructor(world: World) {
    const n = world.cells.length;
    this.cellCount = n;
    let total = 0;
    for (const c of world.cells) total += c.neighbors.length;
    this.nbrOff = new Uint32Array(n + 1);
    this.nbr = new Uint32Array(total);
    let k = 0;
    for (let i = 0; i < n; i++) {
      this.nbrOff[i] = k;
      const neigh = world.cells[i].neighbors;
      for (let j = 0; j < neigh.length; j++) this.nbr[k++] = neigh[j];
    }
    this.nbrOff[n] = k;
  }

  neighbors(id: CellId): { start: number; end: number } {
    return { start: this.nbrOff[id], end: this.nbrOff[id + 1] };
  }
}

let cache: { key: string; g: CellGraph } | null = null;

export function getCellGraph(world: World): CellGraph {
  const key = `${world.meta.seed}:${world.cells.length}:${world.meta.cellCount}`;
  if (cache && cache.key === key) return cache.g;
  const g = new CellGraph(world);
  cache = { key, g };
  return g;
}

export function invalidateCellGraph(): void {
  cache = null;
}

/** 陆地连通分量（CSR） */
export function landContinentsCSR(world: World): CellId[][] {
  const g = getCellGraph(world);
  const n = g.cellCount;
  const seen = new Uint8Array(n);
  const comps: CellId[][] = [];
  for (let i = 0; i < n; i++) {
    if (seen[i] || world.cells[i].height <= 0) continue;
    const stack = [i];
    const comp: CellId[] = [];
    seen[i] = 1;
    while (stack.length) {
      const id = stack.pop()!;
      comp.push(id);
      const { start, end } = g.neighbors(id);
      for (let k = start; k < end; k++) {
        const nb = g.nbr[k];
        if (!seen[nb] && world.cells[nb].height > 0) {
          seen[nb] = 1;
          stack.push(nb);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}
