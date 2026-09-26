/**
 * 投影空间视口索引：均匀网格 → cell / ring id。
 * 画前只取可见，禁止 O(n) 扫全表。
 */
export type Rect = { minX: number; maxX: number; minY: number; maxY: number };

export class ViewIndex {
  private cell = 0.35;
  private cols = 0;
  private rows = 0;
  private minX = -Math.PI;
  private maxX = Math.PI;
  private minY = -3.5;
  private maxY = 3.5;
  private buckets: (number[] | undefined)[] = [];
  private ringBuckets: (number[] | undefined)[] = [];
  ringRects: Rect[] = [];

  constructor(worldSpan?: Rect, cellSize = 0.35) {
    if (worldSpan) {
      this.minX = worldSpan.minX;
      this.maxX = worldSpan.maxX;
      this.minY = worldSpan.minY;
      this.maxY = worldSpan.maxY;
    }
    this.cell = Math.max(cellSize, 0.05);
    this.cols = Math.max(1, Math.ceil((this.maxX - this.minX) / this.cell));
    this.rows = Math.max(1, Math.ceil((this.maxY - this.minY) / this.cell));
  }

  private ci(x: number) {
    return Math.max(0, Math.min(this.cols - 1, Math.floor((x - this.minX) / this.cell)));
  }
  private ri(y: number) {
    return Math.max(0, Math.min(this.rows - 1, Math.floor((y - this.minY) / this.cell)));
  }

  clearCells(): void {
    this.buckets = new Array(this.cols * this.rows);
  }

  addCell(id: number, r: Rect): void {
    const i0 = this.ci(r.minX);
    const i1 = this.ci(r.maxX);
    const j0 = this.ri(r.minY);
    const j1 = this.ri(r.maxY);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.cols + i;
        let b = this.buckets[k];
        if (!b) {
          b = [];
          this.buckets[k] = b;
        }
        b.push(id);
      }
    }
  }

  addRing(index: number, r: Rect): void {
    this.ringRects[index] = r;
    const i0 = this.ci(r.minX);
    const i1 = this.ci(r.maxX);
    const j0 = this.ri(r.minY);
    const j1 = this.ri(r.maxY);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const k = j * this.cols + i;
        let b = this.ringBuckets[k];
        if (!b) {
          b = [];
          this.ringBuckets[k] = b;
        }
        b.push(index);
      }
    }
  }

  private query(
    buckets: (number[] | undefined)[],
    view: Rect,
    out: Set<number>,
  ): void {
    const i0 = this.ci(view.minX);
    const i1 = this.ci(view.maxX);
    const j0 = this.ri(view.minY);
    const j1 = this.ri(view.maxY);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const b = buckets[j * this.cols + i];
        if (!b) continue;
        for (const id of b) out.add(id);
      }
    }
  }

  cellsInView(view: Rect): number[] {
    const out = new Set<number>();
    this.query(this.buckets, view, out);
    return [...out];
  }

  ringsInView(view: Rect, pad = 0.15): number[] {
    const q: Rect = {
      minX: view.minX - pad,
      maxX: view.maxX + pad,
      minY: view.minY - pad,
      maxY: view.maxY + pad,
    };
    const cand = new Set<number>();
    this.query(this.ringBuckets, q, cand);
    const out: number[] = [];
    for (const i of cand) {
      const r = this.ringRects[i];
      if (!r) continue;
      if (r.maxX < q.minX || r.minX > q.maxX || r.maxY < q.minY || r.minY > q.maxY) continue;
      out.push(i);
    }
    return out;
  }
}

let idx: ViewIndex | null = null;
let idxKey = '';

export function getViewIndex(
  key: string,
  span: Rect,
  build: (addCell: (id: number, r: Rect) => void) => void,
): ViewIndex {
  if (idx && idxKey === key) return idx;
  idx = new ViewIndex(span);
  idx.clearCells();
  build((id, r) => idx!.addCell(id, r));
  idxKey = key;
  return idx;
}

export function invalidateViewIndex(): void {
  idx = null;
  idxKey = '';
}
