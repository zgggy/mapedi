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

/** 高度笔刷命令：apply/revert 后触发增量 rebuild / touch */
export class HeightStrokeCommand extends HeightCellsCommand {
  afterApply?: () => void;
  afterRevert?: () => void;
  apply(world: World): void {
    super.apply(world);
    this.afterApply?.();
  }
  revert(world: World): void {
    super.revert(world);
    this.afterRevert?.();
  }
  coalesce(next: EditCommand): boolean {
    if (!(next instanceof HeightStrokeCommand) && !(next instanceof HeightCellsCommand)) {
      return false;
    }
    return HeightCellsCommand.prototype.coalesce.call(this, next);
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
  ) {}

  apply(world: World): void {
    if (findRegion(world, this.region.id)) return;
    world.regions.push({
      ...this.region,
      cells: [...this.region.cells],
    });
  }

  revert(world: World): void {
    world.regions = world.regions.filter((r) => r.id !== this.region.id);
  }
}

/** 粗粒度 fallback：仅克隆给定 regionIds（避免全图）；revert 时 COW 复用引用 */
export class PatchRegionsCommand implements EditCommand {
  private before: Region[] = [];
  constructor(
    private capture: () => Region[],
    private restore: (regions: Region[]) => void,
    public label = '编辑',
  ) {}
  apply(): void {
    this.before = this.capture();
  }
  revert(): void {
    // COW：restore 接收引用；后续编辑替换 cells 引用即可，无需再拷贝数组
    this.restore(this.before.map(restoreRegionCOW));
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

  undo(world: World): boolean {
    const cmd = this.stack.pop();
    if (!cmd) return false;
    cmd.revert(world);
    this.redoStack.push(cmd);
    return true;
  }

  redo(world: World): boolean {
    const cmd = this.redoStack.pop();
    if (!cmd) return false;
    cmd.apply(world);
    this.stack.push(cmd);
    return true;
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
