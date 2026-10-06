import type { CellId, LayerId, Region, RegionId, World } from '../types';
import { regionsRev } from '../rev';

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

  /** 失效：清 key 与三索引（下次 ensure 全量重建）——invalidateRegionIndex 的唯一入口 */
  reset(): void {
    this.key = '';
    this.byLayer.clear();
    this.fillByLayer.clear();
    this.overlapByLayer.clear();
  }

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
      for (const pid of r.parents ?? []) {
        let arr = childOf.get(pid);
        if (!arr) {
          arr = [];
          childOf.set(pid, arr);
        }
        arr.push(r);
      }
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
  // O(1)（2026-10-01 还债步骤6）：原实现每次 ensure 扫全部 region.cells 求和+拼串，
  // 而 ensure 在拾取/悬停的 owners() 上按帧调用 = O(总归属格)/次。
  // regionsRev 在全部 touch* 路径 bump（invalidateRegionIndex 同点调用，双保险）；
  // 长度字段兜底结构突变（与 rev 漏配时的护栏，非替代 rev 的真相）。
  return `${regionsRev()}:${world.regions.length}:${world.cells.length}`;
}

let idx: RegionIndex | null = null;

export function getRegionIndex(world: World): RegionIndex {
  if (!idx) idx = new RegionIndex();
  idx['ensure'](world);
  return idx;
}

export function invalidateRegionIndex(): void {
  idx?.reset();
}
