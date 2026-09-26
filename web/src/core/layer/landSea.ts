/**
 * 海陆层：大陆 / 湖泊 / 大海。
 * - 大陆 = 连通陆地（splitPolicy: newElement，分开即两块陆地）
 * - 湖泊 = 被陆地围住的水块
 * - 大海 = 与大洋连通的水体；**用户可拆分且持久化**（manualSplit, keepEnclave）
 *
 * 归属真相在 Region.cells；cell.height 是海陆拓扑的数值源。
 */
import type { CellId, Region, World } from '../types';
import { isLand, isOcean } from '../types';
import { defaultExclusiveColor } from './style';
import { computeRelationships } from './relationships';

export type LandSeaKind = 'continent' | 'lake' | 'ocean';

const LAKE_COLOR = '#2a6a8a';
const OCEAN_COLOR = '#1A3A6B';
const LAND_COLOR = '#C4A882';

export function landSeaKindOf(r: { attributes?: Record<string, unknown> }): LandSeaKind {
  const k = r.attributes?.kind;
  return k === 'lake' || k === 'ocean' || k === 'continent' ? k : 'continent';
}

/** 仅显式 kind ∈ {continent,lake,ocean} 才算海陆实体（区间 kind=interval 不是） */
function isLandSeaAttr(r: { attributes?: Record<string, unknown> }): boolean {
  const k = r.attributes?.kind;
  return k === 'lake' || k === 'ocean' || k === 'continent';
}

export function isManualSplit(r: Region): boolean {
  return r.attributes?.manualSplit === true;
}

export function markManualSplit(r: Region): void {
  r.attributes = { ...r.attributes, manualSplit: true };
}

function floodComponents(world: World, test: (id: CellId) => boolean): CellId[][] {
  const seen = new Set<CellId>();
  const comps: CellId[][] = [];
  for (const c of world.cells) {
    if (!test(c.id) || seen.has(c.id)) continue;
    const comp: CellId[] = [];
    const q = [c.id];
    seen.add(c.id);
    while (q.length) {
      const id = q.pop()!;
      comp.push(id);
      for (const n of world.cells[id].neighbors) {
        if (!test(n) || seen.has(n)) continue;
        seen.add(n);
        q.push(n);
      }
    }
    comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  return comps;
}

function lakeMaxCells(cellCount: number): number {
  return Math.max(8, Math.floor(cellCount / 200));
}

function overlapScore(a: Set<CellId>, b: CellId[]): number {
  let n = 0;
  for (const id of b) if (a.has(id)) n++;
  return n;
}

/**
 * 重建海陆元素。
 * - 大陆/湖：按连通块（newElement）
 * - 海：优先保留 manualSplit 的用户拆分；其余归自动海
 */
export function rebuildLandSeaRegions(world: World, dirty?: Iterable<CellId> | null): void {
  const old = world.regions.filter(
    (r) => r.layerId === 'landsea' || (r.layerId === 'height' && isLandSeaAttr(r)),
  );
  // 旧档 height 上的海陆实体迁移进本层
  const oldByKind: Record<LandSeaKind, Region[]> = { continent: [], lake: [], ocean: [] };
  for (const r of old) oldByKind[landSeaKindOf(r)].push(r);

  const landOf = (id: CellId) => isLand(world.cells[id] ?? { height: 0 });
  const isWater = (id: CellId) => !landOf(id);

  // 用户拆分海洋：cell → ocean region id（仅 manual 且仍为水的 cell）
  const manualOceans = oldByKind.ocean.filter(isManualSplit);
  const manualOwner = new Map<CellId, string>();
  for (const o of manualOceans) {
    for (const id of o.cells) {
      if (isWater(id)) manualOwner.set(id, o.id);
    }
  }

  let lands: CellId[][];
  let waters: CellId[][];
  let keepOld: Region[] = [];

  if (dirty) {
    const dirtySet = new Set<CellId>();
    for (const id of dirty) if (world.cells[id]) dirtySet.add(id);
    if (!dirtySet.size) {
      lands = floodComponents(world, landOf);
      waters = floodComponents(world, isWater);
    } else {
      const seeds = new Set<CellId>(dirtySet);
      for (const id of dirtySet) for (const n of world.cells[id].neighbors) seeds.add(n);
      // 简化：脏区触发全量水陆重算（正确优先；增量 keep 仅保护完全未触及实体）
      lands = floodComponents(world, landOf);
      waters = floodComponents(world, isWater);
      const newCells = new Set<CellId>();
      for (const comp of [...lands, ...waters]) for (const id of comp) newCells.add(id);
      keepOld = old.filter((r) => {
        for (const id of r.cells) {
          if (dirtySet.has(id) || seeds.has(id) || newCells.has(id)) return false;
        }
        return true;
      });
      const keepIds = new Set(keepOld.map((r) => r.id));
      for (const k of Object.keys(oldByKind) as LandSeaKind[]) {
        oldByKind[k] = oldByKind[k].filter((r) => !keepIds.has(r.id));
      }
    }
  } else {
    lands = floodComponents(world, landOf);
    waters = floodComponents(world, isWater);
  }

  const maxLake = lakeMaxCells(world.cells.length);
  const usedIds = new Set<string>(keepOld.map((r) => r.id));
  const mintId = (prefix: string, n: number): string => {
    let id = `${prefix}-${n}`;
    let k = n;
    while (usedIds.has(id)) {
      k += 1;
      id = `${prefix}-${k}`;
    }
    usedIds.add(id);
    return id;
  };
  /** 唯一占位点：id 在此登记；pickOld 只挑不占，preferred 分支才可达 */
  const claimId = (preferred: string | undefined, prefix: string, n: number): string => {
    if (preferred && !usedIds.has(preferred)) {
      usedIds.add(preferred);
      return preferred;
    }
    return mintId(prefix, n);
  };
  const pickOld = (kind: LandSeaKind, cells: CellId[]): Region | null => {
    const set = new Set(cells);
    let best: Region | null = null;
    let bestScore = 0;
    for (const r of oldByKind[kind]) {
      if (usedIds.has(r.id)) continue;
      const s = overlapScore(set, r.cells);
      const minNeed = Math.max(3, Math.floor(r.cells.length * 0.3));
      if (s >= minNeed && s > bestScore) {
        bestScore = s;
        best = r;
      }
    }
    return best;
  };

  const next: Region[] = [];

  // —— 大陆（newElement：一连通块一陆）——
  lands.forEach((comp, i) => {
    if (!comp.length) return;
    const prev = pickOld('continent', comp);
    const col = prev?.color ?? LAND_COLOR;
    next.push({
      id: claimId(prev?.id, 'ls-continent', i),
      layerId: 'landsea',
      name: prev?.name ?? `大陆 ${i + 1}`,
      cells: [...comp],
      color: col,
      exclusiveColor: prev?.exclusiveColor ?? defaultExclusiveColor(col),
      centerCellId:
        prev?.centerCellId !== undefined && comp.includes(prev.centerCellId)
          ? prev.centerCellId
          : undefined,
      attributes: {
        ...(prev?.attributes ?? {}),
        kind: 'continent',
        manualSplit: false,
        description: '陆地连通块',
      },
    });
  });

  // —— 水体：manual 海优先占 cell，剩余按连通块分湖/海 ——
  const restWater: CellId[] = [];
  const byManual = new Map<string, CellId[]>();
  for (const wcomp of waters) {
    for (const id of wcomp) {
      const mid = manualOwner.get(id);
      if (mid) {
        let arr = byManual.get(mid);
        if (!arr) {
          arr = [];
          byManual.set(mid, arr);
        }
        arr.push(id);
      } else {
        restWater.push(id);
      }
    }
  }

  // 保留的 manual 海（可不连通 = 飞地/拆分合法）
  for (const o of manualOceans) {
    const cells = byManual.get(o.id) ?? [];
    // 即使变空也保留身份，便于继续画
    usedIds.add(o.id);
    next.push({
      ...o,
      layerId: 'landsea',
      cells,
      attributes: { ...o.attributes, kind: 'ocean', manualSplit: true },
    });
  }

  // 剩余水：连通块 → 湖（小且不接 manual 海）或自动海
  const restSet = new Set(restWater);
  const restComps = floodComponents(world, (id) => restSet.has(id));
  let lakeN = 0;
  let oceanN = 0;
  for (const comp of restComps) {
    if (!comp.length) continue;
    // 与 manual 海邻接 → 归入最大邻接 manual 海（拆分边界保持）
    let joined: string | null = null;
    for (const id of comp) {
      for (const n of world.cells[id].neighbors) {
        const mid = manualOwner.get(n);
        if (mid) {
          joined = mid;
          break;
        }
      }
      if (joined) break;
    }
    if (joined) {
      const target = next.find((r) => r.id === joined);
      if (target) {
        target.cells = [...target.cells, ...comp];
        for (const id of comp) manualOwner.set(id, joined);
        continue;
      }
    }
    const kind: LandSeaKind = comp.length <= maxLake ? 'lake' : 'ocean';
    const prev = pickOld(kind, comp);
    if (kind === 'lake') {
      lakeN++;
      next.push({
        id: claimId(prev?.id, 'ls-lake', lakeN),
        layerId: 'landsea',
        name: prev?.name ?? `湖泊 ${lakeN}`,
        cells: [...comp],
        color: prev?.color ?? LAKE_COLOR,
        exclusiveColor: prev?.exclusiveColor ?? defaultExclusiveColor(prev?.color ?? LAKE_COLOR),
        centerCellId:
          prev?.centerCellId !== undefined && comp.includes(prev.centerCellId)
            ? prev.centerCellId
            : undefined,
        attributes: {
          ...(prev?.attributes ?? {}),
          kind: 'lake',
          manualSplit: false,
          description: '大陆内部小块水域',
        },
      });
    } else {
      oceanN++;
      next.push({
        id: claimId(prev?.id, 'ls-ocean', oceanN),
        layerId: 'landsea',
        name: prev?.name ?? `海洋 ${oceanN}`,
        cells: [...comp],
        color: prev?.color ?? OCEAN_COLOR,
        exclusiveColor: prev?.exclusiveColor ?? defaultExclusiveColor(prev?.color ?? OCEAN_COLOR),
        centerCellId:
          prev?.centerCellId !== undefined && comp.includes(prev.centerCellId)
            ? prev.centerCellId
            : undefined,
        attributes: {
          ...(prev?.attributes ?? {}),
          kind: 'ocean',
          manualSplit: false,
          description: '连通大洋水体',
        },
      });
    }
  }

  // cell.continentId 同步（大陆 Region 顺序 = 索引；大陆分组真相在 Region.cells）
  const continents = next.filter((r) => landSeaKindOf(r) === 'continent');
  for (let i = 0; i < continents.length; i++) {
    for (const id of continents[i].cells) {
      if (world.cells[id]) world.cells[id].continentId = i;
    }
  }
  for (const c of world.cells) {
    if (isOcean(c)) c.continentId = undefined;
  }

  const keepSeen = new Set<string>();
  const keepUnique = keepOld.filter((r) => {
    if (keepSeen.has(r.id)) return false;
    keepSeen.add(r.id);
    return true;
  });

  // 去掉旧 height 海陆 + 本层旧；写入 landsea。**保留高度区间元素（kind=interval）**
  world.regions = world.regions
    .filter(
      (r) =>
        r.layerId !== 'landsea' &&
        !(r.layerId === 'height' && isLandSeaAttr(r)),
    )
    .concat(keepUnique, next);

  computeRelationships(world, [...keepUnique, ...next]);
}

/** 海岸 = 大陆/湖泊的边界环（海洋不描） */
export function landSeaCoastRegions(world: World): Region[] {
  return world.regions.filter(
    (r) => r.layerId === 'landsea' && landSeaKindOf(r) !== 'ocean' && r.cells.length > 0,
  );
}

/**
 * 大陆分组（派生，无独立真相）：landsea 层 continent Region 的 cells。
 * 顺序与 cell.continentId 索引一致（rebuildLandSeaRegions 的赋值序）。
 */
export function continentCellGroups(world: World): CellId[][] {
  return world.regions
    .filter((r) => r.layerId === 'landsea' && landSeaKindOf(r) === 'continent')
    .map((r) => r.cells);
}

export { lakeMaxCells };
