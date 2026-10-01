/**
 * DrawController（还债步骤 5-b4，2026-10-01）：绘制会话与笔画状态机从 store 出库——
 * 会话启停（成员/高度/道路）、笔刷命中、笔画快照-diff 入栈（undo 腐蚀修复的采集端）、
 * 洪水填充、设中心、道路端点/路段。状态（paintDirty/strokeSnap/高度样本/区间选择）
 * 随类迁移；选中/状态回显/world 身份/失效族经 Ctx 注入（$state 写仍留 store 闭包）。
 *
 * 不变量（搬运即语义，勿改）：
 * - 笔画开始在 resolveDrawTarget **之前**拍快照（resolve 可能自动新建元素也须被捕获）
 * - 高度样本 = 每 cell 首次触碰记原高（拖涂撤销完整性）
 * - 归属提交逐件定向失效（「全清/补丁」二选一在多元素语义下逐件兑现）
 */
import type { Region, World } from '../core/types';
import {
  addCellsToRegion,
  cellAtPoint,
  cellsInBrush,
  emptyDrawSession,
  floodFillCells,
  pointInPolygon,
  resolveDrawTarget,
  stealFromSiblings,
  type DrawSession,
  type DrawTool,
} from '../core/draw/brush';
import {
  membershipDrawStroke,
  type DrawActor,
  type OverwriteMode,
} from '../core/draw/membershipDraw';
import { defaultLayerConfig, placementAllows } from '../core/layer/config';
import { HEIGHT_INTERVALS, intervalById } from '../core/layer/heightIntervals';
import { setHeightStroke } from '../core/draw/heightDraw';
import { buildRoadSegments, dragRoadEndpoint, roadComponentCount } from '../core/draw/roads';
import { absorbLandCell, releaseOceanCell } from '../core/heightRegions';
import {
  HeightCellsCommand,
  MultiRegionCommand,
  SetCenterCommand,
  history,
} from '../core/history';
import { queuePieceInvalidation } from '../render/patchQueues';

export interface DrawCtx {
  readonly world: World | null;
  setWorld(w: World): void;
  get draw(): DrawSession;
  set draw(v: DrawSession);
  get selectedRegionId(): string | null;
  set selectedRegionId(v: string | null);
  setStatus(v: string): void;
  notify(): void;
  touchWorld(): void;
  touchRegions(): void;
  touchRegionsIncremental(): void;
  touchPaint(): void;
  markHeightDirty(ids: Iterable<number>): void;
  flushHeightRegions(samples?: { id: number; h0: number; h1: number }[]): void;
}

export class DrawController {
  private paintDirty = false;
  private strokeRegionId: string | null = null;
  /** 笔画前快照：regionId → cells 数组引用（写入全为 COW 换数组 → 引用比对即得副作用集） */
  private strokeSnap: Map<string, number[]> | null = null;
  private heightStroke: { id: number; h: number }[] | null = null;
  private heightTouched: Set<number> | null = null;
  heightIntervalId = 'h6';
  /** 当前涂改高度值（工作区滑块选定；未选过则用所选区间的 min 兜底） */
  heightPaintValue: number | null = null;

  constructor(private ctx: DrawCtx) {}

  startDraw(regionId: string): void {
    this.ctx.selectedRegionId = regionId;
    const region = this.ctx.world?.regions.find((r) => r.id === regionId);
    // 区间型元素（kind=interval）的绘制语义 = 把区间值直刷到 cell（`__height__` 协议），
    // 不是区域归属——归属由高度派生（数据驱动，未来区间型元素同一规则）
    if (region?.attributes?.kind === 'interval') {
      this.startHeightDraw(regionId);
      return;
    }
    const layer = this.ctx.world?.layers.find((l) => l.id === region?.layerId);
    let tool: DrawTool = 'brush';
    if (layer?.kind === 'road' || layer?.kind === 'route') tool = 'road';
    this.ctx.draw = { ...emptyDrawSession(), active: true, targetRegionId: regionId, tool, addMode: true };
    this.ctx.setStatus(
      tool === 'road'
        ? '道路绘制：左键加地块；拖端点 · Esc 退出'
        : '绘制会话：左键笔刷，Shift 移除，Esc 退出',
    );
  }

  /** 高度绘制会话：整数场 + 12 工作区间 */
  startHeightDraw(intervalId?: string): void {
    // 笔刷目标元素 = 选中态（工作区黄框，与图层面板选中语义一致）
    this.ctx.selectedRegionId = intervalId ?? this.heightIntervalId ?? null;
    this.heightIntervalId = intervalId ?? this.heightIntervalId ?? 'h6';
    this.ctx.draw = {
      ...emptyDrawSession(),
      active: true,
      targetRegionId: `__height__:${this.heightIntervalId}`,
      tool: 'brush',
      addMode: true,
    };
    const iv = intervalById(this.heightIntervalId);
    this.ctx.setStatus(
      `高度绘制 · ${iv?.name ?? ''} ${this.heightPaintValue ?? iv?.min ?? 0}：左键刷值 · Shift+左键擦除 · Esc 退出`,
    );
  }

  setHeightInterval(intervalId: string): void {
    this.heightIntervalId = intervalId;
    if (this.ctx.draw.targetRegionId?.startsWith('__height__')) {
      this.ctx.draw = { ...this.ctx.draw, targetRegionId: `__height__:${intervalId}` };
    }
    const iv = intervalById(intervalId);
    this.ctx.setStatus(
      `选定：${iv?.name ?? intervalId}（${iv?.lo} ~ ${iv?.hi}）→ 涂改值 ${this.heightPaintValue}`,
    );
    this.ctx.notify();
  }

  /** 工作区滑块联动：滑动即选定该元素 + 涂改值 = 滑块数字 */
  setHeightPaint(intervalId: string, value: number): void {
    this.heightIntervalId = intervalId;
    this.heightPaintValue = value;
    if (this.ctx.draw.targetRegionId?.startsWith('__height__')) {
      this.ctx.draw = { ...this.ctx.draw, targetRegionId: `__height__:${intervalId}` };
    }
    const iv = intervalById(intervalId);
    this.ctx.setStatus(`涂改值 ${value}（${iv?.name ?? intervalId}）`);
    this.ctx.notify();
  }

  heightIntervals() {
    return HEIGHT_INTERVALS;
  }

  setDrawTool(tool: DrawTool): void {
    this.ctx.draw = { ...this.ctx.draw, tool };
  }

  endDraw(): void {
    if (this.ctx.draw.active) {
      this.ctx.draw = { ...this.ctx.draw, active: false };
      this.ctx.setStatus('已退出绘制会话');
      this.ctx.touchWorld();
    }
  }

  paint(
    lon: number,
    lat: number,
    shift: boolean,
    ctrl = false,
    alt = false,
    button = 0,
  ): number[] | null {
    const world = this.ctx.world;
    if (!world || !this.ctx.draw.active) return null;
    // 笔画开始：在 resolveDrawTarget **之前**拍快照——resolve 可能自动新建元素（行省），
    // 新建也必须进 created 被撤销捕获
    if (!this.paintDirty) this.beginStrokeSnap();
    const resolved = resolveDrawTarget(world, this.ctx.draw);
    if (!resolved) return null;
    if (resolved === 'height') {
      // 擦除 = 右键或 Shift+左键（A′契约画布右键=纯位移，Shift 是可达的擦除手势）
      return this.paintHeight(lon, lat, shift, ctrl, alt, button === 2 || shift ? 'right' : 'left');
    }
    const pointer = button === 2 || shift ? 'right' : 'left';
    const hits = cellsInBrush(world, lon, lat, this.ctx.draw.radiusDeg);
    if (!hits.length) return null;
    if (!this.paintDirty) {
      this.paintDirty = true;
    }
    const lcfg = defaultLayerConfig(resolved.region.layerId);
    const actor: DrawActor = {
      layerId: resolved.region.layerId,
      elementId: resolved.region.id,
      overwrite: (this.ctx.draw.addMode ? 'emptyOnly' : 'replace') as OverwriteMode,
      placement: lcfg.placement,
      splitPolicy: lcfg.splitPolicy,
    };
    // placement 闸 + overwrite + splitPolicy
    const result = membershipDrawStroke(world, actor, {
      cellIds: hits,
      pointer: pointer as 'left' | 'right',
      shift,
      alt,
    });
    if (result.membershipChanges.length) {
      this.ctx.selectedRegionId = resolved.region.id;
      // 每元素增减不再单独采集：commit 走快照-diff（捕获全部副作用，含 replace/split/steal）
    }
    void placementAllows;
    void ctrl;
    return hits;
  }

  /** 高度笔刷：HeightDraw 整数语义 */
  paintHeight(
    lon: number,
    lat: number,
    shift: boolean,
    ctrl = false,
    alt = false,
    pointer: 'left' | 'right' = 'left',
  ): number[] | null {
    void shift;
    void ctrl;
    void alt;
    const world = this.ctx.world;
    if (!world) return null;
    const radius = this.ctx.draw.radiusDeg || 1.2;
    const hits = cellsInBrush(world, lon, lat, radius);
    if (!hits.length) return null;
    if (!this.paintDirty) {
      this.strokeRegionId = '__height__';
      this.paintDirty = true;
      this.heightStroke = [];
      this.heightTouched = new Set();
    }
    // 撤销样本：每个 cell 在**首次触碰**时记录原高（此前只记首批 = 拖涂撤销不完整）
    for (const id of hits) {
      if (!this.heightTouched!.has(id)) {
        this.heightStroke!.push({ id, h: world.cells[id].height });
        this.heightTouched!.add(id);
      }
    }
    // 【v2 语义】笔刷只写「选定值」（擦除 → pointer right → 写 0）；拖动中零重算，只回传命中供色块高亮
    const paintValue = this.heightPaintValue ?? intervalById(this.heightIntervalId)?.min ?? 0;
    setHeightStroke(world, hits, paintValue, pointer === 'right');
    for (const id of hits) {
      const c = world.cells[id];
      if (!c) continue;
      if (c.isOcean) releaseOceanCell(world, c.id);
      else absorbLandCell(world, c.id);
      this.ctx.markHeightDirty([c.id]);
    }
    return hits;
  }

  commitStroke(): void {
    if (this.strokeRegionId === '__height__' && this.heightStroke?.length) {
      const before = this.heightStroke;
      const samples = before.map(({ id, h }) => ({
        id,
        h0: h,
        h1: this.ctx.world!.cells[id].height,
      }));
      const w = this.ctx.world!;
      const dirtyIds = samples.map((s) => s.id);
      // 1-c：命令纯数据（只有 samples+label）；undo/redo 后的失效副作用由
      // historyEffect 按命令类型分发，不再作为闭包存进命令。
      const cmd = new HeightCellsCommand(samples, '高度笔刷');
      history.run(w, cmd, { alreadyApplied: true });
      this.heightStroke = null;
      this.strokeRegionId = null;
      this.strokeSnap = null;
      this.paintDirty = false;
      this.ctx.markHeightDirty(dirtyIds);
      this.ctx.flushHeightRegions(samples);
      const cw = this.ctx.world;
      if (cw) this.ctx.setWorld({ ...cw });
      this.ctx.notify();
      return;
    }
    // 成员笔画提交：快照-diff → 多元素补丁入栈（undo 腐蚀修复：replace/split/steal 副作用一并撤销）
    const dirty = this.commitStrokeDiff('绘制');
    this.strokeRegionId = null;
    this.paintDirty = false;
    // 归属提交：**每个被修改的 Region** 逐件定向失效（多元素副作用的件环同样必须补丁，
    // 「全清/补丁」二选一的不变量在多元素语义下逐件兑现）
    if (dirty.length) {
      this.ctx.touchRegionsIncremental();
      const w2 = this.ctx.world;
      if (w2) {
        for (const id of dirty) {
          const r = w2.regions.find((x) => x.id === id);
          if (r) {
            queuePieceInvalidation(`piece:${r.layerId}:${r.id}:`);
          }
        }
      }
    } else {
      this.ctx.touchRegions();
    }
  }

  /** 笔画开始：全量 Region.cells 引用快照（写入皆 COW 换数组 → 引用比对即得副作用集） */
  private beginStrokeSnap(): void {
    const w = this.ctx.world;
    this.strokeSnap = w ? new Map(w.regions.map((r) => [r.id, r.cells])) : null;
  }

  /**
   * 笔画提交（快照-diff）：捕获本次笔画触碰的**所有** Region——目标、被 replace/steal
   * 剥 cell 的旁者、splitPolicy/自动建新建的元素——→ MultiRegionCommand 入栈。
   * 返回被修改的**已存在** Region id（新建元素无旧缓存条目，只需 touch 不需件失效）。
   */
  private commitStrokeDiff(label: string): string[] {
    const snap = this.strokeSnap;
    this.strokeSnap = null;
    const world = this.ctx.world;
    if (!world || !snap) return [];
    const patches: { id: string; added: number[]; removed: number[] }[] = [];
    const created: { id: string; region: Region }[] = [];
    const modified: string[] = [];
    for (const r of world.regions) {
      const prev = snap.get(r.id);
      if (prev === undefined) {
        created.push({ id: r.id, region: r });
        continue;
      }
      if (prev === r.cells) continue;
      const s0 = new Set(prev);
      const s1 = new Set(r.cells);
      const added = r.cells.filter((c) => !s0.has(c));
      const removed = [...s0].filter((c) => !s1.has(c));
      if (added.length || removed.length) {
        patches.push({ id: r.id, added, removed });
        modified.push(r.id);
      }
    }
    if (patches.length || created.length) {
      history.run(world, new MultiRegionCommand({ patches, created }, label), {
        alreadyApplied: true,
      });
    }
    return modified;
  }

  flood(cellId: number): void {
    const world = this.ctx.world;
    if (!world || !this.ctx.draw.active) return;
    // 快照-diff（同笔画机制）：resolve 可能自动建元素、steal 会剥同层旁者——全部入补丁
    this.beginStrokeSnap();
    const resolved = resolveDrawTarget(world, this.ctx.draw);
    if (!resolved || resolved === 'height') {
      this.strokeSnap = null;
      return;
    }
    const hits = floodFillCells(world, cellId, true);
    addCellsToRegion(resolved.region, hits);
    stealFromSiblings(world, resolved.region, hits);
    this.commitStrokeDiff('填充');
    this.ctx.touchWorld();
    this.ctx.setStatus(`洪水填充 ${hits.length} 地块`);
  }

  setCenterAt(cellId: number): void {
    const world = this.ctx.world;
    if (!world || !this.ctx.selectedRegionId) return;
    history.run(world, new SetCenterCommand(this.ctx.selectedRegionId, cellId));
    this.ctx.touchWorld();
    this.ctx.setStatus(`已设中心 → cell #${cellId}`);
  }

  endpoint(cellId: number, lon: number, lat: number, phase: 'start' | 'move' | 'end'): void {
    const world = this.ctx.world;
    if (!world || !this.ctx.draw.active) return;
    const region = world.regions.find((r) => r.id === this.ctx.draw.targetRegionId);
    if (!region) return;
    if (phase === 'start') return;
    if (phase === 'move') {
      const cell = world.cells[cellId];
      if (cell && pointInPolygon(lon, lat, cell.polygon)) {
        dragRoadEndpoint(world, region, cellId, lon, lat, cellId, true);
        // 端点拖动只改 endpointOverrides（regions 域渲染提示）：不炸几何/投影缓存
        this.ctx.touchPaint();
      }
      return;
    }
    const cell = world.cells[cellId];
    const inside = cell ? pointInPolygon(lon, lat, cell.polygon) : false;
    const hit = cellAtPoint(world, lon, lat);
    const result = dragRoadEndpoint(world, region, cellId, lon, lat, hit, inside);
    this.ctx.touchRegions();
    if (result === 'transfer')
      this.ctx.setStatus('端点已拖出：原地块取消道路，目标地块纳入道路');
    else if (result === 'override') this.ctx.setStatus('端点已微调（多边形内）');
  }

  roadSegments() {
    const world = this.ctx.world;
    if (!world || !this.ctx.draw.active || this.ctx.draw.tool !== 'road' || !this.ctx.draw.targetRegionId)
      return [];
    const region = world.regions.find((r) => r.id === this.ctx.draw.targetRegionId);
    if (!region) return [];
    return buildRoadSegments(world, region);
  }

  roadBreaks(): number {
    const world = this.ctx.world;
    if (!world || !this.ctx.draw.targetRegionId) return 0;
    const region = world.regions.find((r) => r.id === this.ctx.draw.targetRegionId);
    if (!region || region.cells.length === 0) return 0;
    return Math.max(0, roadComponentCount(world, region) - 1);
  }
}
