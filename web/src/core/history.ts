import type { CellId, Region, RegionId, World } from './types';
import { scrubRegionDiplomacy } from './diplomacy';

export interface EditCommand {
  label: string;
  apply(world: World): void;
  revert(world: World): void;
  /** 相邻同类命令合并（结构共享，避免 History 堆大快照） */
  coalesce?(next: EditCommand): boolean;
}

/** 高度笔刷：只存脏 cell 的高度样本，不整表快照 */
export class HeightCellsCommand implements EditCommand {
  samples: { id: CellId; h0: number; h1: number }[];
  constructor(
    samples: { id: CellId; h0: number; h1: number }[],
    public label = '高度笔刷',
  ) {
    this.samples = samples;
  }

  apply(world: World): void {
    for (const s of this.samples) {
      const c = world.cells[s.id];
      if (!c) continue;
      c.height = s.h1;
      c.isOcean = s.h1 <= 0;
      if (s.h1 <= 0) c.continentId = undefined;
    }
  }

  revert(world: World): void {
    for (const s of this.samples) {
      const c = world.cells[s.id];
      if (!c) continue;
      c.height = s.h0;
      c.isOcean = s.h0 <= 0;
      if (s.h0 <= 0) c.continentId = undefined;
    }
  }

  coalesce(next: EditCommand): boolean {
    if (!(next instanceof HeightCellsCommand)) return false;
    const map = new Map<number, { id: CellId; h0: number; h1: number }>();
    for (const s of this.samples) map.set(s.id, { ...s });
    for (const s of next.samples) {
      const prev = map.get(s.id);
      if (prev) prev.h1 = s.h1;
      else map.set(s.id, { ...s });
    }
    this.samples = [...map.values()];
    return true;
  }
}

function findRegion(world: World, id: RegionId): Region | undefined {
  return world.regions.find((r) => r.id === id);
}

/** 笔刷增删 cell（增量，不整表快照）。
 * 不与相邻笔画 coalesce：多步绘制需独立 undo/redo。 */
export class PaintCellsCommand implements EditCommand {
  constructor(
    public regionId: RegionId,
    public added: CellId[],
    public removed: CellId[],
    public label = '绘制',
  ) {}

  apply(world: World): void {
    const r = findRegion(world, this.regionId);
    if (!r) return;
    const set = new Set(r.cells);
    for (const c of this.added) set.add(c);
    for (const c of this.removed) set.delete(c);
    r.cells = [...set];
  }

  revert(world: World): void {
    const r = findRegion(world, this.regionId);
    if (!r) return;
    const set = new Set(r.cells);
    for (const c of this.added) set.delete(c);
    for (const c of this.removed) set.add(c);
    r.cells = [...set];
  }
}

/**
 * 多元素笔画补丁（undo 腐蚀修复，2026-09-30 还债步骤 1-①）。
 * 一次笔画可能触碰多个 Region（replace 剥他人 cell / splitPolicy 新建拆分元素 /
 * flood steal 同层互斥），单元素 PaintCellsCommand 会漏记副作用 → 撤销后
 * 原归属元素永久丢 cell、拆分克隆残留。统一以「每元素增减 + 新建快照」入栈：
 * 撤销一次 = 全部副作用一并还原；重做 = 提交时刻终态一并重建。
 */
export class MultiRegionCommand implements EditCommand {
  constructor(
    public spec: {
      /** 已存在元素的 cells 增减（COW：应用时整表替换） */
      patches: { id: string; added: number[]; removed: number[] }[];
      /** 笔画中新建的元素（split/自动建），region = 提交时刻终态 */
      created: { id: string; region: Region }[];
    },
    public label = '绘制',
  ) {}

  private static applyPatches(world: World, spec: MultiRegionCommand['spec'], dir: 1 | -1) {
    for (const p of spec.patches) {
      const r = world.regions.find((x) => x.id === p.id);
      if (!r) continue;
      const set = new Set(r.cells);
      if (dir === 1) {
        for (const c of p.added) set.add(c);
        for (const c of p.removed) set.delete(c);
      } else {
        // revert：增减互换
        for (const c of p.added) set.delete(c);
        for (const c of p.removed) set.add(c);
      }
      r.cells = [...set];
    }
  }

  apply(world: World): void {
    MultiRegionCommand.applyPatches(world, this.spec, 1);
    for (const c of this.spec.created) {
      if (world.regions.some((x) => x.id === c.id)) continue;
      world.regions.push({ ...c.region, cells: [...c.region.cells] });
    }
  }

  revert(world: World): void {
    for (const c of this.spec.created) {
      world.regions = world.regions.filter((x) => x.id !== c.id);
    }
    MultiRegionCommand.applyPatches(world, this.spec, -1);
  }
}

export class SetCenterCommand implements EditCommand {
  private prev: CellId | undefined;
  constructor(
    private regionId: RegionId,
    private next: CellId | undefined,
    public label = '设中心',
  ) {}

  apply(world: World): void {
    const r = findRegion(world, this.regionId);
    if (!r) return;
    this.prev = r.centerCellId;
    r.centerCellId = this.next;
  }

  revert(world: World): void {
    const r = findRegion(world, this.regionId);
    if (!r) return;
    r.centerCellId = this.prev;
  }
}

/** 浅克隆 Region：cells/weights 引用 COW（调用方在 splice 后独占，再改时才换新数组） */
function snapshotRegionCOW(r: Region): Region {
  return {
    ...r,
    // region 已从 world 摘除 → 引用转移；后续编辑会替换 cells/map 引用，不污染本快照
    cells: r.cells,
    weights: r.weights,
    endpointOverrides: r.endpointOverrides,
    attributes: { ...r.attributes },
  };
}

function restoreRegionCOW(snap: Region): Region {
  return {
    ...snap,
    cells: snap.cells,
    weights: snap.weights,
    endpointOverrides: snap.endpointOverrides,
    attributes: { ...snap.attributes },
  };
}

export class DeleteRegionCommand implements EditCommand {
  private snapshot: Region | null = null;
  private childParents: { id: RegionId; parentId: RegionId | undefined }[] = [];

  constructor(
    private regionId: RegionId,
    public label = '删除元素',
  ) {}

  apply(world: World): void {
    const idx = world.regions.findIndex((r) => r.id === this.regionId);
    if (idx < 0) return;
    // COW：splice 后 region 不可达，cells/map 引用直接交给快照
    this.snapshot = snapshotRegionCOW(world.regions[idx]);
    this.childParents = [];
    for (const r of world.regions) {
      if (r.parentId === this.regionId) {
        this.childParents.push({ id: r.id, parentId: r.parentId });
        r.parentId = undefined;
      }
    }
    scrubRegionDiplomacy(world, this.regionId);
    world.regions.splice(idx, 1);
  }

  revert(world: World): void {
    if (!this.snapshot) return;
    world.regions.push(restoreRegionCOW(this.snapshot));
    for (const c of this.childParents) {
      const r = findRegion(world, c.id);
      if (r) r.parentId = c.parentId;
    }
    this.snapshot = null;
    this.childParents = [];
  }
}

export class AnnexCommand implements EditCommand {
  private targetSnap: Region | null = null;
  private attackerAdded: CellId[] = [];
  private childParents: { id: RegionId; from: RegionId; to: RegionId }[] = [];

  constructor(
    private attackerId: RegionId,
    private targetId: RegionId,
    public label = '吞并',
  ) {}

  apply(world: World): void {
    const attacker = findRegion(world, this.attackerId);
    const tIdx = world.regions.findIndex((r) => r.id === this.targetId);
    if (!attacker || tIdx < 0) return;
    const target = world.regions[tIdx];
    this.targetSnap = snapshotRegionCOW(target);
    const have = new Set(attacker.cells);
    this.attackerAdded = [];
    // 换新数组，避免 push 污染 target 快照仍持有的旧引用
    const merged = attacker.cells.slice();
    for (const c of target.cells) {
      if (!have.has(c)) {
        merged.push(c);
        have.add(c);
        this.attackerAdded.push(c);
      }
    }
    attacker.cells = merged;
    this.childParents = [];
    for (const r of world.regions) {
      if (r.parentId === this.targetId) {
        this.childParents.push({ id: r.id, from: r.parentId, to: this.attackerId });
        r.parentId = this.attackerId;
      }
    }
    world.regions.splice(tIdx, 1);
  }

  revert(world: World): void {
    if (!this.targetSnap) return;
    const attacker = findRegion(world, this.attackerId);
    if (attacker) {
      const drop = new Set(this.attackerAdded);
      attacker.cells = attacker.cells.filter((c) => !drop.has(c));
    }
    for (const c of this.childParents) {
      const r = findRegion(world, c.id);
      if (r) r.parentId = c.from;
    }
    world.regions.push(restoreRegionCOW(this.targetSnap));
    this.targetSnap = null;
    this.attackerAdded = [];
    this.childParents = [];
  }
}

export class CreateRegionCommand implements EditCommand {
  constructor(
    private region: Region,
    public label = '新增元素',
    /** 插入位置（复制元素=原件后一位）；缺省追加尾部 */
    private at?: number,
  ) {}

  apply(world: World): void {
    if (findRegion(world, this.region.id)) return;
    const entry = { ...this.region, cells: [...this.region.cells] };
    if (this.at !== undefined && this.at >= 0 && this.at <= world.regions.length) {
      world.regions.splice(this.at, 0, entry);
    } else {
      world.regions.push(entry);
    }
  }

  revert(world: World): void {
    world.regions = world.regions.filter((r) => r.id !== this.region.id);
  }
}

/** —— 1-b 字段类命令化（2026-09-30，纯数据无闭包——顺带向 1-c 方向） —— */

/**
 * Region 浅字段补丁（改名/描述/颜色/外交 attributes/显隐等）：before/after 存**引用快照**
 * （写入皆换新对象/数组 → 旧引用安全），多 region 一条命令。
 */
export class RegionFieldsCommand implements EditCommand {
  constructor(
    public patches: { id: string; before: Partial<Region>; after: Partial<Region> }[],
    public label = '编辑',
  ) {}

  private static assign(world: World, patches: RegionFieldsCommand['patches'], dir: 1 | -1): void {
    for (const p of patches) {
      const r = world.regions.find((x) => x.id === p.id);
      if (!r) continue;
      Object.assign(r, dir === 1 ? p.after : p.before);
    }
  }

  apply(world: World): void {
    RegionFieldsCommand.assign(world, this.patches, 1);
  }

  revert(world: World): void {
    RegionFieldsCommand.assign(world, this.patches, -1);
  }
}

/** 图层可见性批量补丁（toggle 可能连动父子三树 → 整批 id→visible 快照最稳；15 层量级） */
export class LayersVisibilityCommand implements EditCommand {
  constructor(
    public ids: string[],
    public before: (boolean | undefined)[],
    public after: (boolean | undefined)[],
    public label = '显隐',
  ) {}

  private static assign(world: World, ids: string[], vals: (boolean | undefined)[]): void {
    ids.forEach((id, i) => {
      const l = world.layers.find((x) => x.id === id);
      if (l) l.visible = vals[i];
    });
  }

  apply(world: World): void {
    LayersVisibilityCommand.assign(world, this.ids, this.after);
  }

  revert(world: World): void {
    LayersVisibilityCommand.assign(world, this.ids, this.before);
  }
}

/** 图层样式补丁（layerRenderConfig Map：before/after = 完整 ElementStyle 引用，set 覆盖） */
export class LayerStyleCommand implements EditCommand {
  constructor(
    public layerId: string,
    public before: unknown,
    public after: unknown,
    public label = '显示参数',
  ) {}

  private static set(world: World, id: string, style: unknown): void {
    const map = world.layerRenderConfig ?? new Map();
    if (style) map.set(id, style);
    else map.delete(id);
    world.layerRenderConfig = map;
  }

  apply(world: World): void {
    LayerStyleCommand.set(world, this.layerId, this.after);
  }

  revert(world: World): void {
    LayerStyleCommand.set(world, this.layerId, this.before);
  }
}

/** 添加自定义图层（apply push / revert splice；纯数据） */
export class AddLayerCommand implements EditCommand {
  constructor(private layer: World['layers'][number], public label = '添加图层') {}

  apply(world: World): void {
    if (world.layers.some((l) => l.id === this.layer.id)) return;
    world.layers.push({ ...this.layer });
  }

  revert(world: World): void {
    world.layers = world.layers.filter((l) => l.id !== this.layer.id);
  }
}

/** 删除图层（1-b 图层树删除命令化）：层定义 + 其元素 + 渲染配置整包快照，
 *  apply=删（调用方 alreadyApplied），revert=全量恢复（元素含 cells/Set/Map 深拷贝）。 */
export class DeleteLayerCommand implements EditCommand {
  private regions: Region[];
  private renderCfg: [string, NonNullable<World['layerRenderConfig']> extends Map<string, infer V> ? V : never][];

  constructor(private layer: World['layers'][number], world: World, public label = '删除图层') {
    this.regions = world.regions
      .filter((r) => r.layerId === layer.id)
      .map((r) => ({
        ...r,
        cells: [...r.cells],
        adjacentElementIds: r.adjacentElementIds ? new Set(r.adjacentElementIds) : undefined,
        weights: r.weights ? new Map(r.weights) : undefined,
        endpointOverrides: r.endpointOverrides ? new Map(r.endpointOverrides) : undefined,
        overlaps: r.overlaps ? [...r.overlaps] : r.overlaps,
      }));
    const cfg = world.layerRenderConfig?.get(layer.id);
    this.renderCfg = cfg ? [[layer.id, cfg]] : [];
  }

  apply(world: World): void {
    world.layers = world.layers.filter((l) => l.id !== this.layer.id);
    world.regions = world.regions.filter((r) => r.layerId !== this.layer.id);
    world.layerRenderConfig?.delete(this.layer.id);
  }

  revert(world: World): void {
    if (!world.layers.some((l) => l.id === this.layer.id)) world.layers.push({ ...this.layer });
    for (const r of this.regions) {
      if (!world.regions.some((x) => x.id === r.id)) {
        world.regions.push({
          ...r,
          cells: [...r.cells],
          adjacentElementIds: r.adjacentElementIds ? new Set(r.adjacentElementIds) : undefined,
          weights: r.weights ? new Map(r.weights) : undefined,
          endpointOverrides: r.endpointOverrides ? new Map(r.endpointOverrides) : undefined,
        });
      }
    }
    if (world.layerRenderConfig) for (const [k, v] of this.renderCfg) world.layerRenderConfig.set(k, v);
  }
}

/**
 * 元素数组序补丁（组织模式：上移/下移/缩进/提升都伴随 regions 数组序=叠放/显示序变化）。
 * 整数组 id 快照（几百 id × 2 份，便宜且对插入/删除天然稳健——只要回放时全集一致）。
 */
/** 路径编辑（还债 1-b）：paths 整表前后快照——点列增删/拖动/显隐/顺序/增删路径统一入口。
 *  apply/revert 各自 structuredClone：命令持有独立副本，后续直改不会污染历史。 */
export class PathsCommand implements EditCommand {
  private static clone(ps: NonNullable<World['paths']>): NonNullable<World['paths']> {
    // 手动平面拷贝：path.points 经 $state 深代理，structuredClone 会 DataCloneError
    return ps.map((p) => ({
      ...p,
      points: (p.points ?? []).map((q) => ({ lon: q.lon, lat: q.lat })),
    }));
  }

  constructor(
    public before: NonNullable<World['paths']>,
    public after: NonNullable<World['paths']>,
    public label = '路径编辑',
  ) {}

  apply(world: World): void {
    world.paths = PathsCommand.clone(this.after);
  }

  revert(world: World): void {
    world.paths = PathsCommand.clone(this.before);
  }
}

export class RegionsOrderCommand implements EditCommand {
  constructor(
    public before: string[],
    public after: string[],
    public label = '调整顺序',
  ) {}

  private static applyOrder(world: World, ids: string[]): void {
    const map = new Map(world.regions.map((r) => [r.id, r]));
    const next: Region[] = [];
    for (const id of ids) {
      const r = map.get(id);
      if (r) next.push(r);
    }
    // 回放期间新增的元素（不在此快照）追加到尾部，不丢数据
    for (const r of world.regions) if (!ids.includes(r.id)) next.push(r);
    world.regions = next;
  }

  apply(world: World): void {
    RegionsOrderCommand.applyOrder(world, this.after);
  }

  revert(world: World): void {
    RegionsOrderCommand.applyOrder(world, this.before);
  }
}

/** 图层数组序补丁（图层组织模式的上移/下移/缩进/提升） */
export class LayersOrderCommand implements EditCommand {
  constructor(
    public before: string[],
    public after: string[],
    public label = '调整图层顺序',
  ) {}

  private static applyOrder(world: World, ids: string[]): void {
    const map = new Map(world.layers.map((l) => [l.id, l]));
    const next: World['layers'] = [];
    for (const id of ids) {
      const l = map.get(id);
      if (l) next.push(l);
    }
    for (const l of world.layers) if (!ids.includes(l.id)) next.push(l);
    world.layers = next;
  }

  apply(world: World): void {
    LayersOrderCommand.applyOrder(world, this.after);
  }

  revert(world: World): void {
    LayersOrderCommand.applyOrder(world, this.before);
  }
}

/** 组合命令：一次操作的多个子变更（如缩进 = parent 字段 + 数组序）一次 undo/redo */
export class CompositeCommand implements EditCommand {
  constructor(
    public children: EditCommand[],
    public label = '编辑',
  ) {}

  apply(world: World): void {
    for (const c of this.children) c.apply(world);
  }

  revert(world: World): void {
    for (let i = this.children.length - 1; i >= 0; i--) this.children[i].revert(world);
  }
}

/** 图层浅字段补丁（parentLayerId/名称等——组织模式缩进/提升用） */
export class LayerFieldsCommand implements EditCommand {
  constructor(
    public patches: { id: string; before: Partial<World['layers'][number]>; after: Partial<World['layers'][number]> }[],
    public label = '编辑图层',
  ) {}

  private static assign(world: World, patches: LayerFieldsCommand['patches'], dir: 1 | -1): void {
    for (const p of patches) {
      const l = world.layers.find((x) => x.id === p.id);
      if (!l) continue;
      Object.assign(l, dir === 1 ? p.after : p.before);
    }
  }

  apply(world: World): void {
    LayerFieldsCommand.assign(world, this.patches, 1);
  }

  revert(world: World): void {
    LayerFieldsCommand.assign(world, this.patches, -1);
  }
}

export class History {
  private stack: EditCommand[] = [];
  private redoStack: EditCommand[] = [];
  private limit = 80;

  run(world: World, cmd: EditCommand, opts?: { alreadyApplied?: boolean }): void {
    const top = this.stack[this.stack.length - 1];
    if (top?.coalesce?.(cmd)) {
      // 仅高度等「单次手势」命令合并；world 若未应用过 next，仍要 apply
      if (!opts?.alreadyApplied) cmd.apply(world);
      this.redoStack.length = 0;
      return;
    }
    if (!opts?.alreadyApplied) cmd.apply(world);
    this.stack.push(cmd);
    if (this.stack.length > this.limit) this.stack.shift();
    this.redoStack.length = 0;
  }

  /** 撤销一步，返回被撤销的命令（null=无可撤销）——调用方据命令类型分发副作用（1-c：命令本体不再持闭包） */
  undo(world: World): EditCommand | null {
    const cmd = this.stack.pop();
    if (!cmd) return null;
    cmd.revert(world);
    this.redoStack.push(cmd);
    return cmd;
  }

  /** 重做一步，返回被重做的命令（null=无可重做） */
  redo(world: World): EditCommand | null {
    const cmd = this.redoStack.pop();
    if (!cmd) return null;
    cmd.apply(world);
    this.stack.push(cmd);
    return cmd;
  }

  clear(): void {
    this.stack.length = 0;
    this.redoStack.length = 0;
  }

  get depth(): number {
    return this.stack.length;
  }
}

export const history = new History();
