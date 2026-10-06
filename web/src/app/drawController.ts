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
import type { CellId, Region, World } from '../core/types';
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
import { defaultLayerConfig } from '../core/layer/config';
import { HEIGHT_INTERVALS, intervalById } from '../core/layer/heightIntervals';
import { setHeightStroke, smoothHeightBrush } from '../core/draw/heightDraw';
import { writeSelfCells } from '../core/occupy';
import { backPropSourcesOf } from '../core/hierarchy/derive';
import { buildRoadSegments, dragRoadEndpoint } from '../core/draw/roads';
import {
  HeightCellsCommand,
  MultiRegionCommand,
  history,
} from '../core/history';
import { queuePieceInvalidation } from '../render/patchQueues';
import { getRegionIndex } from '../core/index/regionIndex';
import { childLayerIdOf } from '../core/hierarchy/derive';
import { addParentElement } from '../core/hierarchy/ops';

/** 笔刷一次落点的结果：hits=半径内全部格；changed=**将要改变归属**的格（高亮预告用） */
export interface PaintResult {
  hits: number[];
  changed: number[];
}

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
  flushHeightRegions(samples?: { id: number; h0: number; h1: number }[]): void;
}

export class DrawController {
  private paintDirty = false;
  private strokeRegionId: string | null = null;
  /** 笔画前快照：regionId → cells 数组引用（写入全为 COW 换数组 → 引用比对即得副作用集） */
  private strokeSnap: Map<string, number[]> | null = null;
  /** 笔画内的换父翻转（父笔刷收编）：id → {before, after}，随笔画一条命令撤销 */
  private strokeParentFlips: Map<string, { before: string[] | undefined; after: string[] | undefined }> | null = null;
  /** 自持快照（E3）：元素 id → selfCells 引用（含原本 undefined） */
  private strokeSelfSnap: Map<string, CellId[] | undefined> | null = null;
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
    // 笔刷半径 = 用户偏好，**跨会话保留**（emptyDrawSession 的 1.5 只是出厂默认）：
    // 曾每次 startDraw 都重置 → 换目标/重进会话后半径跳回 1.5（用户反馈「重绘过后变默认」）
    this.ctx.draw = {
      ...emptyDrawSession(),
      active: true,
      targetRegionId: regionId,
      tool,
      addMode: true,
      radiusDeg: this.ctx.draw.radiusDeg,
    };
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
      radiusDeg: this.ctx.draw.radiusDeg,
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
      // 退出会话是**纯 UI 态**：不改任何几何/归属 → 只换身份触发重绘。
      // 曾调 touchWorld（bumpAllRev → geomRev++ → 全部件环缓存换键 = 数百毫秒重建闪屏），
      // 即「结束绘制整个界面重绘一下」的根因（2026-10-04 实测 endDraw → 件环重建 4 件/67ms）。
      this.ctx.notify();
    }
  }

  paint(
    lon: number,
    lat: number,
    shift: boolean,
    ctrl = false,
    alt = false,
    button = 0,
  ): PaintResult | null {
    const world = this.ctx.world;
    if (!world || !this.ctx.draw.active) return null;
    // 笔画开始：在 resolveDrawTarget **之前**拍快照——resolve 可能自动新建元素（行省），
    // 新建也必须进 created 被撤销捕获
    if (!this.paintDirty) this.beginStrokeSnap();
    const resolved = resolveDrawTarget(world, this.ctx.draw);
    if (!resolved) return null;
    if (resolved === 'height') {
      // 擦除 = 右键或 Shift+左键（A′契约画布右键=纯位移，Shift 是可达的擦除手势）
      const hits = this.paintHeight(lon, lat, shift, ctrl, alt, button === 2 || shift ? 'right' : 'left');
      // 高度涂改没有「换归属」，但笔刷命中的格都会变值 → 一并作为高亮预告
      return hits ? { hits, changed: hits } : null;
    }
    const pointer = button === 2 || shift ? 'right' : 'left';
    const hits = cellsInBrush(world, lon, lat, this.ctx.draw.radiusDeg);
    if (!hits.length) return null;
    if (!this.paintDirty) {
      this.paintDirty = true;
    }
    // ── E3 自持（2026-10-06，Alt = 直接持有）：写聚合目标的 selfCells（不经父笔刷子路由）。
    //    手势：Alt+左键 = 加自持；Shift+Alt+左键 = 擦自持（右键=内容平移，A′契约）。
    //    非聚合目标层（叶子元素）的 Alt 与普通绘制同效（cells 本就是自持）。
    if (alt) {
      const direct = resolved.parent ?? resolved.region;
      if (backPropSourcesOf(world, direct.layerId).length) {
        return this.paintSelfCells(world, direct, hits, pointer === 'right');
      }
    }
    // ── 父笔刷命中子元素（2026-10-04 用户需求）：加笔时——
    // ① 命中的子元素若不在本父之下（孤儿/他国）→ **纳入**本父（闸复核；flip 随笔画一条命令撤销）；
    //    闸拒绝的不纳入、也不作目标（不画到别人家的元素里）。
    // ② 笔画目标切到命中最多的那个子元素（**已纳入或本就是本父之子**）→
    //    `draw.parentRegionId` 指向它 = 地图金框高亮，且后续笔画直接画进它
    //    （resolve 下一拍经 parentRegionId 稳定命中）。
    // **不改 selectedRegionId**：C1 不变量 = 会话目标恒等于选中元素（纯推导），
    // 绘制中改选中会让 App 推导 effect 判定「换目标」→ endDraw+startDraw 会话重启
    // （重绘 + 笔刷半径被打回默认，2026-10-04 用户反馈的根因之一）；高亮归 parentRegionId。
    let target: { region: Region; parent?: Region } = resolved;
    // 「将要改变归属的格」预判（用户 2026-10-04：绘制时按下即高亮**即将归属新元素**的格）：
    //  - 移除（右键/Shift）：高亮将被摘除的（属本元素的）格
    //  - 加·只填空白（addMode）：高亮本层**无主**、将被纳入的格（已属本元素的不动 = 无变化不高亮）
    //  - 加·抢占（!addMode = replace）：高亮所有不属于本元素、将被抢/纳入的格
    const targetSet = new Set(resolved.region.cells);
    const preChanged: number[] = [];
    if (pointer === 'right') {
      for (const id of hits) if (targetSet.has(id)) preChanged.push(id);
    } else if (this.ctx.draw.addMode) {
      const idx = getRegionIndex(world);
      const lid = resolved.region.layerId;
      for (const id of hits) if (!idx.owners(world, lid, id).length) preChanged.push(id);
    } else {
      for (const id of hits) if (!targetSet.has(id)) preChanged.push(id);
    }
    const changed = new Set(preChanged);
    if (pointer === 'left' && target.parent) {
      const parent = target.parent;
      const childLayerId = childLayerIdOf(world, parent.layerId);
      if (childLayerId) {
        const idx = getRegionIndex(world);
        const hitCount = new Map<string, number>();
        for (const c of hits) {
          for (const oid of idx.owners(world, childLayerId, c)) {
            if (oid === target.region.id) continue;
            hitCount.set(oid, (hitCount.get(oid) ?? 0) + 1);
          }
        }
        if (hitCount.size) {
          const byId = new Map(world.regions.map((r) => [r.id, r]));
          const order = [...hitCount.entries()].sort((a, b) => b[1] - a[1]);
          let primary: Region | undefined;
          for (const [oid] of order) {
            const o = byId.get(oid);
            if (!o) continue;
            if (!o.parents?.includes(parent.id)) {
              const before = o.parents;
              if (addParentElement(world, oid, parent.id)) continue; // 闸拒绝（环/桥/Max）
              (this.strokeParentFlips ??= new Map()).set(oid, { before, after: [parent.id] });
              // 换父 = 该子元素的全部地块「即将归属新元素」→ 全部纳入高亮预告
              const child = byId.get(oid);
              if (child) for (const c of child.cells) changed.add(c);
            }
            primary ??= o;
          }
          if (primary) {
            target = { region: primary, parent };
            this.ctx.draw = { ...this.ctx.draw, parentRegionId: primary.id };
          }
        }
      }
    }
    // 父会话里高亮恒指向**正在被画的那个子元素**（resolve 选中的若非已登记，登记之）——
    // 否则「刷到没子元素覆盖的格子」时金框停在父元素上，与实际被画对象不一致。
    if (target.parent && this.ctx.draw.parentRegionId !== target.region.id) {
      this.ctx.draw = { ...this.ctx.draw, parentRegionId: target.region.id };
    }
    const lcfg = defaultLayerConfig(target.region.layerId);
    const actor: DrawActor = {
      layerId: target.region.layerId,
      elementId: target.region.id,
      overwrite: (this.ctx.draw.addMode ? 'emptyOnly' : 'replace') as OverwriteMode,
      placement: lcfg.placement,
    };
    // placement 闸 + overwrite（splitPolicy 词汇已于包 D 删除）
    // **不因笔画改选中**（C1 不变量：会话目标 ≡ 选中元素）：父会话里被画的是**子**元素，
    // 曾把 selectedRegionId 改成子 → 推导 effect 判「换目标」→ endDraw+startDraw 会话重启
    // （闪屏 + 笔刷半径回默认）。副作用采集在 commit 走快照-diff（含 replace/split/steal）。
    membershipDrawStroke(world, actor, {
      cellIds: hits,
      pointer: pointer as 'left' | 'right',
      shift,
      alt,
    });
    return { hits, changed: [...changed] };
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
    // 【v2 语义】笔刷只写「选定值」（擦除 → pointer right → 写 0）；拖动中零重算，只回传命中供色块高亮。
    // 平滑模式（2026-10-06 拍板 2a/3）：左键 = 同侧图拉普拉斯抹台阶（强度=迭代 1/3/5、护岸开关）；
    // 右键仍=擦除写 0。快照已按首触收集 → commitStroke 的 samples 自动含平滑变更。
    const draw = this.ctx.draw;
    if ((draw.heightMode ?? 'paint') === 'smooth' && pointer === 'left') {
      smoothHeightBrush(world, hits, draw.smoothIter ?? 3, draw.smoothCoast ?? true);
    } else {
      const paintValue = this.heightPaintValue ?? intervalById(this.heightIntervalId)?.min ?? 0;
      setHeightStroke(world, hits, paintValue, pointer === 'right');
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
      // 1-c：命令纯数据（只有 samples+label）；undo/redo 后的失效副作用由
      // historyEffect 按命令类型分发，不再作为闭包存进命令。
      const cmd = new HeightCellsCommand(samples, '高度笔刷');
      history.run(w, cmd, { alreadyApplied: true });
      this.heightStroke = null;
      this.strokeRegionId = null;
      this.strokeSnap = null;
      this.paintDirty = false;
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

  /** 直接持有笔画（E3）：写聚合目标 selfCells 并局部重算 cells（经 occupy.writeSelfCells 单源）。
   *  返回 changed = 真正改变的格（高亮预告同语义）。 */
  private paintSelfCells(world: World, region: Region, hits: number[], erase: boolean): PaintResult {
    const set = new Set(region.selfCells ?? []);
    const changed: number[] = [];
    for (const id of hits) {
      if (erase) {
        if (set.delete(id)) changed.push(id);
      } else if (!set.has(id)) {
        set.add(id);
        changed.push(id);
      }
    }
    if (changed.length) {
      writeSelfCells(world, region, [...set], 'paint', {
        delta: erase ? { added: [], removed: changed } : { added: changed, removed: [] },
      });
    }
    return { hits, changed };
  }

  /** 笔画开始：全量 Region.cells + selfCells 引用快照（写入皆 COW 换数组 → 引用比对即得副作用集） */
  private beginStrokeSnap(): void {
    const w = this.ctx.world;
    this.strokeSnap = w ? new Map(w.regions.map((r) => [r.id, r.cells])) : null;
    this.strokeSelfSnap = w ? new Map(w.regions.map((r) => [r.id, r.selfCells])) : null;
    this.strokeParentFlips = new Map();
  }

  /**
   * 笔画提交（快照-diff）：捕获本次笔画触碰的**所有** Region——目标、被 replace/steal
   * 剥 cell 的旁者、自动建新建的元素——→ MultiRegionCommand 入栈。
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
    const parentFlips = [...(this.strokeParentFlips ?? [])].map(([id, v]) => ({
      id,
      before: v.before,
      after: v.after,
    }));
    this.strokeParentFlips = null;
    // 自持笔画（E3）：selfCells 引用变化入栈（patches 只管 cells——selfCells 不恢复 =
    // undo 后自持长回来；key 存在即比对，值可为 undefined=原本无自持）
    const selfCellsFlips: { id: string; before: CellId[] | undefined; after: CellId[] | undefined }[] = [];
    const selfSnap = this.strokeSelfSnap;
    this.strokeSelfSnap = null;
    if (selfSnap) {
      for (const [id, b4] of selfSnap) {
        const r = world.regions.find((x) => x.id === id);
        if (r && r.selfCells !== b4) selfCellsFlips.push({ id, before: b4, after: r.selfCells });
      }
    }
    if (patches.length || created.length || parentFlips.length || selfCellsFlips.length) {
      history.run(
        world,
        new MultiRegionCommand({ patches, created, parentFlips, selfCellsFlips }, label),
        { alreadyApplied: true },
      );
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
      this.strokeParentFlips = null;
      return;
    }
    const hits = floodFillCells(world, cellId, true);
    addCellsToRegion(resolved.region, hits);
    stealFromSiblings(world, resolved.region, hits);
    this.commitStrokeDiff('填充');
    this.ctx.touchWorld();
    this.ctx.setStatus(`洪水填充 ${hits.length} 地块`);
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


}
