import type { Region } from '../core/types';
import { deserializeWorld, invalidatePickCache, ensureBuiltinLayers } from '../core/world';
import { installProjCache, type ProjCache } from '../render/projCache';
import { invalidateCellGraph } from '../core/index/cellGraph';
import { invalidateViewIndex } from '../render/viewIndex';
import { history } from '../core/history';
import { ChangePipeline } from './changePipeline';
import { AutosaveService } from './autosaveService';
import { GenerationService } from './generationService';
import { DrawController } from './drawController';
import { CommandService } from './commandService';
import { createRng } from '../core/rng';
import { emptyDrawSession, type DrawSession, type DrawTool } from '../core/draw/brush';
import { rebuildLandSeaRegions } from '../core/layer/landSea';
import { normalizeHeightIntervalElements } from '../core/layer/heightElements';
import { defaultFocusLayerId, DEFAULT_FOCUS_LAYER_ID } from '../core/layer/flags';
import { regionsRev } from '../core/rev';
import { DEFAULT_DENSITY } from '../core/world';
import { loadWorldAsync } from '../core/generate/runGenerate';
import { defaultStarSystem } from '../core/astro';
import type { ElementStyle, ElementStylePatch } from '../core/layer/style';
// ValidatorPanel 已按 D4=B 归档删除（2026-09-29）：core/validate.ts 与
// tests/validate.test.ts 保留为业务规则载体；还债步骤 1 后以「自动校验 + toast」
// 形态回归（规则清单见设计稿附录 A）。
import { defaultClimate, type ClimateParams, type LonLat, type World } from '../core/types';
import { idbLoad } from '../persist/storage';
import { defaultProfiles, type GenerationProfile } from '../core/generate/profile';
import type { WorldShape } from '../core/layer/genTypes';

const NAME_POOL = ['北境', '南洋', '东海', '西陆', '中央', '苍岭', '赤原', '银湾', '铁丘', '雾林'];

/** 模块级响应式状态：App 通过 getter 读取即可追踪 */
let worldRaw: World | null = $state.raw(null);

const ui = $state({
  status: '正在生成世界…',
  /** 最近一次运行错误全文（含栈；状态栏复制按钮用，2026-10-01） */
  lastError: '',
  generating: false,
  genProgress: 0,
  genStep: '',
  seedInput: String(Math.floor(Math.random() * 1e9)),
  densityInput: DEFAULT_DENSITY,
  densityUnlocked: false,
  focusLayer: DEFAULT_FOCUS_LAYER_ID,
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

/** 世代序：任何「换世界」的异步操作（生成/恢复/导入）互斥过期闸（5-b2 起为模块状态，服务与 store 共享） */
let generationSeq = 0;

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
  get lastError() { return ui.lastError; }
  set lastError(v: string) { ui.lastError = v; }
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


  randomName(kind: string) {
    const rng = createRng((Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0);
    const base = NAME_POOL[Math.floor(rng() * NAME_POOL.length)];
    if (kind === 'country') return `${base}联邦`;
    if (kind === 'province') return `${base}省`;
    return base;
  }

  /** 失效管线（还债 5-a）：touch* 家族与高度派生 flush 的实现体；本类保留同名薄代理 */
  private readonly pipeline = new ChangePipeline({
    get world() {
      return worldRaw;
    },
    setWorld: (v) => {
      worldRaw = v;
    },
    notify: () => {
      ui.rev++;
    },
    scheduleAutosave: () => this.scheduleAutosave(),
  });

  /** 自动保存机械（还债 5-b1）：防抖/epoch/Worker 派发/降级链——状态回显经闭包注入 */
  private readonly autosave = new AutosaveService({
    get world() {
      return worldRaw;
    },
    snapPaths: (w) => CommandService.snapPaths(w),
    setAutosaveAt: (v) => {
      ui.autosaveAt = v;
    },
    setStatus: (v) => {
      ui.status = v;
    },
  });

  /** 生成编排（还债 5-b2）：Worker/主线程双路+单层再生成+生成参数——UI 回显经闭包注入 */
  private readonly gen = new GenerationService({
    get world() {
      return worldRaw;
    },
    get seq() {
      return generationSeq;
    },
    nextSeq: () => ++generationSeq,
    replaceWorld: (w) => this.replaceWorld(w),
    get profiles() {
      return ui.profiles;
    },
    setProfiles: (p) => {
      ui.profiles = p;
    },
    setFocusLayer: (v) => {
      ui.focusLayer = v;
    },
    setStatus: (v) => {
      ui.status = v;
    },
    setGenerating: (v) => {
      ui.generating = v;
    },
    setGenProgress: (v) => {
      ui.genProgress = v;
    },
    notify: () => {
      ui.rev++;
    },
    scheduleAutosave: () => this.scheduleAutosave(),
    touchWorld: () => this.touchWorld(),
    saveGenDraftSoon: () => saveGenDraftSoon(),
  });

  /** 绘制会话与笔画状态机（还债 5-b4）——选中/状态/失效族经闭包注入 */
  private readonly drawCtl = new DrawController({
    get world() {
      return worldRaw;
    },
    setWorld: (w) => {
      worldRaw = w;
    },
    get draw() {
      return ui.draw;
    },
    set draw(v) {
      ui.draw = v;
    },
    get selectedRegionId() {
      return ui.selectedRegionId;
    },
    set selectedRegionId(v) {
      ui.selectedRegionId = v;
    },
    setStatus: (v) => {
      ui.status = v;
    },
    notify: () => {
      ui.rev++;
    },
    touchWorld: () => this.touchWorld(),
    touchRegions: () => this.touchRegions(),
    touchRegionsIncremental: () => this.touchRegionsIncremental(),
    touchPaint: () => this.touchPaint(),
    markHeightDirty: (ids) => this.markHeightDirty(ids),
    flushHeightRegions: (samples) => this.flushHeightRegions(samples),
  });

  /** 命令 CRUD 与历史门面（还债 5-b5）——选中/焦点/状态/失效族经闭包注入 */
  private readonly cmds = new CommandService({
    get world() {
      return worldRaw;
    },
    get selectedRegionId() {
      return ui.selectedRegionId;
    },
    set selectedRegionId(v) {
      ui.selectedRegionId = v;
    },
    get focusLayer() {
      return ui.focusLayer;
    },
    set focusLayer(v) {
      ui.focusLayer = v;
    },
    get newName() {
      return ui.newName;
    },
    set newName(v) {
      ui.newName = v;
    },
    get annexPick() {
      return ui.annexPick;
    },
    set annexPick(v) {
      ui.annexPick = v;
    },
    get draw() {
      return ui.draw;
    },
    set draw(v) {
      ui.draw = v;
    },
    setStatus: (v) => {
      ui.status = v;
    },
    notify: () => {
      ui.rev++;
    },
    randomName: (kind) => this.randomName(kind),
    touchWorld: () => this.touchWorld(),
    touchRegions: () => this.touchRegions(),
    touchLayerView: () => this.touchLayerView(),
    touchHeight: (full) => this.touchHeight(full),
    markHeightDirty: (ids) => this.markHeightDirty(ids),
    flushHeightRegions: (samples) => this.flushHeightRegions(samples),
  });

  /** 几何/拓扑变化：全量失效（投影、拾取、索引、边界环） */
  touchWorld() {
    this.pipeline.touchWorld();
  }

  /** Replace a project atomically; no selection or cached geometry belongs to the new world. */
  private replaceWorld(world: World) {
    this.autosave.invalidate();
    history.clear();
    this.world = world;
    ui.projectEpoch++;
    this.focusLayer = defaultFocusLayerId(world);
    this.selectedRegionId = null;
    this.draw = emptyDrawSession();
    this.annexPick = false;
    this.searchHits = [];
    this.measuring = false;
    this.measureA = null;
    this.measureB = null;
    this.climateDraft = { ...world.climate };
    invalidatePickCache();
    invalidateCellGraph();
    invalidateViewIndex();
    this.touchWorld();
  }

  /** 仅 Region 归属/排序/颜色：不重建投影缓存 */
  touchRegions() {
    this.pipeline.touchRegions();
  }

  /** 仅视图/选中/UI：不失效几何缓存 */
  touchView() {
    this.pipeline.touchView();
  }

  /** 归属提交（增量）：bump data rev + 调用方标脏；不动静态贴图/边界缓存（rev 键自愈） */
  private touchRegionsIncremental() {
    this.pipeline.touchRegionsIncremental();
  }

  /** 高度失效/派生（实现体在 ChangePipeline——高度件永不全清环缓存、Δ 补丁落盘） */
  touchHeight(full = false) {
    this.pipeline.touchHeight(full);
  }

  private markHeightDirty(ids: Iterable<number>) {
    this.pipeline.markHeightDirty(ids);
  }

  /** commit 后：拓扑变才 rebuild；尽量增量（区间/landsea 派生重建 + 补丁入队） */
  private flushHeightRegions(samples?: { id: number; h0: number; h1: number }[]) {
    this.pipeline.flushHeightRegions(samples);
  }

  private touchPaint() {
    // 实现体在 ChangePipeline（笔画中每帧防抖入存 + 每 3 帧换身份通知）
    this.pipeline.touchPaint();
  }

  /** 整链生成（实现体在 GenerationService：Worker 主路 + 主线程回退） */
  async generate(seed: number, count: number) {
    await this.gen.generate(seed, count);
  }

  /** 单层再生成（实现体在 GenerationService；height 连带删旧建新海陆） */
  regenLayer(layerId: string) {
    this.gen.regenLayer(layerId);
  }

  setProfileParam(layerId: string, key: string, value: number | string | boolean) {
    this.gen.setProfileParam(layerId, key, value);
  }

  /** height profile 参数的类型化视图（单源 = profiles；缺省 = DEFAULT_WORLD_SHAPE） */
  get worldShape(): WorldShape {
    return this.gen.worldShape;
  }

  /** 生成预设 */
  scheduleAutosave() {
    this.autosave.schedule();
  }

  async tryRestore(): Promise<boolean> {
    const seq = generationSeq;
    const json = await idbLoad();
    if (seq !== generationSeq) return true;
    if (!json) return false;
    // Worker 反序列化 + 预建投影缓存（主线程免 0.8s 反序列化 + 1s 首建）；失败回退主线程
    let w: World;
    let projCache: ProjCache | undefined;
    try {
      const got = await loadWorldAsync(json);
      if (seq !== generationSeq) return true;
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

  // —— 命令 CRUD 与历史门面（实现体在 CommandService，还债 5-b5）——
  undo() {
    this.cmds.undo();
  }

  redo() {
    this.cmds.redo();
  }

  deleteSelected() {
    this.cmds.deleteSelected();
  }

  /** 右键菜单：显隐切换（元素/路径级，仅显示层过滤） */
  toggleItemHidden(id: string) {
    this.cmds.toggleItemHidden(id);
  }

  indentItem(id: string): void {
    this.cmds.indentItem(id);
  }

  unindentItem(id: string): void {
    this.cmds.unindentItem(id);
  }

  moveItemStep(id: string, dir: -1 | 1) {
    this.cmds.moveItemStep(id, dir);
  }

  organize(action: 'up' | 'down' | 'indent' | 'unindent', id: string) {
    this.cmds.organize(action, id);
  }

  copyItem(id: string) {
    this.cmds.copyItem(id);
  }

  deleteItem(id: string) {
    this.cmds.deleteItem(id);
  }

  doAnnex(targetId: string) {
    this.cmds.doAnnex(targetId);
  }

  addLayer(name?: string) {
    this.cmds.addLayer(name);
  }

  randomLayerName(): string {
    return this.cmds.randomLayerName();
  }

  layerStyleConfig(id: string): ElementStyle {
    return this.cmds.layerStyleConfig(id);
  }

  setLayerStyle(id: string, patch: ElementStylePatch) {
    this.cmds.setLayerStyle(id, patch);
  }

  toggleLayerVisible(id: string) {
    this.cmds.toggleLayerVisible(id);
  }

  setLayerOpacity(id: string, opacity: number) {
    this.cmds.setLayerOpacity(id, opacity);
  }

  /** 路径快照执行器（1-b）：fn 前后整表快照 → 有变化才入栈；统一 touch */
  withPaths(label: string, fn: () => void): void {
    this.cmds.withPaths(label, fn);
  }

  /** 控制点拖动会话：pointerdown 快照 / pointerup 提交 */
  beginPathsDrag(): void {
    this.cmds.beginPathsDrag();
  }

  commitPathsDrag(label = '移动控制点'): void {
    this.cmds.commitPathsDrag(label);
  }

  patchRegions(label: string, fn: () => void): void {
    this.cmds.patchRegions(label, fn);
  }

  createRegion(layerId: string, parentId?: string) {
    this.cmds.createRegion(layerId, parentId);
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

  /**
   * 图层显隐/不透明度：**视图态**轻失效——只换 world 身份触发重绘 + dataRev 变
   * 使合成缓存失效；件环/几何缓存不受影响（显隐不改变任何 cell 集），隐藏层再显示
   * 应毫秒级命中缓存，禁止走 touchRegions 的全量失效。
   */
  private touchLayerView() {
    this.pipeline.touchLayerView();
  }

  /** 聚焦该层（显隐由 toggleLayerVisible 独立控制，此处不再强制显示） */
  focusLayerForDraw(id: string) {
    this.selectLayerTop(id);
    this.notify();
  }

  // —— 绘制会话（实现体在 DrawController，还债 5-b4）——
  startDraw(regionId: string) {
    this.drawCtl.startDraw(regionId);
  }

  /** 高度绘制会话：整数场 + 12 工作区间 */
  startHeightDraw(intervalId?: string) {
    this.drawCtl.startHeightDraw(intervalId);
  }

  setHeightInterval(intervalId: string) {
    this.drawCtl.setHeightInterval(intervalId);
  }

  /** 工作区滑块联动：滑动即选定该元素 + 涂改值 = 滑块数字 */
  setHeightPaint(intervalId: string, value: number) {
    this.drawCtl.setHeightPaint(intervalId, value);
  }

  heightIntervals() {
    return this.drawCtl.heightIntervals();
  }

  setDrawTool(tool: DrawTool) {
    this.drawCtl.setDrawTool(tool);
  }

  endDraw() {
    this.drawCtl.endDraw();
  }

  paint(lon: number, lat: number, shift: boolean, ctrl = false, alt = false, button = 0): number[] | null {
    return this.drawCtl.paint(lon, lat, shift, ctrl, alt, button);
  }

  /** 高度笔刷：HeightDraw 整数语义 */
  paintHeight(lon: number, lat: number, shift: boolean, ctrl = false, alt = false, pointer: 'left' | 'right' = 'left'): number[] | null {
    return this.drawCtl.paintHeight(lon, lat, shift, ctrl, alt, pointer);
  }

  commitStroke() {
    this.drawCtl.commitStroke();
  }

  flood(cellId: number) {
    this.drawCtl.flood(cellId);
  }

  setCenterAt(cellId: number) {
    this.drawCtl.setCenterAt(cellId);
  }

  endpoint(cellId: number, lon: number, lat: number, phase: 'start' | 'move' | 'end') {
    this.drawCtl.endpoint(cellId, lon, lat, phase);
  }

  roadSegments() {
    return this.drawCtl.roadSegments();
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
   * **必须显式 scheduleAutosave**——数据类保存已集中到 touch* 家族（2026-10-01 修漏存缺陷），
   * 纯 meta 只走 touchView，故此处仍需显式排队。
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
    const seq = ++generationSeq;
    this.generating = false;
    try {
      const { importProjectFile } = await import('../persist/storage');
      const w = await importProjectFile(file);
      if (seq !== generationSeq) return;
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
    this.autosave.invalidate();
    await this.autosave.drainQueue();
    await this.autosave.drain();
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
