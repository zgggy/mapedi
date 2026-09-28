/**
 * 海陆层：大陆 / 湖泊 / 大海。
 * - 大陆 = 连通陆地（splitPolicy: newElement，分开即两块陆地）
 * - 湖泊 = 小块水体（cells ≤ lakeMaxCells）
 * - 大海 = 大块水体；**用户可拆分且持久化**（manualSplit, keepEnclave）
 *
 * 归属真相在 Region.cells；cell.height 是海陆拓扑的数值源。
 *
 * 重建两条路径共用同一装配段（manual 海 / 湖海分类 / pickOld 身份 / 命名 / continentId）：
 * - 全量（无 dirty）：全图 flood 出连通块。
 * - 增量（dirty）：只重算「翻转触及」的旧实体——未触及实体对象原样保留（身份稳定）；
 *   触及实体用免全扫分裂判据（kept 子图每件必含 removed 的 kept 邻居 → front BFS 早停）
 *   + 并查集把翻转格与邻接块组合并；manual 海不拆不并（enclave 合法），join 见装配段。
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
  const n = world.cells.length;
  const stamp = new Int32Array(n); // 0 未访问，>0 批次号
  const q = new Int32Array(n);
  const comps: CellId[][] = [];
  let batch = 0;
  for (const c of world.cells) {
    if (!test(c.id) || stamp[c.id]) continue;
    batch++;
    stamp[c.id] = batch;
    let head = 0;
    let tail = 0;
    q[tail++] = c.id;
    const comp: CellId[] = [];
    while (head < tail) {
      const id = q[head++];
      comp.push(id);
      for (const nb of world.cells[id].neighbors) {
        if (!test(nb) || stamp[nb]) continue;
        stamp[nb] = batch;
        q[tail++] = nb;
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

function minCell(cells: CellId[]): number {
  let m = Infinity;
  for (const id of cells) if (id < m) m = id;
  return m;
}

/** size 降序（平手取最小 cell id，双路径确定性） */
function sortCompsDesc(comps: CellId[][]): CellId[][] {
  return comps
    .map((cells) => ({ cells, m: minCell(cells) }))
    .sort((a, b) => b.cells.length - a.cells.length || a.m - b.m)
    .map((e) => e.cells);
}

// —— Phase A 产物：待重建连通块 + 原样保留的旧实体 ——
interface Partition {
  /** 脏格无翻转：拓扑未变，整段跳过 */
  unchanged?: boolean;
  /** 需清 continentId 的新水格；全量为 'all' */
  clearWater: CellId[] | 'all';
  /** 原样保留的旧实体（含 manual 海；收缩 / join 由装配段落盘） */
  keep: Region[];
  /** 需按「仍为水」收缩 cells 的 manual 海 id */
  manualFilter: Set<string>;
  /** 待重建陆块（size 降序） */
  landComps: CellId[][];
  /** 待重建自动水体（size 降序；join 归并在装配段） */
  restComps: CellId[][];
}

/**
 * kept 子图（cells \ removed）的连通块。
 * 判据：区域连通 ⇒ kept 的每个连通块必含一个 removed 的 kept 邻居（front）。
 * 从 front[0] BFS，早停到达全部 front ⇒ 单件（不扫全图）；否则逐 front 起件。
 * 返回 null = 不变量失效（防御），调用方回退全量。
 */
function splitKeptPieces(
  world: World,
  cells: CellId[],
  isKept: (id: CellId) => boolean,
  removed: CellId[],
  isRemoved: (id: CellId) => boolean,
): CellId[][] | null {
  const n = world.cells.length;
  const kept: CellId[] = [];
  for (const id of cells) if (!isRemoved(id)) kept.push(id);
  if (!kept.length) return [];
  if (!removed.length) return [kept];

  const inFront = new Int32Array(n);
  const front: CellId[] = [];
  for (const f of removed) {
    for (const nb of world.cells[f].neighbors) {
      if (isKept(nb) && !inFront[nb]) {
        inFront[nb] = 1;
        front.push(nb);
      }
    }
  }
  if (!front.length) return null;

  const visit = new Int32Array(n);
  const qarr = new Int32Array(n);
  // 第一件：front[0] 起 BFS，到达全部 front 即单件（早停不扫全图）
  visit[front[0]] = 1;
  let head = 0;
  let tail = 0;
  qarr[tail++] = front[0];
  let reached = 1;
  while (head < tail && reached < front.length) {
    const id = qarr[head++];
    for (const nb of world.cells[id].neighbors) {
      if (!isKept(nb) || visit[nb]) continue;
      visit[nb] = 1;
      qarr[tail++] = nb;
      if (inFront[nb]) reached++;
    }
  }
  if (reached === front.length) return [kept];

  // 分裂：补完第一件，再从其余 front 起件（每件必含 front 格）
  while (head < tail) {
    const id = qarr[head++];
    for (const nb of world.cells[id].neighbors) {
      if (!isKept(nb) || visit[nb]) continue;
      visit[nb] = 1;
      qarr[tail++] = nb;
    }
  }
  const pieces: CellId[][] = [];
  const piece0: CellId[] = [];
  for (let i = 0; i < tail; i++) piece0.push(qarr[i]);
  pieces.push(piece0);
  for (const f of front) {
    if (visit[f]) continue;
    visit[f] = 1;
    head = 0;
    tail = 0;
    qarr[tail++] = f;
    const comp: CellId[] = [];
    while (head < tail) {
      const id = qarr[head++];
      comp.push(id);
      for (const nb of world.cells[id].neighbors) {
        if (!isKept(nb) || visit[nb]) continue;
        visit[nb] = 1;
        qarr[tail++] = nb;
      }
    }
    pieces.push(comp);
  }
  return pieces;
}

/** 全量分区：全图 flood（manual 海细胞不进自动水体） */
function fullPartition(
  world: World,
  manualOceans: Region[],
  manualCellIdx: Int32Array,
  landOf: (id: CellId) => boolean,
  isWater: (id: CellId) => boolean,
): Partition {
  return {
    keep: [...manualOceans],
    manualFilter: new Set(manualOceans.map((o) => o.id)),
    clearWater: 'all',
    landComps: sortCompsDesc(floodComponents(world, landOf)),
    restComps: sortCompsDesc(floodComponents(world, (id) => isWater(id) && manualCellIdx[id] < 0)),
  };
}

/**
 * 增量分区：只重算「翻转触及」的旧实体。
 * 触及 = 含翻转格或翻转格邻居的旧实体（其细胞集可能变化的全部实体）。
 * null = 不变量失效 → 调用方回退全量。
 */
function incrementalPartition(
  world: World,
  old: Region[],
  landOf: (id: CellId) => boolean,
  isWater: (id: CellId) => boolean,
  dirtySet: Set<CellId>,
): Partition | null {
  const n = world.cells.length;
  // cell → 旧实体下标；覆盖不完备 / 重叠 → 全量
  const ownerIdx = new Int32Array(n).fill(-1);
  const isManualR = new Uint8Array(old.length);
  for (let i = 0; i < old.length; i++) {
    if (landSeaKindOf(old[i]) === 'ocean' && isManualSplit(old[i])) isManualR[i] = 1;
    for (const id of old[i].cells) {
      if (!(id >= 0 && id < n) || ownerIdx[id] !== -1) return null;
      ownerIdx[id] = i;
    }
  }

  // 翻转 = 脏格中海陆标签变化者（其余脏格不影响拓扑）
  const flipFlag = new Int8Array(n); // 0 未翻转，1 转陆，2 转水
  const flips: CellId[] = [];
  for (const id of dirtySet) {
    const oi = ownerIdx[id];
    if (oi < 0) return null;
    const nowLand = landOf(id);
    if (nowLand === (landSeaKindOf(old[oi]) === 'continent')) continue;
    flipFlag[id] = nowLand ? 1 : 2;
    flips.push(id);
  }
  if (!flips.length) {
    return {
      unchanged: true,
      keep: [],
      manualFilter: new Set(),
      clearWater: [],
      landComps: [],
      restComps: [],
    };
  }

  // 触及实体 + manual 收缩集
  const touched = new Set<number>();
  const manualFilter = new Set<string>();
  for (const id of flips) {
    const oi = ownerIdx[id];
    touched.add(oi);
    if (isManualR[oi]) manualFilter.add(old[oi].id);
    for (const nb of world.cells[id].neighbors) {
      const ni = ownerIdx[nb];
      if (ni < 0) return null;
      touched.add(ni);
    }
  }

  // 每个触及非 manual 实体拆 kept 件；manual 不拆不并（join 在装配段）
  const flipsByRegion = new Map<number, CellId[]>();
  for (const id of flips) {
    const oi = ownerIdx[id];
    let arr = flipsByRegion.get(oi);
    if (!arr) {
      arr = [];
      flipsByRegion.set(oi, arr);
    }
    arr.push(id);
  }
  interface PNode {
    label: 1 | 2;
    cells: CellId[];
    region?: number;
  }
  const nodeOf = new Int32Array(n).fill(-1);
  const nodes: PNode[] = [];
  const keptRegion = new Uint8Array(old.length); // 1 = 对象原样保留
  for (let i = 0; i < old.length; i++) if (!touched.has(i) || isManualR[i]) keptRegion[i] = 1;

  for (const ri of touched) {
    if (isManualR[ri]) continue;
    const r = old[ri];
    const removed = flipsByRegion.get(ri) ?? [];
    const isKept = (id: CellId) => ownerIdx[id] === ri && !flipFlag[id];
    const isRemoved = (id: CellId) => ownerIdx[id] === ri && flipFlag[id] !== 0;
    const pieces = splitKeptPieces(world, r.cells, isKept, removed, isRemoved);
    if (!pieces) return null;
    let sum = 0;
    for (const p of pieces) sum += p.length;
    if (sum + removed.length !== r.cells.length) return null; // 漏件防御 → 全量
    const label: 1 | 2 = landSeaKindOf(r) === 'continent' ? 1 : 2;
    for (const p of pieces) {
      for (const id of p) nodeOf[id] = nodes.length;
      nodes.push({ label, cells: p, region: ri });
    }
  }
  for (const id of flips) {
    nodeOf[id] = nodes.length;
    nodes.push({ label: flipFlag[id] as 1 | 2, cells: [id] });
  }

  // 并查集：翻转格 ↔ 同标签邻接（kept 块 / 其他翻转格）成组合并
  const parent = new Int32Array(nodes.length);
  for (let i = 0; i < nodes.length; i++) parent[i] = i;
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  for (const id of flips) {
    const label = flipFlag[id];
    const mine = nodeOf[id];
    for (const nb of world.cells[id].neighbors) {
      const same = label === 1 ? landOf(nb) : isWater(nb);
      if (!same) continue;
      const g = nodeOf[nb];
      if (g < 0) {
        // manual 海保留格 → 由 join 归并；其余异常回退全量
        const oi = ownerIdx[nb];
        if (label === 2 && oi >= 0 && isManualR[oi]) continue;
        return null;
      }
      union(mine, g);
    }
  }

  // 聚类 → 重建块；单件整区域（无翻转无并）走快路径原样保留
  const clusters = new Map<number, PNode[]>();
  for (let i = 0; i < nodes.length; i++) {
    const root = find(i);
    let arr = clusters.get(root);
    if (!arr) {
      arr = [];
      clusters.set(root, arr);
    }
    arr.push(nodes[i]);
  }
  const landComps: CellId[][] = [];
  const restComps: CellId[][] = [];
  for (const members of clusters.values()) {
    const only = members[0];
    if (
      members.length === 1 &&
      only.region !== undefined &&
      only.cells.length === old[only.region].cells.length
    ) {
      keptRegion[only.region] = 1;
      continue;
    }
    const cells: CellId[] =
      members.length === 1 ? members[0].cells : members.flatMap((m) => m.cells);
    (only.label === 1 ? landComps : restComps).push(cells);
  }

  const keep: Region[] = [];
  for (let i = 0; i < old.length; i++) if (keptRegion[i]) keep.push(old[i]);
  return {
    keep,
    manualFilter,
    clearWater: flips.filter((id) => flipFlag[id] === 2),
    landComps: sortCompsDesc(landComps),
    restComps: sortCompsDesc(restComps),
  };
}

/**
 * 装配（全量 / 增量共用）：manual 海收缩与 join、湖海分类、pickOld 身份、
 * 命名编号、continentId 同步、写回、关系重算。
 */
function assembleLandSea(
  world: World,
  old: Region[],
  oldByKind: Record<LandSeaKind, Region[]>,
  manualOceans: Region[],
  manualCellIdx: Int32Array,
  part: Partition,
): void {
  const maxLake = lakeMaxCells(world.cells.length);

  // keep 去重 + 旧档迁层；**输出一律新对象**（不复用旧引用/旧代理——重建产物与旧状态解耦）
  const keepSeen = new Set<string>();
  const keepUnique: Region[] = [];
  for (const r of part.keep) {
    if (keepSeen.has(r.id)) continue;
    keepSeen.add(r.id);
    keepUnique.push({
      ...r,
      layerId: 'landsea',
      cells: [...r.cells],
      attributes: { ...r.attributes },
    });
  }

  const usedIds = new Set<string>(keepUnique.map((r) => r.id));
  for (const o of manualOceans) usedIds.add(o.id);
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
  const compStamp = new Int32Array(world.cells.length);
  let stampBatch = 0;
  const pickOld = (kind: LandSeaKind, cells: CellId[]): Region | null => {
    stampBatch++;
    for (const id of cells) compStamp[id] = stampBatch;
    let best: Region | null = null;
    let bestScore = 0;
    for (const r of oldByKind[kind]) {
      if (usedIds.has(r.id)) continue;
      let s = 0;
      for (const id of r.cells) if (compStamp[id] === stampBatch) s++;
      const minNeed = Math.max(3, Math.floor(r.cells.length * 0.3));
      if (s >= minNeed && s > bestScore) {
        bestScore = s;
        best = r;
      }
    }
    return best;
  };

  // —— manual 海：翻转离水 → 收缩（enclave 合法，不拆不并）——
  // 补丁落在 keepUnique 副本上（输出不复用旧对象）
  const manualIdxOf = new Map<string, number>();
  for (let mi = 0; mi < manualOceans.length; mi++) {
    manualIdxOf.set(manualOceans[mi].id, mi);
  }
  const manualById = new Map<string, Region>();
  for (const r of keepUnique) {
    if (manualIdxOf.has(r.id)) manualById.set(r.id, r);
  }
  for (const id of part.manualFilter) {
    const o = manualById.get(id);
    const mi = manualIdxOf.get(id);
    if (!o || mi === undefined) continue;
    o.cells = o.cells.filter((c) => manualCellIdx[c] === mi);
    o.attributes = { ...o.attributes, kind: 'ocean', manualSplit: true };
  }

  // —— 自动水体 join：邻接 manual 海 → 归入最大邻接 manual（按 join 前大小，确定性）——
  const manualBaseSize = new Map<string, number>();
  for (const o of manualOceans) manualBaseSize.set(o.id, o.cells.length);
  const restEntries: CellId[][] = [];
  for (const comp of part.restComps) {
    if (!comp.length) continue;
    let best: string | null = null;
    const seenManual = new Set<string>();
    for (const id of comp) {
      for (const nb of world.cells[id].neighbors) {
        const mj = manualCellIdx[nb];
        if (mj < 0) continue;
        const mid = manualOceans[mj].id;
        if (seenManual.has(mid)) continue;
        seenManual.add(mid);
        if (!manualById.has(mid)) continue;
        if (
          best === null ||
          (manualBaseSize.get(mid) ?? 0) > (manualBaseSize.get(best) ?? 0) ||
          ((manualBaseSize.get(mid) ?? 0) === (manualBaseSize.get(best) ?? 0) && mid < best)
        ) {
          best = mid;
        }
      }
    }
    if (best) {
      const target = manualById.get(best)!;
      target.cells = [...target.cells, ...comp];
      const bj = manualIdxOf.get(best);
      if (bj !== undefined) for (const id of comp) manualCellIdx[id] = bj;
      continue;
    }
    restEntries.push(comp);
  }

  // —— 实体条目（命名 / 编号按同类 size 降序，kept 占位）——
  interface Entry {
    cells: CellId[];
    kind: LandSeaKind;
  }
  const landEntries: Entry[] = [];
  for (const comp of part.landComps) if (comp.length) landEntries.push({ cells: comp, kind: 'continent' });
  const restEntryList: Entry[] = [];
  for (const comp of restEntries) {
    restEntryList.push({ cells: comp, kind: comp.length <= maxLake ? 'lake' : 'ocean' });
  }

  const rankOf = new Map<Entry, number>();
  const assignRanks = (kind: LandSeaKind, entries: Entry[]): void => {
    const kept = keepUnique.filter(
      (r) => landSeaKindOf(r) === kind && !(kind === 'ocean' && isManualSplit(r)),
    );
    const items = [
      ...kept.map((r) => ({ cells: r.cells, m: minCell(r.cells), e: null as Entry | null })),
      ...entries
        .filter((e) => e.kind === kind)
        .map((e) => ({ cells: e.cells, m: minCell(e.cells), e })),
    ];
    items.sort((a, b) => b.cells.length - a.cells.length || a.m - b.m);
    items.forEach((it, i) => {
      if (it.e) rankOf.set(it.e, i + 1);
    });
  };
  assignRanks('continent', landEntries);
  assignRanks('lake', restEntryList);
  assignRanks('ocean', restEntryList);

  const usedNames = new Set<string>(keepUnique.map((r) => r.name));
  const build = (e: Entry): Region | null => {
    const prev = pickOld(e.kind, e.cells);
    const rank = rankOf.get(e) ?? 1;
    const kind = e.kind;
    const col =
      kind === 'continent'
        ? LAND_COLOR
        : kind === 'lake'
          ? LAKE_COLOR
          : OCEAN_COLOR;
    const color = prev?.color ?? col;
    const prefix = kind === 'continent' ? 'ls-continent' : kind === 'lake' ? 'ls-lake' : 'ls-ocean';
    const label = kind === 'continent' ? '大陆' : kind === 'lake' ? '湖泊' : '海洋';
    const description =
      kind === 'continent' ? '陆地连通块' : kind === 'lake' ? '大陆内部小块水域' : '连通大洋水体';
    // 铸造名避让重名（kept/自定义名不改）
    let name = prev?.name;
    if (!name) {
      name = `${label} ${rank}`;
      for (let k = rank; usedNames.has(name); k++) name = `${label} ${k + 1}`;
    }
    usedNames.add(name);
    return {
      id: claimId(prev?.id, prefix, kind === 'continent' ? rank - 1 : rank),
      layerId: 'landsea',
      name,
      cells: e.cells,
      color,
      exclusiveColor: prev?.exclusiveColor ?? defaultExclusiveColor(color),
      centerCellId:
        prev?.centerCellId !== undefined && compStamp[prev.centerCellId] === stampBatch
          ? prev.centerCellId
          : undefined,
      attributes: { ...(prev?.attributes ?? {}), kind, manualSplit: false, description },
    };
  };

  const next: Region[] = [];
  // 定义序 = 叠放序（低者先画）：海 → 陆 → 湖，与高度层 h0..h11 同一规则
  for (const e of restEntryList) {
    if (e.kind !== 'ocean') continue;
    const r = build(e);
    if (r) next.push(r);
  }
  for (const e of landEntries) {
    const r = build(e);
    if (r) next.push(r);
  }
  for (const e of restEntryList) {
    if (e.kind !== 'lake') continue;
    const r = build(e);
    if (r) next.push(r);
  }

  // cell.continentId 同步（大陆 Region 数组序 = 索引；真相 = Region.cells）
  const continents = [...keepUnique, ...next].filter((r) => landSeaKindOf(r) === 'continent');
  for (let i = 0; i < continents.length; i++) {
    for (const id of continents[i].cells) {
      const c = world.cells[id];
      if (c && c.continentId !== i) c.continentId = i;
    }
  }
  if (part.clearWater === 'all') {
    for (const c of world.cells) {
      if (isOcean(c) && c.continentId !== undefined) c.continentId = undefined;
    }
  } else {
    for (const id of part.clearWater) {
      const c = world.cells[id];
      if (c) c.continentId = undefined;
    }
  }

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

/**
 * 重建海陆元素。
 * - 大陆/湖：按连通块（newElement）
 * - 海：优先保留 manualSplit 的用户拆分；其余归自动海
 * - dirty：增量——只重算翻转触及的实体，其余对象原样保留
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
  // cell → manual 海下标（热路径整型数组；join 后回写）
  const manualCellIdx = new Int32Array(world.cells.length).fill(-1);
  for (let mi = 0; mi < manualOceans.length; mi++) {
    for (const id of manualOceans[mi].cells) {
      if (isWater(id)) manualCellIdx[id] = mi;
    }
  }

  const dirtySet = new Set<CellId>();
  if (dirty) for (const id of dirty) if (world.cells[id]) dirtySet.add(id);

  const part = dirtySet.size
    ? incrementalPartition(world, old, landOf, isWater, dirtySet)
    : null;
  if (part?.unchanged) return;
  assembleLandSea(
    world,
    old,
    oldByKind,
    manualOceans,
    manualCellIdx,
    part ?? fullPartition(world, manualOceans, manualCellIdx, landOf, isWater),
  );
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
