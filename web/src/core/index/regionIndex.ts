import type { CellId, LayerId, Region, RegionId, World } from '../types';

export interface OverlapMember {
  id: RegionId;
  color: string;
  weight: number;
}

/**
 * layer × cell → regions 索引。
 * 全量 rebuild 便宜（25k×平均归属）；编辑后调 invalidateRegionIndex。
 */
export class RegionIndex {
  private byLayer = new Map<LayerId, Map<CellId, RegionId[]>>();
  private fillByLayer = new Map<LayerId, Map<CellId, string>>();
  private overlapByLayer = new Map<LayerId, Map<CellId, OverlapMember[]>>();
  private key = '';

  rebuild(world: World): void {
    this.key = worldKey(world);
    this.byLayer.clear();
    this.fillByLayer.clear();
    this.overlapByLayer.clear();
    for (const r of world.regions) {
      let layerMap = this.byLayer.get(r.layerId);
      if (!layerMap) {
        layerMap = new Map();
        this.byLayer.set(r.layerId, layerMap);
      }
      for (const cid of r.cells) {
        const arr = layerMap.get(cid);
        if (arr) arr.push(r.id);
        else layerMap.set(cid, [r.id]);
      }
    }
  }

  private ensure(world: World): void {
    const k = worldKey(world);
    if (this.key !== k) this.rebuild(world);
  }

  owners(world: World, layerId: LayerId, cellId: CellId): RegionId[] {
    this.ensure(world);
    return this.byLayer.get(layerId)?.get(cellId) ?? [];
  }

  /** 互斥层：唯一 owner */
  exclusiveOwner(world: World, layerId: LayerId, cellId: CellId): RegionId | undefined {
    const o = this.owners(world, layerId, cellId);
    return o.length ? o[0] : undefined;
  }

  /** cellId → 填充色（后写覆盖；互斥层够用） */
  fillMap(world: World, layerId: LayerId): Map<CellId, string> {
    this.ensure(world);
    let m = this.fillByLayer.get(layerId);
    if (m) return m;
    m = new Map();
    // 收集本层 region 及其子层 region（行省→国家派生）
    const childOf = new Map<RegionId, Region[]>();
    for (const r of world.regions) {
      if (!r.parentId) continue;
      let arr = childOf.get(r.parentId);
      if (!arr) {
        arr = [];
        childOf.set(r.parentId, arr);
      }
      arr.push(r);
    }
    for (const r of world.regions) {
      if (r.layerId !== layerId) continue;
      const kids = childOf.get(r.id);
      if (kids?.length) {
        // 有子元素：国家色由行省联合驱动
        for (const ch of kids) {
          for (const cid of ch.cells) m.set(cid, r.color);
        }
      } else {
        for (const cid of r.cells) m.set(cid, r.color);
      }
    }
    this.fillByLayer.set(layerId, m);
    return m;
  }

  overlapMap(world: World, layerId: LayerId): Map<CellId, OverlapMember[]> {
    this.ensure(world);
    let m = this.overlapByLayer.get(layerId);
    if (m) return m;
    m = new Map();
    for (const r of world.regions) {
      if (r.layerId !== layerId) continue;
      for (const cid of r.cells) {
        const w = r.weights?.get(cid) ?? 1;
        if (w <= 0) continue;
        const item: OverlapMember = { id: r.id, color: r.color, weight: w };
        const arr = m.get(cid);
        if (arr) arr.push(item);
        else m.set(cid, [item]);
      }
    }
    this.overlapByLayer.set(layerId, m);
    return m;
  }

  regionById(world: World, id: RegionId): Region | undefined {
    return world.regions.find((r) => r.id === id);
  }
}

function worldKey(world: World): string {
  // regions 结构变更即失效；cells 数量影响归属全集
  let n = 0;
  for (const r of world.regions) n += r.cells.length;
  return `${world.regions.length}:${n}:${world.cells.length}`;
}

let idx: RegionIndex | null = null;

export function getRegionIndex(world: World): RegionIndex {
  if (!idx) idx = new RegionIndex();
  idx['ensure'](world);
  return idx;
}

export function invalidateRegionIndex(): void {
  if (idx) {
    (idx as unknown as { key: string }).key = '';
    (idx as unknown as { byLayer: Map<string, unknown> }).byLayer.clear();
    (idx as unknown as { fillByLayer: Map<string, unknown> }).fillByLayer.clear();
    (idx as unknown as { overlapByLayer: Map<string, unknown> }).overlapByLayer.clear();
  }
}
