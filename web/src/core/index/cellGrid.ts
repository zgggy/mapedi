import type { Cell, CellId, World } from '../types';

const CELL_DEG = 2;
const D2R = Math.PI / 180;

function lonLatToUnit(lon: number, lat: number): [number, number, number] {
  const λ = lon * D2R;
  const φ = lat * D2R;
  const cl = Math.cos(φ);
  return [cl * Math.cos(λ), Math.sin(φ), cl * Math.sin(λ)];
}

export class CellGrid {
  private cols = Math.ceil(360 / CELL_DEG);
  private rows = Math.ceil(180 / CELL_DEG);
  private buckets: (CellId[] | undefined)[] = [];
  private ux = new Float64Array(0);
  private uy = new Float64Array(0);
  private uz = new Float64Array(0);
  cellCount = 0;

  rebuild(world: World): void {
    this.cellCount = world.cells.length;
    const n = this.cellCount;
    this.ux = new Float64Array(n);
    this.uy = new Float64Array(n);
    this.uz = new Float64Array(n);
    this.buckets = new Array(this.cols * this.rows);
    for (const c of world.cells) {
      const u = lonLatToUnit(c.center.lon, c.center.lat);
      this.ux[c.id] = u[0];
      this.uy[c.id] = u[1];
      this.uz[c.id] = u[2];
      const ci = this.col(c.center.lon);
      const ri = this.row(c.center.lat);
      const i = ri * this.cols + ci;
      let b = this.buckets[i];
      if (!b) {
        b = [];
        this.buckets[i] = b;
      }
      b.push(c.id);
    }
  }

  private col(lon: number) {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((lon + 180) / CELL_DEG)));
  }
  private row(lat: number) {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((lat + 90) / CELL_DEG)));
  }

  /** 球面最近（单位向量点积） */
  nearest(world: World, lon: number, lat: number): Cell | null {
    const q = lonLatToUnit(lon, lat);
    const ci = this.col(lon);
    const ri = this.row(lat);
    let best: Cell | null = null;
    let bestDot = -2;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const rr = ri + dr;
        if (rr < 0 || rr >= this.rows) continue;
        // 经度环绕：跨日界线时桶列 wrap
        let cc = ci + dc;
        cc = ((cc % this.cols) + this.cols) % this.cols;
        const list = this.buckets[rr * this.cols + cc];
        if (!list) continue;
        for (const id of list) {
          const d = this.ux[id] * q[0] + this.uy[id] * q[1] + this.uz[id] * q[2];
          if (d > bestDot) {
            bestDot = d;
            best = world.cells[id];
          }
        }
      }
    }
    // 极区回退：扩大搜索
    if (Math.abs(lat) > 70) {
      for (let id = 0; id < this.cellCount; id++) {
        const d = this.ux[id] * q[0] + this.uy[id] * q[1] + this.uz[id] * q[2];
        if (d > bestDot) {
          bestDot = d;
          best = world.cells[id];
        }
      }
    }
    return best;
  }

  /** 大圆半径（度）查询 */
  queryRadius(world: World, lon: number, lat: number, radiusDeg: number): CellId[] {
    const q = lonLatToUnit(lon, lat);
    const cosR = Math.cos((radiusDeg * Math.PI) / 180);
    const ring = Math.max(1, Math.ceil(radiusDeg / CELL_DEG) + 1);
    const ci = this.col(lon);
    const ri = this.row(lat);
    const hits: CellId[] = [];
    const seen = new Set<CellId>();
    const test = (id: CellId) => {
      if (seen.has(id)) return;
      const d = this.ux[id] * q[0] + this.uy[id] * q[1] + this.uz[id] * q[2];
      if (d >= cosR) {
        seen.add(id);
        hits.push(id);
      }
    };
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        const rr = ri + dr;
        const cc = ci + dc;
        if (rr < 0 || cc < 0 || rr >= this.rows || cc >= this.cols) continue;
        const list = this.buckets[rr * this.cols + cc];
        if (!list) continue;
        for (const id of list) test(id);
      }
    }
    // 极区或半径很大时全表兜底
    if (Math.abs(lat) > 60 || radiusDeg > 15) {
      for (let id = 0; id < this.cellCount; id++) test(id);
    }
    return hits;
  }
}

let cache: { key: string; grid: CellGrid } | null = null;

export function getCellGrid(world: World): CellGrid {
  const key = `${world.meta.seed}:${world.meta.cellCount}:${world.cells.length}`;
  if (cache && cache.key === key) return cache.grid;
  const grid = new CellGrid();
  grid.rebuild(world);
  cache = { key, grid };
  return grid;
}

export function invalidateCellGrid(): void {
  cache = null;
}

export function gridReady(world: World): boolean {
  return cache !== null && cache.grid.cellCount === world.cells.length;
}
