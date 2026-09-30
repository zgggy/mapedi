import type { LayerRenderConfig, Region } from '../core/types';
import { defaultLayerRenderConfig } from '../core/types';
import { createWorld, deserializeWorld, serializeWorld, invalidatePickCache, ensureBuiltinLayers } from '../core/world';
import { runCascade, CASCADE_LABELS } from '../core/generate/registry';
import { invalidateProjCache, installProjCache, type ProjCache } from '../render/projCache';
import { invalidateBorderCache } from '../render/borderCache';
import { invalidateCellGrid } from '../core/index/cellGrid';
import { invalidateRegionIndex } from '../core/index/regionIndex';
import { invalidateCellIndex } from '../core/index/cellIndex';
import { invalidateCellGraph } from '../core/index/cellGraph';
import { invalidateViewIndex } from '../render/viewIndex';
import {
  AnnexCommand,
  CreateRegionCommand,
  DeleteRegionCommand,
  HeightStrokeCommand,
  PaintCellsCommand,
  SetCenterCommand,
  history,
} from '../core/history';
import { setRegionColor } from '../core/regionOps';
import { createRng } from '../core/rng';
import {
  addCellsToRegion,
  adjustWeights,
  cellAtPoint,
  cellsInBrush,
  emptyDrawSession,
  floodFillCells,
  pointInPolygon,
  removeCellsFromRegion,
  resolveDrawTarget,
  shareCellsWithOthers,
  stealFromSiblings,
  type DrawSession,
  type DrawTool,
} from '../core/draw/brush';
import { buildRoadSegments, dragRoadEndpoint, roadComponentCount } from '../core/draw/roads';
import { computeClimate } from '../core/climate';
import { generateBiomes } from '../core/biomes';
import { absorbLandCell, releaseOceanCell, heightTopologyChanged } from '../core/heightRegions';
import { rebuildLandSeaRegions } from '../core/layer/landSea';
import { rebuildHeightIntervalElements, updateHeightIntervalElements, normalizeHeightIntervalElements } from '../core/layer/heightElements';
import {
  defaultLayerVisible,
  isFreeLayer as isFreeLayerDef,
  visibleColorRoots,
  materializeParentCells,
} from '../core/displayCompose';
import { bumpAllRev, bumpHeightRev, bumpRegionsRev, regionsRev } from '../core/rev';
import { DEFAULT_DENSITY } from '../core/world';
import { generateWorldAsync, loadWorldAsync } from '../core/generate/runGenerate';
import { defaultStarSystem, syncHomeFromClimate } from '../core/astro';
import { defaultPathColor } from '../core/paths';
import {
  demoteRegionAsChild,
  promoteRegionToParentLayer,
  applyRegionDrop,
  moveAmongSiblings,
  siblingRegions,
  type DropHint,
} from '../core/regionOps';
import { defaultExclusiveColor } from '../core/layer/style';
import { unifiedGenerate } from '../core/generate/unified';
import { genConfigFromParams } from '../core/layer';
import {
  patchElementStyle,
  clampElementStyle,
  type ElementStyle,
  type ElementStylePatch,
} from '../core/layer/style';
import { resolveLayerStyle } from '../core/layer/config';
import {
  setHeightStroke,
} from '../core/draw/heightDraw';
import {
  membershipDrawStroke,
  type DrawActor,
  type OverwriteMode,
} from '../core/draw/membershipDraw';
import { defaultLayerConfig, placementAllows } from '../core/layer/config';
import { HEIGHT_INTERVALS, intervalById } from '../core/layer/heightIntervals';
import { generateRoads, generateRoutes } from '../core/generate/networks';
import { generateRivers } from '../core/rivers';
import { applyHeightmapFile } from '../core/heightmap';
// ValidatorPanel 已按 D4=B 归档删除（2026-09-29）：core/validate.ts 与
// tests/validate.test.ts 保留为业务规则载体；还债步骤 1 后以「自动校验 + toast」
// 形态回归（规则清单见设计稿附录 A）。
import { defaultClimate, type ClimateParams, type LonLat, type World } from '../core/types';
import { idbLoad, idbSave } from '../persist/storage';
import { SOFT_MAX_DENSITY, HARD_MAX_DENSITY } from '../core/world';
import {
  cascadeEnabled,
  defaultProfiles,
  type GenerationProfile,
} from '../core/generate/profile';
import { DEFAULT_WORLD_SHAPE, type WorldShape } from '../core/layer/genTypes';

const NAME_POOL = ['北境', '南洋', '东海', '西陆', '中央', '苍岭', '赤原', '银湾', '铁丘', '雾林'];

/** 模块级响应式状态：App 通过 getter 读取即可追踪 */
let worldRaw: World | null = $state.raw(null);

const ui = $state({
  status: '正在生成世界…',
  generating: false,
  genProgress: 0,
  genStep: '',
  seedInput: String(Math.floor(Math.random() * 1e9)),
  densityInput: DEFAULT_DENSITY,
  densityUnlocked: false,
  focusLayer: 'cells',
  selectedRegionId: null as string | null,
  newName: '',
  annexPick: false,
  draw: emptyDrawSession() as DrawSession,
  climateDraft: defaultClimate() as ClimateParams,
  profiles: defaultProfiles() as GenerationProfile[],
  autosaveAt: '',
  searchQ: '',
  searchHits: [] as { id: string; name: string; layerId: string; cells: number }[],
  measuring: false,
  measureA: null as LonLat | null,
  measureB: null as LonLat | null,
  projectEpoch: 0,
  rev: 0,
});

// —— 生成参数草稿持久化（U3-b，设计稿 §3.3：localStorage mapedi.ui.gen.*）——
// 跨刷新保留种子/地块数/各层生成参数；500ms 防抖（胶囊滑动 onInput 连发避免逐帧 stringify）。
// try/catch = 外部存储尽力而为（隐私模式/配额满时降级为不持久，非掩盖根因）。
const GEN_DRAFT_KEY = 'mapedi.ui.gen';
function loadGenDraft() {
  try {
    const raw = localStorage.getItem(GEN_DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw) as {
      seedInput?: string;
      densityInput?: number;
      profiles?: { layerId: string; params: Record<string, number | string | boolean> }[];
    };
    if (typeof d.seedInput === 'string' && d.seedInput) ui.seedInput = d.seedInput;
    if (typeof d.densityInput === 'number' && d.densityInput > 0) ui.densityInput = d.densityInput;
    if (Array.isArray(d.profiles)) {
      for (const saved of d.profiles) {
        const p = ui.profiles.find((x) => x.layerId === saved.layerId);
        if (p && saved.params) p.params = { ...p.params, ...saved.params };
      }
    }
  } catch {
    /* 草稿损坏 → 用默认值 */
  }
}
let genDraftTimer: ReturnType<typeof setTimeout> | null = null;
function saveGenDraftSoon() {
  if (genDraftTimer) clearTimeout(genDraftTimer);
  genDraftTimer = setTimeout(() => {
    genDraftTimer = null;
    try {
      localStorage.setItem(
        GEN_DRAFT_KEY,
        JSON.stringify({
          seedInput: ui.seedInput,
          densityInput: ui.densityInput,
          profiles: ui.profiles.map((p) => ({ layerId: p.layerId, params: p.params })),
        }),
      );
    } catch {
      /* 存储不可用 → 放弃本次持久化 */
    }
  }, 500);
}
loadGenDraft();

export class EditorStore {
  get rev() { return ui.rev; }
  get projectEpoch() { return ui.projectEpoch; }
  // world 用 $state.raw：热路径（生成/重建/绘制）在裸对象上跑——深代理曾让
  // 松手重建放大 50-70×（2.2s/次）；响应性 = 身份变更 + notify（本设计的驱动方式）
  get world() { return worldRaw; }
  set world(v: World | null) { worldRaw = v; }
  /** 鼠标格 → 所属元素 id 列表（Region.cells 反查；仅 regions 域 rev 失效，height 绘制不触发重建） */
  private cellRegions: Map<number, string[]> | null = null;
  private cellRegionsRev = -1;
  regionIdsOfCell(cellId: number): string[] {
    const rev = regionsRev();
    if (!this.cellRegions || rev !== this.cellRegionsRev) {
      const m = new Map<number, string[]>();
      const w = worldRaw;
      if (w) {
        for (const r of w.regions) {
          for (const id of r.cells) {
            let l = m.get(id);
            if (!l) { l = []; m.set(id, l); }
            l.push(r.id);
          }
        }
      }
      this.cellRegions = m;
      this.cellRegionsRev = rev;
    }
    return this.cellRegions.get(cellId) ?? [];
  }
  get status() { return ui.status; }
  set status(v: string) { ui.status = v; }
  get generating() { return ui.generating; }
  set generating(v: boolean) { ui.generating = v; }
  get genProgress() { return ui.genProgress; }
  set genProgress(v: number) { ui.genProgress = v; }
  get genStep() { return ui.genStep; }
  set genStep(v: string) { ui.genStep = v; }
  get seedInput() { return ui.seedInput; }
  set seedInput(v: string) { ui.seedInput = v; saveGenDraftSoon(); }
  get densityInput() { return ui.densityInput; }
  set densityInput(v: number) { ui.densityInput = v; saveGenDraftSoon(); }
  get densityUnlocked() { return ui.densityUnlocked; }
  set densityUnlocked(v: boolean) { ui.densityUnlocked = v; }
  get focusLayer() { return ui.focusLayer; }
  set focusLayer(v: string) { ui.focusLayer = v; }
  get selectedRegionId() { return ui.selectedRegionId; }
  set selectedRegionId(v: string | null) { ui.selectedRegionId = v; }
  get newName() { return ui.newName; }
  set newName(v: string) { ui.newName = v; }
  get annexPick() { return ui.annexPick; }
  set annexPick(v: boolean) { ui.annexPick = v; }
  get draw() { return ui.draw; }
  set draw(v: DrawSession) { ui.draw = v; }
  get climateDraft() { return ui.climateDraft; }
  set climateDraft(v: ClimateParams) { ui.climateDraft = v; }
  get astro() {
    return this.world?.astro ?? null;
  }
  setAstro(patch: Partial<NonNullable<World['astro']>>) {
    if (!this.world?.astro) return;
    this.world.astro = { ...this.world.astro, ...patch };
    this.world = { ...this.world };
    this.notify();
  }
  setHomeAstro(patch: Partial<NonNullable<World['astro']>['home']>) {
    if (!this.world?.astro) return;
    const a = this.world.astro;
    this.world.astro = { ...a, home: { ...a.home, ...patch } };
    this.world = { ...this.world };
    this.notify();
  }
  setStarAstro(patch: Partial<NonNullable<World['astro']>['star']>) {
    if (!this.world?.astro) return;
    const a = this.world.astro;
    this.world.astro = { ...a, star: { ...a.star, ...patch } };
    this.world = { ...this.world };
    this.notify();
  }

  /** 通用星系补丁（Globe 面板用） */
  patchAstro(patch: Partial<NonNullable<World['astro']>>) {
    if (!this.world) return;
    const base = this.world.astro ?? defaultStarSystem(this.world.meta.seed, this.world.climate);
    this.world.astro = { ...base, ...patch };
    this.world = { ...this.world };
    this.notify();
  }

  patchCalendar(patch: Partial<NonNullable<NonNullable<World['astro']>['calendar']>>) {
    if (!this.world?.astro) return;
    const a = this.world.astro;
    const cal = { ...(a.calendar ?? { daysPerYear: 365, daysPerMonth: 30 }), ...patch };
    this.world.astro = { ...a, calendar: cal };
    this.world = { ...this.world };
    this.notify();
  }
  get profiles() { return ui.profiles; }
  set profiles(v: GenerationProfile[]) { ui.profiles = v; }
  get autosaveAt() { return ui.autosaveAt; }
  set autosaveAt(v: string) { ui.autosaveAt = v; }
  get searchQ() { return ui.searchQ; }
  set searchQ(v: string) { ui.searchQ = v; }
  get searchHits() { return ui.searchHits; }
  set searchHits(v: { id: string; name: string; layerId: string; cells: number }[]) { ui.searchHits = v; }
  get measuring() { return ui.measuring; }
  set measuring(v: boolean) { ui.measuring = v; }
  get measureA() { return ui.measureA; }
  set measureA(v: LonLat | null) { ui.measureA = v; }
  get measureB() { return ui.measureB; }
  set measureB(v: LonLat | null) { ui.measureB = v; }

  get revision() { return ui.rev; }
  notify() { ui.rev++; }

  private paintDirty = false;
  private strokeRegionId: string | null = null;
  private strokeRegionLayer: string | null = null;
  /** 提交后需定向失效的件前缀（渲染侧消费；守「全清/补丁」不变量） */
  private pendingPieceInvalidations: string[] = [];
  private strokeAdd: number[] = [];
  private strokeRm: number[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | undefined;
  private saveEpoch = 0;
  private saveQueue: Promise<void> = Promise.resolve();
  private generationSeq = 0;
  private paintFrame = 0;
  private heightStroke: { id: number; h: number }[] | null = null;
  private heightTouched: Set<number> | null = null;
  heightIntervalId = 'h6';
  /** 当前涂改高度值（工作区滑块选定；未选过则用所选区间的 min 兜底） */
  heightPaintValue: number | null = null;

  randomName(kind: string) {
    const rng = createRng((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    const base = NAME_POOL[Math.floor(rng() * NAME_POOL.length)];
    if (kind === 'country') return `${base}联邦`;
    if (kind === 'province') return `${base}省`;
    return base;
  }

  /** 几何/拓扑变化：全量失效（投影、拾取、索引、边界环） */
  touchWorld() {
    invalidateRegionIndex();
    invalidateCellGrid();
    invalidateProjCache();
    invalidateBorderCache();
    bumpAllRev();
    this.world = this.world ? { ...this.world } : this.world;
    this.notify();
  }

  /** Replace a project atomically; no selection or cached geometry belongs to the new world. */
  private replaceWorld(world: World) {
    clearTimeout(this.saveTimer);
    this.saveEpoch++;
    history.clear();
    this.world = world;
    ui.projectEpoch++;
    this.focusLayer = 'cells';
    this.selectedRegionId = null;
    this.draw = emptyDrawSession();
    this.annexPick = false;
    this.searchHits = [];
    this.measuring = false;
    this.measureA = null;
    this.measureB = null;
    this.climateDraft = { ...world.climate };
    invalidatePickCache();
    invalidateCellIndex();
    invalidateCellGraph();
    invalidateViewIndex();
    this.touchWorld();
  }

  /** 仅 Region 归属/排序/颜色：不重建投影缓存 */
  touchRegions() {
    invalidateRegionIndex();
    invalidateCellIndex();
    invalidateBorderCache();
    bumpRegionsRev();
    materializeParentCells(this.world!);
    this.world = this.world ? { ...this.world } : this.world;
    this.notify();
  }

  /** 仅视图/选中/UI：不失效几何缓存 */
  touchView() {
    this.notify();
  }


  /** 归属提交（增量）：bump data rev + 调用方标脏；不动静态贴图/边界缓存（rev 键自愈） */
  private touchRegionsIncremental() {
    invalidateRegionIndex();
    invalidateCellIndex();
    bumpRegionsRev();
    materializeParentCells(this.world!);
    this.world = this.world ? { ...this.world } : this.world;
    this.notify();
  }

  /** 高度提交：仅在拓扑变化时增量 rebuild 大陆/湖/海 */
  private heightGeomDirty = false;
  private heightDirtyIds: Set<number> | null = null;
  private heightNotifyQueued = false;

  /**
   * 高度笔刷的失效：**永不全清环缓存**（全清 = 下一帧重建所有可见件 = 秒级冻结）。
   * forward：tick 已增量维护高度件 → 只定向失效 landsea 件（拓扑翻转重塑大陆）；
   * undo：区间归属被反向套用而未打补丁 → 定向失效高度件。
   */
  touchHeight(full = false) {
    invalidateRegionIndex();
    invalidateCellGrid();
    // 件环**不删缓存**（删 = 内容消失 + 重暖风暴）：区间/landsea 的成员增减都以
    // Δ 补丁落盘（pendingHeightDeltas / pendingPiecePatches），见 flushHeightRegions。
    void full;
    bumpHeightRev();
    bumpRegionsRev();
    this.heightGeomDirty = true;
    this.world = this.world ? { ...this.world } : this.world;
    this.notify();
  }

  private markHeightDirty(ids: Iterable<number>) {
    if (!this.heightDirtyIds) this.heightDirtyIds = new Set();
    for (const id of ids) this.heightDirtyIds.add(id);
    this.heightGeomDirty = true;
  }

  /** commit 后：拓扑变才 rebuild；尽量增量 */
  private flushHeightRegions(samples?: { id: number; h0: number; h1: number }[]) {
    if (!this.world) return;
    const sampleIds = samples?.map((s) => s.id) ?? null;
    // 【绘制模型】区间归属只在松手时一次重算；Δ 交给渲染侧打件环补丁
    if (samples && samples.length) {
      const deltas = updateHeightIntervalElements(this.world, samples);
      if (deltas.length) this.pendingHeightDeltas.push(...deltas);
    } else {
      rebuildHeightIntervalElements(this.world);
    }
    if (!this.heightGeomDirty) {
      bumpHeightRev();
      return;
    }
    if (samples && samples.length && !heightTopologyChanged(samples)) {
      this.heightGeomDirty = false;
      this.heightDirtyIds = null;
      bumpHeightRev();
      return;
    }
    const dirty = this.heightDirtyIds;
    const dirtyList = dirty && dirty.size ? [...dirty] : sampleIds;
    // rebuild 前后 diff landsea 成员 → 件环增量补丁（与高度 Δ 同型）
    const prevCells = new Map<string, Set<number>>();
    for (const r of this.world.regions) {
      if (r.layerId !== 'landsea') continue;
      prevCells.set(r.id, new Set(r.cells));
    }
    rebuildLandSeaRegions(this.world, dirtyList ?? null);
    for (const r of this.world.regions) {
      if (r.layerId !== 'landsea') continue;
      const prev = prevCells.get(r.id);
      const now = new Set(r.cells);
      const added: number[] = [];
      const removed: number[] = [];
      if (prev) {
        for (const id of now) if (!prev.has(id)) added.push(id);
        for (const id of prev) if (!now.has(id)) removed.push(id);
      } else {
        for (const id of now) added.push(id);
      }
      if (added.length || removed.length) {
        this.pendingPiecePatches.push({ setKey: `piece:landsea:${r.id}:0`, added, removed });
      }
    }
    this.heightGeomDirty = false;
    this.heightDirtyIds = null;
    bumpHeightRev();
    bumpRegionsRev();
  }

  /** 二期：笔刷 tick 的区间增减队列（渲染侧消费后打件环补丁） */
  private pendingHeightDeltas: import('../core/layer/heightElements').HeightIntervalDelta[] = [];
  /** landsea 件环补丁队列：rebuild 前后 diff 出增减格（提交/撤销走补丁，不删缓存） */
  private pendingPiecePatches: { setKey: string; added: number[]; removed: number[] }[] = [];
  consumePieceInvalidations(): string[] | null {
    if (!this.pendingPieceInvalidations.length) return null;
    const out = this.pendingPieceInvalidations;
    this.pendingPieceInvalidations = [];
    return out;
  }

  consumeHeightDeltas(): import('../core/layer/heightElements').HeightIntervalDelta[] | null {
    if (!this.pendingHeightDeltas.length) return null;
    const out = this.pendingHeightDeltas;
    this.pendingHeightDeltas = [];
    return out;
  }

  consumePiecePatches(): { setKey: string; added: number[]; removed: number[] }[] | null {
    if (!this.pendingPiecePatches.length) return null;
    const out = this.pendingPiecePatches;
    this.pendingPiecePatches = [];
    return out;
  }

  private touchPaint() {
    invalidateRegionIndex();
    this.paintFrame++;
    if (this.paintFrame % 3 === 0) {
      this.world = this.world ? { ...this.world } : this.world;
      this.notify();
    }
  }

  async generate(seed: number, count: number) {
    const seq = ++this.generationSeq;
    // 硬上限唯一钳制点（core/world.HARD_MAX_DENSITY）；软上限解锁是 UI 策略，不在生成链
    const n = Math.max(100, Math.min(count, HARD_MAX_DENSITY));
    this.generating = true;
    this.genProgress = 0;
    this.status = `生成中… ${n} 地块`;
    this.notify();
    try {
      // P1：整链 Worker（主线程不冻）；失败再退回主线程
      await this.generateViaWorker(seed, n, seq);
      if (seq !== this.generationSeq) return;
      this.generating = false;
      this.genProgress = 100;
      this.notify();
    } catch {
      if (seq !== this.generationSeq) return;
      try {
        await this.generateOnMain(seed, n, false, seq);
        if (seq !== this.generationSeq) return;
        this.generating = false;
        this.genProgress = 100;
        this.notify();
      } catch (e) {
        this.status = `生成失败 ${e}`;
        this.generating = false;
        this.notify();
      }
    }
  }

  private async generateViaWorker(seed: number, count: number, seq: number) {
    this.status = `生成中（Worker）… ${count} 地块`;
    this.notify();
    // profile 面板参数随 Worker 下发（否则面板旋钮只在主线程回退路径生效）
    const params: Record<string, Record<string, number | string | boolean>> = {};
    for (const p of this.profiles) params[p.layerId] = p.params;
    const got = await generateWorldAsync(seed, count, (p) => {
      if (seq !== this.generationSeq) return;
      this.genProgress = p.progress;
      this.status = `${p.label}… ${p.progress}%`;
      this.notify();
    }, params);
    if (seq !== this.generationSeq) return;
    const world = got.world;
    if (got.projCache) installProjCache(got.projCache);
    for (const r of world.regions) {
      if (!r.exclusiveColor && r.color) r.exclusiveColor = defaultExclusiveColor(r.color);
    }
    rebuildLandSeaRegions(world);
    world.astro = defaultStarSystem(seed, world.climate);
    this.replaceWorld(world);
    // 生成后默认选中并显示高度层（产品默认：生成 → 直接看地形）
    world.layers.find((l) => l.id === 'height')!.visible = true;
    this.focusLayer = 'height';
    this.status = `${world.cells.length} 地块 · Worker`;
    this.scheduleAutosave();
    this.notify();
  }

  private async generateOnMain(seed: number, count: number, quiet = false, seq = this.generationSeq) {
    const t0 = performance.now();
    // 让浏览器先绘制一次 loading
    await new Promise((r) => setTimeout(r, 0));
    if (seq !== this.generationSeq) return;
    const world = createWorld({ seed, count });
    const params: Record<string, Record<string, number | string | boolean>> = {};
    for (const p of this.profiles) params[p.layerId] = p.params;
    const enabled = new Set(cascadeEnabled(this.profiles));
    runCascade(world, seed, undefined, undefined, params, enabled);
    world.astro = defaultStarSystem(seed, world.climate);
    for (const r of world.regions) {
      if (!r.exclusiveColor && r.color) r.exclusiveColor = defaultExclusiveColor(r.color);
    }
    rebuildLandSeaRegions(world);
    if (seq !== this.generationSeq) return;
    this.replaceWorld(world);
    // 生成后默认选中并显示高度层（产品默认：生成 → 直接看地形）
    world.layers.find((l) => l.id === 'height')!.visible = true;
    this.focusLayer = 'height';
    const ms = Math.round(performance.now() - t0);
    if (!quiet) this.status = `${world.cells.length} 地块 · ${ms}ms`;
    void CASCADE_LABELS;
    this.scheduleAutosave();
    this.notify();
  }

  regenLayer(layerId: string) {
    if (!this.world) return;
    const params = this.profiles.find((p) => p.layerId === layerId)?.params;
    const enabled = new Set([layerId]);
    // 依赖层也要跑，否则 climate 缺失
    const deps = this.profiles.find((p) => p.layerId === layerId);
    void deps;
    runCascade(
      this.world,
      this.world.meta.seed,
      [layerId],
      undefined,
      params ? { [layerId]: params } : undefined,
      enabled,
    );
    if (layerId === 'height') {
      // 「生成高度图 = 删除海陆图层[元素]」（2026-09-30 用户语义）：地形重跑后旧海陆
      // 划分失效 → 删旧建新（rebuildLandSeaRegions 全量重建派生元素）
      rebuildLandSeaRegions(this.world);
    }
    this.touchWorld();
    if (layerId === 'height') {
      // 高度重生成后默认显示并聚焦高度层（与整世界生成同规则）
      const h = this.world?.layers.find((l) => l.id === 'height');
      if (h) h.visible = true;
      this.focusLayer = 'height';
    }
    this.status = `已重新生成：${layerId}`;
  }

  setProfileParam(layerId: string, key: string, value: number | string | boolean) {
    this.profiles = this.profiles.map((p) =>
      p.layerId === layerId ? { ...p, params: { ...p.params, [key]: value } } : p,
    );
    saveGenDraftSoon();
  }

  /** height profile 参数的类型化视图（单源 = profiles；缺省 = DEFAULT_WORLD_SHAPE） */
  get worldShape(): WorldShape {
    const p = this.profiles.find((x) => x.layerId === 'height')?.params ?? {};
    const num = (k: keyof WorldShape, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
    const bool = (k: keyof WorldShape, d: boolean) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : d);
    return {
      landRatio: num('landRatio', DEFAULT_WORLD_SHAPE.landRatio),
      relief: num('relief', DEFAULT_WORLD_SHAPE.relief),
      flatness: num('flatness', DEFAULT_WORLD_SHAPE.flatness),
      continentScale: num('continentScale', DEFAULT_WORLD_SHAPE.continentScale),
      coastBreak: num('coastBreak', DEFAULT_WORLD_SHAPE.coastBreak),
      mountain: num('mountain', DEFAULT_WORLD_SHAPE.mountain),
      detail: num('detail', DEFAULT_WORLD_SHAPE.detail),
      seaRugged: num('seaRugged', DEFAULT_WORLD_SHAPE.seaRugged),
      latBias: num('latBias', DEFAULT_WORLD_SHAPE.latBias),
      erosion: num('erosion', DEFAULT_WORLD_SHAPE.erosion),
    };
  }

  /** 生成预设 */
  applyGenPreset(name: string) {
    const next = this.profiles.map((p) => ({ ...p, params: { ...p.params } }));
    const set = (id: string, params: Record<string, number | string | boolean>, on = true) => {
      const p = next.find((x) => x.layerId === id);
      if (p) {
        p.enabled = on;
        p.params = { ...p.params, ...params };
      }
    };
    switch (name) {
      case '群岛':
        set('height', { landRatio: 0.12, relief: 90, flatness: 0.15, continentScale: 0.25, coastBreak: 0.85, mountain: 0.6, detail: 0.7, latBias: 0.7 });
        set('country', { count: 12, fromLayerCount: 2, allowOcean: true });
        set('province', { count: 24 });
        break;
      case '海国世界':
        set('country', { allowOcean: true });
        set('culture', { allowOcean: true });
        break;
      case '高原世界':
        set('height', { landRatio: 0.28, relief: 80, flatness: 0.55, continentScale: 0.75, coastBreak: 0.35, mountain: 0.55, detail: 0.35, latBias: 0.35 });
        set('culture', { coreSelector: 'highElevation' });
        break;
      case '默认大陆':
      default:
        set('height', { landRatio: 0.15, relief: 127, flatness: 0, continentScale: 0.5, coastBreak: 0.55, mountain: 0.7, detail: 0.5, latBias: 0.55 });
        set('country', { count: 8, fromLayerCount: 3, allowOcean: false });
        set('province', { count: 15 });
        set('culture', { allowOcean: false });
        break;
    }
    this.profiles = next;
    this.status = `已套用预设：${name}`;
    this.notify();
  }

  toggleProfile(layerId: string) {
    this.profiles = this.profiles.map((p) =>
      p.layerId === layerId ? { ...p, enabled: !p.enabled } : p,
    );
  }

  scheduleAutosave() {
    if (!this.world) return;
    clearTimeout(this.saveTimer);
    const world = this.world;
    const epoch = this.saveEpoch;
    this.saveTimer = setTimeout(() => {
      this.saveQueue = this.saveQueue.then(async () => {
        if (epoch !== this.saveEpoch || world !== this.world) return;
        try {
          await idbSave(serializeWorld(world, { stripSharedEdges: true }));
          this.autosaveAt = new Date().toLocaleTimeString();
        } catch {
          this.status = '自动保存失败，请导出项目备份';
        }
      });
    }, 2000);
  }

  async tryRestore(): Promise<boolean> {
    const seq = this.generationSeq;
    const json = await idbLoad();
    if (seq !== this.generationSeq) return true;
    if (!json) return false;
    // Worker 反序列化 + 预建投影缓存（主线程免 0.8s 反序列化 + 1s 首建）；失败回退主线程
    let w: World;
    let projCache: ProjCache | undefined;
    try {
      const got = await loadWorldAsync(json);
      if (seq !== this.generationSeq) return true;
      w = got.world;
      projCache = got.projCache;
    } catch {
      w = deserializeWorld(json);
    }
    if (projCache) installProjCache(projCache);
    // 旧档区间嵌套累积（h≥lo）→ 精确档归一（成员由高度重导，对象/命名保留）
    normalizeHeightIntervalElements(w);
    ensureBuiltinLayers(w);
    if (!w.astro) w.astro = defaultStarSystem(w.meta.seed, w.climate);
    rebuildLandSeaRegions(w);
    this.replaceWorld(w);
    this.status = `已从浏览器恢复 · ${w.cells.length} 地块`;
    return true;
  }

  undo() {
    if (!this.world) return;
    if (history.undo(this.world)) {
      this.touchWorld();
      // 不清空选中：多步撤销时保持上下文
      this.status = `已撤销（剩余 ${history.depth} 步可撤销）`;
    } else this.status = '没有可撤销的操作';
  }

  redo() {
    if (!this.world) return;
    if (history.redo(this.world)) {
      this.touchWorld();
      this.status = '已重做';
    }
  }

  deleteSelected() {
    if (!this.world || !this.selectedRegionId) return;
    // 先试路径
    const pathIdx = (this.world.paths ?? []).findIndex((p) => p.id === this.selectedRegionId);
    if (pathIdx >= 0 && this.world.paths) {
      this.world.paths = this.world.paths.filter((p) => p.id !== this.selectedRegionId);
      this.touchRegions();
      this.status = '已删除路径';
      this.selectedRegionId = null;
      return;
    }
    const cmd = new DeleteRegionCommand(this.selectedRegionId);
    cmd.apply(this.world);
    history.run(this.world, cmd, { alreadyApplied: true });
    this.touchRegions();
    this.selectedRegionId = null;
    this.status = '已删除元素（子层保留为未分配）';
  }

  /** 右键菜单：显隐切换（元素/路径级，仅显示层过滤） */
  toggleItemHidden(id: string) {
    if (!this.world) return;
    const r = this.world.regions.find((x) => x.id === id);
    if (r) {
      r.hidden = !r.hidden;
      this.touchRegions();
      this.status = r.hidden ? `已隐藏「${r.name}」` : `已显示「${r.name}」`;
      return;
    }
    const p = (this.world.paths ?? []).find((x) => x.id === id);
    if (p) {
      p.hidden = !p.hidden;
      this.touchRegions();
      this.status = p.hidden ? `已隐藏「${p.name}」` : `已显示「${p.name}」`;
    }
  }

  /** 右键菜单：同父兄弟内上移/下移一层（dir=-1 上移）；图层/元素/路径通用 */
  moveItemStep(id: string, dir: -1 | 1) {
    if (!this.world) return;
    // 图层：同父兄弟在 layers 数组中的顺序
    const layer = this.world.layers.find((l) => l.id === id);
    if (layer) {
      const sibs = this.world.layers.filter((l) => (l.parentLayerId ?? null) === (layer.parentLayerId ?? null));
      const i = sibs.findIndex((l) => l.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sibs.length) return;
      const arr = this.world.layers;
      const ai = arr.indexOf(layer);
      const bi = arr.indexOf(sibs[j]);
      arr[ai] = sibs[j];
      arr[bi] = layer;
      this.touchWorld();
      this.status = dir < 0 ? '已上移一层' : '已下移一层';
      return;
    }
    const r = this.world.regions.find((x) => x.id === id);
    if (r) {
      const sibs = siblingRegions(this.world, r.layerId, r.parentId);
      const i = sibs.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= sibs.length) return;
      moveAmongSiblings(this.world, id, sibs[j].id, dir < 0 ? 'before' : 'after');
      this.touchRegions();
      this.status = dir < 0 ? '已上移一层' : '已下移一层';
      return;
    }
    const p = (this.world.paths ?? []).find((x) => x.id === id);
    if (p && this.world.paths) {
      const same = this.world.paths.filter((x) => x.layerId === p.layerId);
      const i = same.findIndex((x) => x.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= same.length) return;
      const arr = this.world.paths;
      const ai = arr.indexOf(p);
      const bi = arr.indexOf(same[j]);
      arr[ai] = same[j];
      arr[bi] = p;
      this.touchRegions();
      this.status = dir < 0 ? '已上移一层' : '已下移一层';
    }
  }

  /** 右键菜单：复制一个（元素 = 同层空胞副本；路径 = 点列副本；图层 = 新层副本） */
  copyItem(id: string) {
    if (!this.world) return;
    // 图层
    const layer = this.world.layers.find((l) => l.id === id);
    if (layer) {
      const n = this.world.layers.filter((l) => l.id.startsWith('custom-')).length + 1;
      const nid = `custom-${Date.now().toString(36)}`;
      this.world.layers.push({
        ...layer,
        id: nid,
        name: `${layer.name || id} 副本`,
        parentLayerId: layer.parentLayerId,
      });
      this.touchWorld();
      this.focusLayer = nid;
      this.status = '已复制图层（样式与设置，不含元素）';
      return;
    }
    // 路径
    const p = (this.world.paths ?? []).find((x) => x.id === id);
    if (p && this.world.paths) {
      const nid = `${p.layerId}-${Date.now().toString(36)}`;
      this.world.paths.push({
        ...p,
        id: nid,
        name: `${p.name} 副本`,
        points: p.points.map((q) => ({ ...q })),
      });
      this.selectedRegionId = nid;
      this.touchRegions();
      this.status = '已复制路径';
      return;
    }
    // 元素：同层同父副本（不复制 cells，避免双归属）+ 选中便于直接涂画
    const r = this.world.regions.find((x) => x.id === id);
    if (r) {
      const nid = `${r.layerId}-${Date.now().toString(36)}`;
      const copy: Region = {
        ...r,
        id: nid,
        name: `${r.name} 副本`,
        cells: [],
        hidden: undefined,
        adjacentElementIds: new Set<string>(),
        overlaps: [],
      };
      const idx = this.world.regions.indexOf(r);
      this.world.regions.splice(idx + 1, 0, copy);
      this.selectedRegionId = nid;
      this.touchRegions();
      this.status = `已复制「${r.name}」（空胞副本，涂画填充）`;
    }
  }

  /** 右键菜单：删除（元素/路径/自定义图层） */
  deleteItem(id: string) {
    if (!this.world) return;
    if (this.world.layers.some((l) => l.id === id)) {
      if (!id.startsWith('custom-')) {
        this.status = '内置图层不可删除';
        return;
      }
      this.world.layers = this.world.layers.filter((l) => l.id !== id);
      this.world.regions = this.world.regions.filter((r) => r.layerId !== id);
      this.world.layerRenderConfig?.delete(id);
      if (this.focusLayer === id) this.focusLayer = 'cells';
      this.touchWorld();
      this.status = '已删除图层';
      return;
    }
    this.selectedRegionId = id;
    this.deleteSelected();
  }

  doAnnex(targetId: string) {
    if (!this.world || !this.selectedRegionId || this.selectedRegionId === targetId) return;
    const a = this.world.regions.find((r) => r.id === this.selectedRegionId);
    const t = this.world.regions.find((r) => r.id === targetId);
    if (!a || !t || a.layerId !== t.layerId) {
      this.status = '吞并失败（需同层）';
      return;
    }
    const cmd = new AnnexCommand(this.selectedRegionId, targetId);
    cmd.apply(this.world);
    history.run(this.world, cmd, { alreadyApplied: true });
    this.touchRegions();
    this.annexPick = false;
    this.status = '已吞并（Ctrl+Z 可撤销）';
  }

  /** 添加自定义图层（可选名称，与工作区创建同一套 header） */
  addLayer(name?: string) {
    if (!this.world) return;
    const n = this.world.layers.filter((l) => l.id.startsWith('custom-')).length + 1;
    const id = `custom-${Date.now().toString(36)}`;
    const label = (name ?? this.newName)?.trim() || `图层 ${n}`;
    this.world.layers.push({
      id,
      name: label,
      kind: 'custom',
      modeDefault: 'edit',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    });
    this.newName = '';
    this.touchWorld();
    this.focusLayer = id;
    this.status = `已添加图层「${label}」`;
  }

  randomLayerName(): string {
    const pool = ['领地', '文明圈', '信仰带', '商路', '军区', '自治区', '遗迹区', '部落域'];
    return pool[Math.floor(Math.random() * pool.length)] + ' ' + (1 + Math.floor(Math.random() * 9));
  }

  /** 单击选中：只改选中态；填充/边界按选中层 */
  selectLayerTop(id: string) {
    this.focusLayer = id;
    this.selectedRegionId = null;
    if (this.draw.active && this.draw.targetRegionId === '__path__') {
      this.draw = { ...this.draw, active: false, targetRegionId: null };
    }
    this.notify();
  }

  /** 点击图层面板空白：不选中任何图层 */
  clearLayerSelection() {
    this.focusLayer = '';
    this.selectedRegionId = null;
    this.notify();
  }

  /** 图层显示样式（DisplayStyle 面板） */
  layerStyleConfig(id: string): ElementStyle {
    return resolveLayerStyle(this.world, id);
  }

  setLayerStyle(id: string, patch: ElementStylePatch) {
    if (!this.world) return;
    const map = this.world.layerRenderConfig ?? new Map();
    const cur = resolveLayerStyle(this.world, id);
    // 只叠局部 patch，不整份回写默认
    const next = clampElementStyle(patchElementStyle(cur, patch));
    map.set(id, next);
    this.world.layerRenderConfig = map;
    this.touchRegions();
  }

  /** 显示开关：点击图层 box；最多 3 个颜色根树（父+子占 1 名额） */
  toggleLayerVisible(id: string) {
    if (!this.world) return;
    const layers = this.world.layers;
    const layer = layers.find((l) => l.id === id);
    if (!layer) return;
    const def = defaultLayerVisible(layer);
    const cur = layer.visible ?? def;
    const next = !cur;
    const byId = new Map(layers.map((l) => [l.id, l]));

    if (next) {
      // 点亮子层时父链一并点亮（子随父显示）
      let p = layer.parentLayerId;
      const chain: string[] = [];
      while (p && byId.has(p)) {
        chain.push(p);
        p = byId.get(p)!.parentLayerId;
      }
      for (const pid of chain) {
        const pl = byId.get(pid)!;
        if (pl.visible === false || (pl.visible === undefined && !defaultLayerVisible(pl))) {
          pl.visible = true;
        }
      }
      layer.visible = true;
      // 根树名额（试算）
      const roots = visibleColorRoots(this.world, 3);
      // 若新开的是自由层则不限；否则确认根数
      if (!isFreeLayerDef(layer)) {
        const visibleSet = new Set(
          layers.filter((l) => l.visible ?? defaultLayerVisible(l)).map((l) => l.id),
        );
        let rootCount = 0;
        for (const l of layers) {
          if (isFreeLayerDef(l)) continue;
          if (!visibleSet.has(l.id)) continue;
          const par = l.parentLayerId;
          if (par && visibleSet.has(par)) continue;
          rootCount++;
        }
        if (rootCount > 3) {
          layer.visible = false;
          // 父链可能被点亮，保持原状即可（不回滚父，避免误关）
          this.status = '最多同时显示 3 个图层树（父+子占 1 席）';
          this.notify();
          return;
        }
      }
      void roots;
      this.status = `显示「${layer.name || id}」`;
    } else {
      layer.visible = false;
      // 关父则关整棵子树
      const kids = (pid: string) => layers.filter((l) => l.parentLayerId === pid);
      const stack = [id];
      while (stack.length) {
        const curId = stack.pop()!;
        for (const k of kids(curId)) {
          k.visible = false;
          stack.push(k.id);
        }
      }
      this.status = `隐藏「${layer.name || id}」`;
    }
    this.touchLayerView();
  }

  setLayerOpacity(id: string, opacity: number) {
    if (!this.world) return;
    const layer = this.world.layers.find((l) => l.id === id);
    if (!layer) return;
    layer.opacity = Math.max(0, Math.min(1, opacity));
    this.touchLayerView();
  }

  /**
   * 图层显隐/不透明度：**视图态**轻失效——只换 world 身份触发重绘 + dataRev 变
   * 使合成缓存失效；件环/几何缓存不受影响（显隐不改变任何 cell 集），隐藏层再显示
   * 应毫秒级命中缓存，禁止走 touchRegions 的全量失效。
   */
  private touchLayerView() {
    bumpRegionsRev();
    this.world = this.world ? { ...this.world } : this.world;
    this.notify();
  }

  /** 聚焦该层（显隐由 toggleLayerVisible 独立控制，此处不再强制显示） */
  focusLayerForDraw(id: string) {
    this.selectLayerTop(id);
    this.notify();
  }

  /** 图层拖拽 */
  dragLayer(
    fromId: string,
    hint: { kind: 'nest'; targetId: string; nestFirst?: boolean } | { kind: 'gap'; afterId: string | null } | { kind: 'root' },
  ) {
    if (!this.world) return;
    const layers = this.world.layers;
    const from = layers.find((l) => l.id === fromId);
    if (!from) return;

    if (hint.kind === 'root') {
      if (from.parentLayerId) {
        from.parentLayerId = undefined;
        this.touchRegions();
        this.status = `${from.name || fromId} 已提到顶层`;
      } else {
        const fi = layers.indexOf(from);
        layers.splice(fi, 1);
        layers.push(from);
        this.touchRegions();
        this.status = '已排序图层';
      }
      return;
    }

    if (hint.kind === 'nest') {
      if (fromId === hint.targetId) return;
      let cur: string | undefined = hint.targetId;
      while (cur) {
        if (cur === fromId) {
          this.status = '不能形成循环';
          return;
        }
        cur = layers.find((l) => l.id === cur)?.parentLayerId;
      }
      from.parentLayerId = hint.targetId;
      this.touchRegions();
      this.status = `${from.name || fromId} → 子层 of ${hint.targetId}`;
      return;
    }

    const afterId = hint.afterId;
    const parentKey = from.parentLayerId ?? null;
    if (!afterId) {
      const sibs = layers.filter((l) => (l.parentLayerId ?? null) === parentKey);
      const fi = layers.indexOf(from);
      layers.splice(fi, 1);
      const firstOther = sibs.find((l) => l.id !== fromId);
      if (firstOther) {
        const ti = layers.indexOf(firstOther);
        layers.splice(ti, 0, from);
      } else {
        layers.unshift(from);
      }
      this.touchRegions();
      this.status = '已插入到最前';
      return;
    }
    const after = layers.find((l) => l.id === afterId);
    if (!after) return;
    if ((from.parentLayerId ?? null) !== (after.parentLayerId ?? null)) {
      from.parentLayerId = after.parentLayerId;
    }
    const fi = layers.indexOf(from);
    layers.splice(fi, 1);
    const ai = layers.indexOf(after);
    layers.splice(ai + 1, 0, from);
    this.touchRegions();
    this.status = '已排序图层';
  }

  /** 工作区元素拖拽（统一 applyRegionDrop） */
  dragRegion(fromId: string, hint: DropHint) {
    if (!this.world) return;
    const r = applyRegionDrop(this.world, fromId, hint);
    this.touchRegions();
    this.status = r.message;
    if (r.ok) this.selectedRegionId = fromId;
  }

  createRegion(layerId: string, parentId?: string) {
    if (!this.world) return;
    let meta = this.world.layers.find((l) => l.id === layerId);
    if (!meta) {
      ensureBuiltinLayers(this.world);
      meta = this.world.layers.find((l) => l.id === layerId);
    }
    if (!meta) {
      this.status = `图层 ${layerId} 不存在，无法添加`;
      return;
    }

    // 道路/航线/河流：工作区「添加」= 建一条空曲线，再在地图上绘制控制点
    if (layerId === 'road' || layerId === 'route' || layerId === 'river') {
      const name = this.newName.trim() || `${meta.name} ${(this.world.paths?.filter((p) => p.layerId === layerId).length ?? 0) + 1}`;
      if (!this.world.paths) this.world.paths = [];
      const existingEmpty = this.world.paths.find(
        (p) => p.layerId === layerId && (!p.points || p.points.length < 2),
      );
      if (existingEmpty) {
        existingEmpty.name = name;
        this.newName = '';
        this.touchRegions();
        this.status = `已重命名「${name}」，在地图上点击绘制`;
        return;
      }
      this.world.paths.push({
        id: `${layerId}-${Date.now().toString(36)}`,
        layerId: layerId as 'road' | 'route' | 'river',
        name,
        points: [],
        color: defaultPathColor(layerId as 'road' | 'route' | 'river'),
        attributes: {},
      });
      const pid = this.world.paths[this.world.paths.length - 1].id;
      this.newName = '';
      // 选中新建的路径并进入编辑，地图上画点即写入这条曲线
      this.selectedRegionId = pid;
      this.draw = {
        ...emptyDrawSession(),
        active: true,
        targetRegionId: pid,
        tool: 'brush',
        addMode: true,
      };
      this.focusLayer = layerId;
      this.touchRegions();
      this.status = `已添加「${name}」→ 在地图上点两下生成直线`;
      return;
    }

    const name = this.newName.trim() || this.randomName(layerId as 'country' | 'province');
    const colors = ['#c45c5c', '#5c8dc4', '#5cc48d', '#c4a15c', '#9b5cc4', '#c47a5c'];
    const id = `${layerId}-${Date.now().toString(36)}`;
    const parent = parentId
      ? this.world.regions.find((r) => r.id === parentId)
      : undefined;
    history.run(
      this.world,
      new CreateRegionCommand({
        id,
        layerId,
        name,
        cells: [],
        parentId: parent?.id,
        color: parent?.color ?? colors[this.world.regions.filter((r) => r.layerId === layerId).length % colors.length],
        exclusiveColor: parent ? defaultExclusiveColor(parent.color) : undefined,
        attributes: {},
      }),
    );
    moveAmongSiblings(this.world, id, null, 'before');
    this.touchRegions();
    this.newName = '';
    this.selectedRegionId = id;
    this.status = `已新增「${name}」`;
  }

  renameSelected() {
    if (!this.world || !this.selectedRegionId) return;
    const r = this.world.regions.find((x) => x.id === this.selectedRegionId);
    if (!r) return;
    const next = window.prompt('名称', r.name);
    if (next !== null && next.trim()) {
      r.name = next.trim();
      this.touchWorld();
    }
  }

  recolorSelected() {
    if (!this.world || !this.selectedRegionId) return;
    const r = this.world.regions.find((x) => x.id === this.selectedRegionId);
    if (!r) return;
    const next = window.prompt('颜色 (#RRGGBB)', r.color);
    if (next) {
      setRegionColor(this.world, this.selectedRegionId, next);
      this.touchWorld();
    }
  }

  startDraw(regionId: string) {
    this.selectedRegionId = regionId;
    const region = this.world?.regions.find((r) => r.id === regionId);
    // 区间型元素（kind=interval）的绘制语义 = 把区间值直刷到 cell（`__height__` 协议），
    // 不是区域归属——归属由高度派生（数据驱动，未来区间型元素同一规则）
    if (region?.attributes?.kind === 'interval') {
      this.startHeightDraw(regionId);
      return;
    }
    const layer = this.world?.layers.find((l) => l.id === region?.layerId);
    let tool: DrawTool = 'brush';
    if (layer?.kind === 'road' || layer?.kind === 'route') tool = 'road';
    this.draw = { ...emptyDrawSession(), active: true, targetRegionId: regionId, tool, addMode: true };
    this.status =
      tool === 'road'
        ? '道路绘制：左键加地块；拖端点 · Esc 退出'
        : '绘制会话：左键笔刷，Shift 移除，Esc 退出';
  }

  /** 高度绘制会话：整数场 + 12 工作区间 */
  startHeightDraw(intervalId?: string) {
    // 笔刷目标元素 = 选中态（工作区黄框，与图层面板选中语义一致）
    this.selectedRegionId = intervalId ?? this.heightIntervalId ?? null;
    this.heightIntervalId = intervalId ?? this.heightIntervalId ?? 'h6';
    this.draw = {
      ...emptyDrawSession(),
      active: true,
      targetRegionId: `__height__:${this.heightIntervalId}`,
      tool: 'brush',
      addMode: true,
    };
    const iv = intervalById(this.heightIntervalId);
    this.status = `高度绘制 · ${iv?.name ?? ''} ${this.heightPaintValue ?? iv?.min ?? 0}：左键刷值 · 右键擦除 · Esc 退出`;
  }

  setHeightInterval(intervalId: string) {
    this.heightIntervalId = intervalId;
    if (this.draw.targetRegionId?.startsWith('__height__')) {
      this.draw = { ...this.draw, targetRegionId: `__height__:${intervalId}` };
    }
    const iv = intervalById(intervalId);
    this.status = `选定：${iv?.name ?? intervalId}（${iv?.lo} ~ ${iv?.hi}）→ 涂改值 ${this.heightPaintValue}`;
    this.notify();
  }

  /** 工作区滑块联动：滑动即选定该元素 + 涂改值 = 滑块数字 */
  setHeightPaint(intervalId: string, value: number) {
    this.heightIntervalId = intervalId;
    this.heightPaintValue = value;
    if (this.draw.targetRegionId?.startsWith('__height__')) {
      this.draw = { ...this.draw, targetRegionId: `__height__:${intervalId}` };
    }
    const iv = intervalById(intervalId);
    this.status = `涂改值 ${value}（${iv?.name ?? intervalId}）`;
    this.notify();
  }

  heightIntervals() {
    return HEIGHT_INTERVALS;
  }

  setDrawTool(tool: DrawTool) {
    this.draw = { ...this.draw, tool };
  }

  endDraw() {
    if (this.draw.active) {
      this.draw = { ...this.draw, active: false };
      this.status = '已退出绘制会话';
      this.touchWorld();
    }
  }

  paint(lon: number, lat: number, shift: boolean, ctrl = false, alt = false, button = 0): number[] | null {
    if (!this.world || !this.draw.active) return null;
    const resolved = resolveDrawTarget(this.world, this.draw);
    if (!resolved) return null;
    if (resolved === 'height') {
      return this.paintHeight(lon, lat, shift, ctrl, alt, button === 2 ? 'right' : 'left');
    }
    const pointer = button === 2 || shift ? 'right' : 'left';
    const hits = cellsInBrush(this.world, lon, lat, this.draw.radiusDeg);
    if (!hits.length) return null;
    if (!this.paintDirty) {
      this.strokeRegionId = resolved.region.id;
      this.strokeRegionLayer = resolved.region.layerId;
      this.strokeAdd = [];
      this.strokeRm = [];
      this.paintDirty = true;
    }
    const lcfg = defaultLayerConfig(resolved.region.layerId);
    const actor: DrawActor = {
      layerId: resolved.region.layerId,
      elementId: resolved.region.id,
      overwrite: (this.draw.addMode ? 'emptyOnly' : 'replace') as OverwriteMode,
      placement: lcfg.placement,
      splitPolicy: lcfg.splitPolicy,
    };
    // placement 闸 + overwrite + splitPolicy
    const result = membershipDrawStroke(this.world, actor, {
      cellIds: hits,
      pointer: pointer as 'left' | 'right',
      shift,
      alt,
    });
    if (result.membershipChanges.length) {
      this.selectedRegionId = resolved.region.id;
      // 记录本 stroke 的增减（撤销/重做 + 提交定向失效都靠它）
      for (const ch of result.membershipChanges) {
        if (ch.toElementId === resolved.region.id && !this.strokeAdd.includes(ch.cellId)) {
          this.strokeAdd.push(ch.cellId);
        } else if (ch.fromElementId === resolved.region.id && !this.strokeRm.includes(ch.cellId)) {
          this.strokeRm.push(ch.cellId);
        }
      }
    }
    void placementAllows;
    void ctrl;
    return hits;
  }

  /** 高度笔刷：HeightDraw 整数语义 */
  paintHeight(lon: number, lat: number, shift: boolean, ctrl = false, alt = false, pointer: 'left' | 'right' = 'left'): number[] | null {
    void shift; void ctrl; void alt;
    if (!this.world) return null;
    const radius = this.draw.radiusDeg || 1.2;
    const hits = cellsInBrush(this.world, lon, lat, radius);
    if (!hits.length) return null;
    if (!this.paintDirty) {
      this.strokeRegionId = '__height__';
      this.strokeAdd = [];
      this.strokeRm = [];
      this.paintDirty = true;
      this.heightStroke = [];
      this.heightTouched = new Set();
    }
    // 撤销样本：每个 cell 在**首次触碰**时记录原高（此前只记首批 = 拖涂撤销不完整）
    for (const id of hits) {
      if (!this.heightTouched!.has(id)) {
        this.heightStroke!.push({ id, h: this.world!.cells[id].height });
        this.heightTouched!.add(id);
      }
    }
    // 【v2 语义】笔刷只写「选定值」（右键擦除为 0）；拖动中零重算，只回传命中供色块高亮
    const paintValue = this.heightPaintValue ?? intervalById(this.heightIntervalId)?.min ?? 0;
    setHeightStroke(this.world, hits, paintValue, pointer === 'right');
    for (const id of hits) {
      const c = this.world.cells[id];
      if (!c) continue;
      if (c.isOcean) releaseOceanCell(this.world, c.id);
      else absorbLandCell(this.world, c.id);
      this.markHeightDirty([c.id]);
    }
    return hits;
  }

  commitStroke() {
    if (this.strokeRegionId === '__height__' && this.heightStroke?.length) {
      const before = this.heightStroke;
      const samples = before.map(({ id, h }) => ({
        id,
        h0: h,
        h1: this.world!.cells[id].height,
      }));
      const w = this.world!;
      const dirtyIds = samples.map((s) => s.id);
      const cmd = new HeightStrokeCommand(samples, '高度笔刷');
      const topoChanged = heightTopologyChanged(samples);
      cmd.afterApply = () => {
        this.markHeightDirty(dirtyIds);
        this.flushHeightRegions(samples);
        this.touchHeight(false);
      };
      cmd.afterRevert = () => {
        this.markHeightDirty(dirtyIds);
        this.flushHeightRegions(samples.map((s) => ({ id: s.id, h0: s.h1, h1: s.h0 })));
        this.touchHeight(true);
      };
      history.run(w, cmd, { alreadyApplied: true });
      this.heightStroke = null;
      this.strokeRegionId = null;
      this.strokeRegionLayer = null;
      this.paintDirty = false;
      this.markHeightDirty(dirtyIds);
      this.flushHeightRegions(samples);
      if (this.world) this.world = { ...this.world };
      this.notify();
      return;
    }
    const strokeDirty = [...this.strokeAdd, ...this.strokeRm];
    if (this.world && this.strokeRegionId && (this.strokeAdd.length || this.strokeRm.length)) {
      history.run(
        this.world,
        new PaintCellsCommand(this.strokeRegionId, this.strokeAdd, this.strokeRm, '绘制'),
        { alreadyApplied: true },
      );
    }
    const committedRegion = this.strokeRegionId;
    const committedLayer = this.strokeRegionLayer;
    this.strokeRegionId = null;
    this.strokeRegionLayer = null;
    this.strokeAdd = [];
    this.strokeRm = [];
    this.paintDirty = false;
    // 归属提交：定向失效本区域件（指纹已废，「全清/补丁」二选一的不变量必须在这里兑现）
    if (strokeDirty.length) {
      this.touchRegionsIncremental();
      if (committedLayer && committedRegion) {
        this.pendingPieceInvalidations.push(`piece:${committedLayer}:${committedRegion}:`);
      }
    } else {
      this.touchRegions();
    }
  }

  flood(cellId: number) {
    if (!this.world || !this.draw.active) return;
    const resolved = resolveDrawTarget(this.world, this.draw);
    if (!resolved || resolved === 'height') return;
    const hits = floodFillCells(this.world, cellId, true);
    const before = new Set(resolved.region.cells);
    const add = hits.filter((id) => !before.has(id));
    addCellsToRegion(resolved.region, hits);
    stealFromSiblings(this.world, resolved.region, hits);
    if (add.length)
      history.run(this.world, new PaintCellsCommand(resolved.region.id, add, [], '填充'), {
        alreadyApplied: true,
      });
    this.touchWorld();
    this.status = `洪水填充 ${hits.length} 地块`;
  }

  setCenterAt(cellId: number) {
    if (!this.world || !this.selectedRegionId) return;
    history.run(this.world, new SetCenterCommand(this.selectedRegionId, cellId));
    this.touchWorld();
    this.status = `已设中心 → cell #${cellId}`;
  }

  endpoint(cellId: number, lon: number, lat: number, phase: 'start' | 'move' | 'end') {
    if (!this.world || !this.draw.active) return;
    const region = this.world.regions.find((r) => r.id === this.draw.targetRegionId);
    if (!region) return;
    if (phase === 'start') return;
    if (phase === 'move') {
      const cell = this.world.cells[cellId];
      if (cell && pointInPolygon(lon, lat, cell.polygon)) {
        dragRoadEndpoint(this.world, region, cellId, lon, lat, cellId, true);
        // 端点拖动只改 endpointOverrides（regions 域渲染提示）：不炸几何/投影缓存
        this.touchPaint();
      }
      return;
    }
    const cell = this.world.cells[cellId];
    const inside = cell ? pointInPolygon(lon, lat, cell.polygon) : false;
    const hit = cellAtPoint(this.world, lon, lat);
    const result = dragRoadEndpoint(this.world, region, cellId, lon, lat, hit, inside);
    this.touchRegions();
    if (result === 'transfer') this.status = '端点已拖出：原地块取消道路，目标地块纳入道路';
    else if (result === 'override') this.status = '端点已微调（多边形内）';
  }

  roadSegments() {
    if (!this.world || !this.draw.active || this.draw.tool !== 'road' || !this.draw.targetRegionId)
      return [];
    const region = this.world.regions.find((r) => r.id === this.draw.targetRegionId);
    if (!region) return [];
    return buildRoadSegments(this.world, region);
  }

  roadBreaks() {
    if (!this.world || !this.draw.targetRegionId) return 0;
    const region = this.world.regions.find((r) => r.id === this.draw.targetRegionId);
    if (!region || region.cells.length === 0) return 0;
    return Math.max(0, roadComponentCount(this.world, region) - 1);
  }

  applyNature() {
    if (!this.world) return;
    this.world.climate = { ...this.climateDraft };
    if (this.world.astro) {
      this.world.astro = syncHomeFromClimate(this.world.astro, this.world.climate);
    } else {
      this.world.astro = defaultStarSystem(this.world.meta.seed, this.world.climate);
    }
    computeClimate(this.world);
    generateBiomes(this.world);
    const seed = this.world.meta.seed;
    for (const layerId of ['vegetation', 'fauna', 'race'] as const) {
      unifiedGenerate(this.world, layerId, genConfigFromParams(layerId, seed));
    }
    this.touchWorld();
    this.status = '已按气候重算群系/生物';
  }

  regenPolitical() {
    if (!this.world) return;
    const seed = this.world.meta.seed;
    // 行省先于国家（country = fromLayer 聚合 province）
    for (const layerId of ['province', 'country', 'culture', 'religion', 'military'] as const) {
      unifiedGenerate(this.world, layerId, genConfigFromParams(layerId, seed));
    }
    this.touchWorld();
  }

  regenNetworks() {
    if (!this.world) return;
    generateRoads(this.world, this.world.meta.seed, 3, 2, 1.2);
    generateRoutes(this.world, this.world.meta.seed, 6);
    this.touchWorld();
    this.status = '已重生成道路/航线';
  }

  async applyHeightmap(file: File) {
    if (!this.world) return;
    const r = await applyHeightmapFile(this.world, file, { seaLevel: 0.5 });
    generateRivers(this.world, Math.max(4, Math.floor(this.world.cells.length / 400)));
    this.applyNature();
    this.regenPolitical();
    this.touchWorld();
    this.status = `高程图已应用：陆地 ${r.land} · 海洋 ${r.ocean} · 已重算河网`;
  }

  measureClick(lon: number, lat: number) {
    const p = { lon, lat };
    if (!this.measureA || this.measureB) {
      this.measureA = p;
      this.measureB = null;
      this.measuring = true;
      this.status = '测量：点起点，再点终点';
    } else {
      this.measureB = p;
      this.measuring = false;
      this.status = `已设测量终点`;
    }
  }

  /** 导出纯 .mapedi.json（顶栏世界名菜单；.gz 是另一项，见 exportGz） */
  async exportJson() {
    if (!this.world) return;
    const { exportProjectFile } = await import('../persist/storage');
    exportProjectFile(this.world);
    this.status = '已导出 .mapedi.json';
  }

  /** 导出 .mapedi.json.gz */
  async exportGz() {
    if (!this.world) return;
    const { exportProjectGz } = await import('../persist/storage');
    const ok = await exportProjectGz(this.world).catch(() => false);
    this.status = ok ? '已导出 .gz' : '导出 .gz 失败——请改用 .mapedi.json';
  }

  /**
   * 世界改名（设计稿 D2）：只写 meta，不碰几何/归属缓存。
   * **必须显式 scheduleAutosave**——现有保存只被 `cells.length`/`regions.length` 变化触发，
   * 纯 meta 改动不会自动存盘（ROADMAP 已登记该缺陷）。
   */
  renameWorld(name: string) {
    if (!this.world) return;
    const v = name.trim();
    if (!v || v === this.world.meta.name) return;
    this.world.meta.name = v;
    this.touchView();
    this.scheduleAutosave();
    this.status = `已改名为「${v}」`;
  }

  async exportPng(canvas: HTMLCanvasElement | null) {
    if (!canvas || !this.world) return;
    const { exportPngFromCanvas } = await import('../persist/storage');
    exportPngFromCanvas(canvas, this.world.meta.seed);
    this.status = '已导出 PNG';
  }

  async exportSvg() {
    if (!this.world) return;
    const { exportSvg } = await import('../persist/storage');
    exportSvg(this.world);
    this.status = '已导出 SVG';
  }

  async exportGeoJson() {
    if (!this.world) return;
    const { exportGeoJson } = await import('../persist/storage');
    exportGeoJson(this.world);
    this.status = '已导出 GeoJSON';
  }

  async exportHeightmap() {
    if (!this.world) return;
    const { exportHeightmapPng } = await import('../persist/storage');
    exportHeightmapPng(this.world);
    this.status = '已导出高程图';
  }

  async importProjectFile(file: File) {
    const seq = ++this.generationSeq;
    this.generating = false;
    try {
      const { importProjectFile } = await import('../persist/storage');
      const w = await importProjectFile(file);
      if (seq !== this.generationSeq) return;
      ensureBuiltinLayers(w);
      rebuildLandSeaRegions(w);
      this.replaceWorld(w);
      this.status = `已导入 ${w.cells.length} 地块`;
    } catch (e) {
      this.status = `导入失败 ${e}`;
    }
  }

  async clearAutosave() {
    const { idbClear } = await import('../persist/storage');
    clearTimeout(this.saveTimer);
    this.saveEpoch++;
    await this.saveQueue;
    await idbClear();
    this.status = '已清除自动保存';
  }

  runSearch() {
    if (!this.world) return;
    // dynamic avoid cycle
    import('../persist/storage').then(({ searchRegions }) => {
      this.searchHits = searchRegions(this.world!, this.searchQ);
    });
  }

  focusSearch(id: string) {
    const r = this.world?.regions.find((x) => x.id === id);
    if (!r) return;
    this.focusLayer = r.layerId;
    this.selectedRegionId = r.id;
    this.status = `定位 ${r.name}`;
  }

  toggleMeasure() {
    this.measuring = !this.measuring;
    if (this.measuring) {
      this.measureA = null;
      this.measureB = null;
      this.status = '测距：点地图两点';
    } else this.status = '已退出测距';
  }

  get drawTargetLabel(): string {
    if (!this.world || !this.draw.active || !this.draw.targetRegionId) return '';
    const region = this.world.regions.find((r) => r.id === this.draw.targetRegionId);
    if (!region) return '';
    const childLayer = this.world.layers.find((l) => l.parentLayerId === region.layerId);
    if (childLayer) {
      const kids = this.world.regions.filter((r) => r.parentId === region.id);
      const kid = kids.find((k) => k.id === this.draw.parentRegionId) ?? kids[0];
      return kid ? `${region.name} · ${kid.name}` : `${region.name} · （将新建行省）`;
    }
    return region.name;
  }
}

export const editor = new EditorStore();
