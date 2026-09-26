/**
 * Cell 中心索引：双向归属 / 核心地块 / 层内元素。
 * 查询 O(k)（k=重叠数，通常 ≤3）；重建 O(Σ|e.cells|)。
 */
import type { CellId, LayerId, Region, RegionId, World } from '../types';

export class CellIndex {
  private key = '';
  /** cell → 占据它的元素（全部层） */
  private owners_ = new Map<CellId, RegionId[]>();
  /** layer → cell → 该层元素 */
  private byLayerCell = new Map<LayerId, Map<CellId, RegionId[]>>();
  /** cell → 以该格为核心（首都等）的元素 */
  private coreHolders_ = new Map<CellId, RegionId[]>();
  /** elementId → Region（指针，O(1) cellsOf） */
  private byId = new Map<RegionId, Region>();
  /** layer → 元素 ids */
  private byLayer = new Map<LayerId, RegionId[]>();

  rebuild(world: World): void {
    this.key = indexKey(world);
    this.owners_.clear();
    this.byLayerCell.clear();
    this.coreHolders_.clear();
    this.byId.clear();
    this.byLayer.clear();
    for (const r of world.regions) {
      this.byId.set(r.id, r);
      let lids = this.byLayer.get(r.layerId);
      if (!lids) {
        lids = [];
        this.byLayer.set(r.layerId, lids);
      }
      lids.push(r.id);

      let lmap = this.byLayerCell.get(r.layerId);
      if (!lmap) {
        lmap = new Map();
        this.byLayerCell.set(r.layerId, lmap);
      }
      for (const cid of r.cells) {
        push(this.owners_, cid, r.id);
        push(lmap, cid, r.id);
      }
      const core = r.coreCellId ?? r.centerCellId;
      if (core !== undefined) {
        push(this.coreHolders_, core, r.id);
      }
    }
  }

  private ensure(world: World): void {
    const k = indexKey(world);
    if (this.key !== k) this.rebuild(world);
  }

  /** O(k)：谁占了这格 */
  owners(world: World, cellId: CellId): RegionId[] {
    this.ensure(world);
    return this.owners_.get(cellId) ?? EMPTY;
  }

  /** O(k)：某层上谁占了这格 */
  ownersOn(world: World, layerId: LayerId, cellId: CellId): RegionId[] {
    this.ensure(world);
    return this.byLayerCell.get(layerId)?.get(cellId) ?? EMPTY;
  }

  /** O(1)：元素的 cell 集（与 region.cells 同一引用） */
  cellsOf(world: World, elementId: RegionId): CellId[] {
    this.ensure(world);
    return this.byId.get(elementId)?.cells ?? EMPTY;
  }

  /** O(1) */
  element(world: World, id: RegionId): Region | undefined {
    this.ensure(world);
    return this.byId.get(id);
  }

  /** O(k)：谁把这格当核心地块 */
  coreHolders(world: World, cellId: CellId): RegionId[] {
    this.ensure(world);
    return this.coreHolders_.get(cellId) ?? EMPTY;
  }

  /** O(1) */
  isCore(world: World, cellId: CellId, elementId: RegionId): boolean {
    this.ensure(world);
    const r = this.byId.get(elementId);
    return (r?.coreCellId ?? r?.centerCellId) === cellId;
  }

  /** O(1) 均摊：层内元素 id */
  elementsOf(world: World, layerId: LayerId): RegionId[] {
    this.ensure(world);
    return this.byLayer.get(layerId) ?? EMPTY;
  }

  /** O(1)：名称 + 放置参数 */
  labelOf(world: World, id: RegionId): {
    name: string;
    coreLabel?: string;
    coreCellId?: CellId;
    style?: Region['nameStyle'];
  } | null {
    this.ensure(world);
    const r = this.byId.get(id);
    if (!r) return null;
    return {
      name: r.name,
      coreLabel: r.coreLabel ?? r.centerLabel,
      coreCellId: r.coreCellId ?? r.centerCellId,
      style: r.nameStyle,
    };
  }
}

const EMPTY: never[] = [];

function push<T>(m: Map<T, string[]>, k: T, id: string): void {
  let a = m.get(k);
  if (!a) {
    a = [];
    m.set(k, a);
  }
  if (!a.includes(id)) a.push(id);
}

function indexKey(world: World): string {
  let n = 0;
  let cores = 0;
  for (const r of world.regions) {
    n += r.cells.length;
    if (r.coreCellId !== undefined) cores++;
  }
  return `${world.regions.length}:${n}:${cores}:${world.cells.length}`;
}

let singleton: CellIndex | null = null;

export function getCellIndex(world: World): CellIndex {
  if (!singleton) singleton = new CellIndex();
  singleton.rebuild(world);
  return singleton;
}

/** 轻量：结构未变时复用（内部仍校验 key） */
export function cellIndex(world: World): CellIndex {
  if (!singleton) singleton = new CellIndex();
  (singleton as unknown as { ensure(w: World): void }).ensure(world);
  return singleton;
}

export function invalidateCellIndex(): void {
  if (singleton) {
    const s = singleton as unknown as { key: string; rebuild(w: World): void };
    s.key = '';
    singleton = null;
  }
}
