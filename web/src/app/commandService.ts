/**
 * CommandService（还债步骤 5-b5，2026-10-01）：命令 CRUD 与历史门面从 store 出库——
 * undo/redo+类型分发、删除/复制/吞并、图层树缩进·提升·移序、样式·显隐·透明度、
 * 路径快照执行器与拖动会话、字段快照执行器、新建·重命名·换色。
 * 方法体自 store **原样搬运**（this.* 走下方代理），$state 写仍留 store 闭包。
 * 选中/聚焦等 UI 态选择留在 store（selectLayerTop 等，App 直连）。
 */
import type { CellId, CellMark, LayerDecorPatch, Region, World } from '../core/types';
import { defaultPathColor } from '../core/paths';
import { ensureBuiltinLayers } from '../core/world';
import { emptyDrawSession, type DrawSession } from '../core/draw/brush';
import { siblingRegions } from '../core/hierarchy/derive';
import { moveAmongSiblings } from '../core/hierarchy/ops';
import {
  patchElementStyle,
  clampElementStyle,
  type ElementStyle,
  type ElementStylePatch,
} from '../core/layer/style';
import { resolveLayerStyle } from '../core/layer/config';
import { styleById } from '../core/styles';
import { defaultFocusLayerId } from '../core/layer/flags';
import { layerTreeOf } from '../core/hierarchy/derive';
import { planIndent, planPromote, layerCopyAsRoot, bestParentFor, reparentElement } from '../core/hierarchy/ops';
import { tintOf } from '../core/layer/palette';
import {
  defaultLayerVisible,
  isFreeLayer as isFreeLayerDef,
  materializeParentCells,
  visibleColorRoots,
} from '../core/displayCompose';
import {
  AddLayerCommand,
  AnnexCommand,
  CompositeCommand,
  CreateRegionCommand,
  DeleteLayerCommand,
  DeleteRegionCommand,
  HeightCellsCommand,
  CellMarksCommand,
  LayerFieldsCommand,
  LayerStyleCommand,
  LayersOrderCommand,
  LayersVisibilityCommand,
  PathsCommand,
  RegionFieldsCommand,
  RegionsOrderCommand,
  type EditCommand,
  history,
} from '../core/history';

/** store 注入的宿主能力（方法体内的 this.* 经下方代理映射到此） */
export interface CommandCtx {
  readonly world: World | null;
  /** 当前视图风格 id（层样式解析的视图层入参；面板显示**生效值**用） */
  readonly styleId: string;
  get selectedRegionId(): string | null;
  set selectedRegionId(v: string | null);
  get focusLayer(): string;
  set focusLayer(v: string);
  get newName(): string;
  set newName(v: string);
  get annexPick(): boolean;
  set annexPick(v: boolean);
  get draw(): DrawSession;
  set draw(v: DrawSession);
  setStatus(v: string): void;
  notify(): void;
  randomName(kind: string): string;
  touchWorld(): void;
  touchRegions(): void;
  touchLayerView(): void;
  touchHeight(): void;
  flushHeightRegions(samples?: { id: number; h0: number; h1: number }[]): void;
}

export class CommandService {
  constructor(private ctx: CommandCtx) {}

  // —— this.* → Ctx 代理（方法体原样搬运的桥）——
  private get world() {
    return this.ctx.world;
  }
  private get status() {
    return '';
  }
  private set status(v: string) {
    this.ctx.setStatus(v);
  }
  private get selectedRegionId() {
    return this.ctx.selectedRegionId;
  }
  private set selectedRegionId(v: string | null) {
    this.ctx.selectedRegionId = v;
  }
  private get focusLayer() {
    return this.ctx.focusLayer;
  }
  private set focusLayer(v: string) {
    this.ctx.focusLayer = v;
  }
  private get newName() {
    return this.ctx.newName;
  }
  private set newName(v: string) {
    this.ctx.newName = v;
  }
  private get annexPick() {
    return this.ctx.annexPick;
  }
  private set annexPick(v: boolean) {
    this.ctx.annexPick = v;
  }
  private get draw() {
    return this.ctx.draw;
  }
  private set draw(v: DrawSession) {
    this.ctx.draw = v;
  }
  private notify(): void {
    this.ctx.notify();
  }
  private randomName(kind: string): string {
    return this.ctx.randomName(kind);
  }
  private touchWorld(): void {
    this.ctx.touchWorld();
  }
  private touchRegions(): void {
    this.ctx.touchRegions();
  }
  private touchLayerView(): void {
    this.ctx.touchLayerView();
  }
  private touchHeight(): void {
    this.ctx.touchHeight();
  }
  private flushHeightRegions(samples?: { id: number; h0: number; h1: number }[]): void {
    this.ctx.flushHeightRegions(samples);
  }

  undo() {
    if (!this.world) return;
    const cmd = history.undo(this.world);
    if (cmd) {
      this.historyEffect(cmd, 'revert');
      // 撤销后父层并集重派生（步骤7：父 cells=子并集，touchWorld 不物化 → 父残留）
      materializeParentCells(this.world);
      this.touchWorld();
      // 不清空选中：多步撤销时保持上下文
      this.status = `已撤销（剩余 ${history.depth} 步可撤销）`;
    } else this.status = '没有可撤销的操作';
  }

  redo() {
    if (!this.world) return;
    const cmd = history.redo(this.world);
    if (cmd) {
      this.historyEffect(cmd, 'apply');
      materializeParentCells(this.world);
      this.touchWorld();
      this.status = '已重做';
    }
  }

  /**
   * 1-c 命令纯数据化的副作用分发：undo/redo 后按**命令类型**执行增量失效/派生
   * （原 HeightStrokeCommand 闭包 afterApply/afterRevert 的去处——命令本体只持数据，
   * 失效管线归 store）。高度笔画必须走 flushHeightRegions：区间归属是
   * 派生数据，数据回滚后不重算 = 归属过期（不只是显示问题）。
   */
  private historyEffect(cmd: EditCommand, dir: 'apply' | 'revert'): void {
    if (!(cmd instanceof HeightCellsCommand)) return;
    const samples = cmd.samples;
    if (!samples.length) return;
    if (dir === 'apply') {
      this.flushHeightRegions(samples);
      this.touchHeight();
    } else {
      this.flushHeightRegions(samples.map((s) => ({ id: s.id, h0: s.h1, h1: s.h0 })));
      this.touchHeight();
    }
  }

  deleteSelected() {
    if (!this.world || !this.selectedRegionId) return;
    // 先试路径
    const pathIdx = (this.world.paths ?? []).findIndex((p) => p.id === this.selectedRegionId);
    if (pathIdx >= 0 && this.world.paths) {
      this.withPaths('删除路径', () => {
        this.world!.paths = this.world!.paths!.filter((p) => p.id !== this.selectedRegionId);
      });
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

  /**
   * 图层显示列表（组织模式用，**与 LayersPanel 渲染同序**）：根在前、子递归，
   * 兄弟取 layers 数组出现序 = 面板自上而下。
   * 第十一轮修正（2026-09-30）：旧 visualItems 对图层也 reverse（顶=数组末），
   * 与图层面板（顶=数组首）相反 → 「视觉上一个」取成了下一行，缩进/提升锚点错位、顺序乱。
   * 图层显示 = 数组前序 DFS（父必在子前、同级保持数组序）——这是本方法与
   * indent/unindent「只改 parent、不动数组序」推理的不变量。
   * O2（2026-10-03）：walk 收编 core/layer/tree 单源，本方法只做形状适配。
   */
  private layerDisplayList(): { id: string; parentId: string | undefined }[] {
    return layerTreeOf(this.world).map((r) => ({
      id: r.id,
      parentId: r.parentId ?? undefined,
    }));
  }

  /**
   * 缩进（组织模式 · 图层，2026-10-01 语义 v2 用户定稿）：
   * 目标 = **面板中的视觉上一行**——它要么就是上一个同级（对方无子 → 成为其子），
   * 要么就是上一个同级子树的链尾（对方有子 → 沿子下钻直到"没有子元素的父元素"，
   * 视觉上一行按构造必为叶子父）。
   * 「只触发一次关系计算」：一次 layerDisplayList + 一次 parentLayerId 写 +
   * 单条 LayerFieldsCommand；**数组序不动**（前序不变量保证位置零漂移、叠放零影响）。
   * 元素树的缩进已随按钮退役，本方法只服务图层。
   */
  indentItem(id: string, anchorId: string | null = null): void {
    const w = this.world;
    if (!w) return;
    // D3 同源（2026-10-03 包1）：锚点 = 面板按**过滤后视觉行**给出（与按钮禁用态
    // 同一来源），不再在服务端用全表行另算一份；闸复核链约束。
    const res = planIndent(w, id, anchorId);
    if (!res.ok) {
      this.status = res.status;
      return;
    }
    const { plan } = res;
    w.layers.find((x) => x.id === plan.id)!.parentLayerId = plan.after;
    // ④（2026-10-04 用户定）：缩进成子层 → 本层元素按**所属父元素**同色系微调
    // （palette.tintOf，与生成聚合同规则）；与 parentLayerId 同一条 Composite 入栈。
    const colorPatches: { id: string; before: Partial<Region>; after: Partial<Region> }[] = [];
    let ti = 0;
    for (const r of w.regions) {
      if (r.layerId !== plan.id || !r.parentId) continue;
      const p = w.regions.find((x) => x.id === r.parentId);
      if (!p) continue;
      const next = tintOf(p.color, ti++);
      if (next !== r.color) {
        colorPatches.push({ id: r.id, before: { color: r.color }, after: { color: next } });
        r.color = next; // alreadyApplied：与 parentLayerId 同步落地，栈内已是新值
      }
    }
    const cmds: EditCommand[] = [
      new LayerFieldsCommand(
        [{ id: plan.id, before: { parentLayerId: plan.before }, after: { parentLayerId: plan.after } }],
        '缩进',
      ),
    ];
    if (colorPatches.length) cmds.push(new RegionFieldsCommand(colorPatches, '缩进配色'));
    history.run(w, cmds.length > 1 ? new CompositeCommand(cmds, '缩进') : cmds[0], {
      alreadyApplied: true,
    });
    this.touchWorld();
    this.status = res.status + (colorPatches.length ? ` · ${colorPatches.length} 个元素随父配色` : '');
  }

  /**
   * 提升（缩进反向 · 图层，2026-10-01 语义 v2 用户定稿）：**一次点击直接到顶层**
   * ——「提升之后若同时还有父元素和同级元素，需要再次提升」= 逐级上溯但结果一次算出：
   * parentLayerId 直接置空（顶层），不做循环逐跳。
   * 原理同缩进：layers 数组保持前序不动，改 parent 后本图层随数组锚点自然排在
   * 原祖先子树之后的顶层位置——叠放序零影响；单条命令一次撤销。
   */
  unindentItem(id: string): void {
    const w = this.world;
    if (!w) return;
    const res = planPromote(w, id);
    if (!res.ok) {
      this.status = res.status;
      return;
    }
    const { plan } = res;
    w.layers.find((x) => x.id === plan.id)!.parentLayerId = plan.after;
    history.run(
      w,
      new LayerFieldsCommand(
        [{ id: plan.id, before: { parentLayerId: plan.before }, after: { parentLayerId: plan.after } }],
        '提升',
      ),
      { alreadyApplied: true },
    );
    this.touchWorld();
    this.status = res.status;
  }

  /**
   * 同父兄弟内上移/下移一层（dir=-1 上移）；图层/元素/路径通用。
   * 1-b：layers/regions 数组序入栈可撤销（paths 序仍为直改——路径编辑剩余）。
   */
  moveItemStep(id: string, dir: -1 | 1) {
    if (!this.world) return;
    const layersB = this.world.layers.map((l) => l.id);
    const regionsB = this.world.regions.map((r) => r.id);
    this.moveItemStepImpl(id, dir);
    if (!this.world) return;
    const layersA = this.world.layers.map((l) => l.id);
    const regionsA = this.world.regions.map((r) => r.id);
    if (layersB.join('') !== layersA.join('')) {
      history.run(this.world, new LayersOrderCommand(layersB, layersA, '调整顺序'), {
        alreadyApplied: true,
      });
    } else if (regionsB.join('') !== regionsA.join('')) {
      history.run(this.world, new RegionsOrderCommand(regionsB, regionsA, '调整顺序'), {
        alreadyApplied: true,
      });
    }
  }

  /**
   * 组织模式四操作（2026-09-30 拖动退役；5-c 自 App 下沉）：上移/下移方向按两面板
   * 既有菜单映射（图层上移=-1、元素上移=+1——两者数组方向相反，各自验证过）。
   * `anchorId`（D3，2026-10-03 包1）= 缩进的**过滤后视觉上一行**，由面板与禁用态
   * 同源给出；不传时 planIndent 按「无锚点」拒绝（首行）。
   */
  organize(action: 'up' | 'down' | 'indent' | 'unindent', id: string, anchorId?: string | null): void {
    const isLayer = this.world?.layers.some((l) => l.id === id) ?? false;
    if (action === 'indent') this.indentItem(id, anchorId ?? null);
    else if (action === 'unindent') this.unindentItem(id);
    else this.moveItemStep(id, action === 'up' ? (isLayer ? -1 : 1) : isLayer ? 1 : -1);
  }

  private moveItemStepImpl(id: string, dir: -1 | 1) {
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
      const nid = same[j].id;
      this.withPaths('调整顺序', () => {
        const arr = this.world!.paths!;
        const ai = arr.findIndex((x) => x.id === id);
        const bi = arr.findIndex((x) => x.id === nid);
        if (ai < 0 || bi < 0) return;
        arr[ai] = same[j];
        arr[bi] = p;
      });
      this.status = dir < 0 ? '已上移一层' : '已下移一层';
    }
  }

  /** 右键菜单：复制一个（元素 = 同层空胞副本；路径 = 点列副本；图层 = 新层副本） */
  copyItem(id: string) {
    if (!this.world) return;
    // 图层
    const layer = this.world.layers.find((l) => l.id === id);
    if (layer) {
      const nid = `custom-${Date.now().toString(36)}`;
      // D5（包1）：副本成根——继承父会造成一父二子违链
      const copy = layerCopyAsRoot(layer, nid);
      // 1-b：复制图层入栈（AddLayerCommand 天然支持整层 add/remove undo）
      history.run(this.world, new AddLayerCommand(copy, '复制图层'));
      this.touchWorld();
      this.focusLayer = nid;
      this.status = '已复制图层（副本在顶层；样式与设置，不含元素）';
      return;
    }
    // 路径
    const p = (this.world.paths ?? []).find((x) => x.id === id);
    if (p && this.world.paths) {
      const nid = `${p.layerId}-${Date.now().toString(36)}`;
      const copy = {
        ...p,
        id: nid,
        name: `${p.name} 副本`,
        points: p.points.map((q) => ({ ...q })),
      };
      this.withPaths('复制路径', () => {
        this.world!.paths!.push(copy);
      });
      this.selectedRegionId = nid;
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
      // 1-b：复制元素入栈（at=原件后一位，列表位置与直插一致）
      history.run(this.world, new CreateRegionCommand(copy, '复制元素', idx + 1));
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
      const layer = this.world.layers.find((l) => l.id === id)!;
      // 1-b：删除图层入栈（层定义+其元素+渲染配置整包恢复；undo 后焦点回落底图层——UI 态不入历史）
      const cmd = new DeleteLayerCommand(layer, this.world);
      cmd.apply(this.world);
      history.run(this.world, cmd, { alreadyApplied: true });
      if (this.focusLayer === id) this.focusLayer = defaultFocusLayerId(this.world);
      this.touchWorld();
      this.status = '已删除图层';
      return;
    }
    this.selectedRegionId = id;
    this.deleteSelected();
  }

  /**
   * 手动挂靠（HIERARCHY D4，包4）：孤儿元素（无父且本层有父层）挂到
   * 共享邻接最多的父层元素——打分单源 ops.bestParentFor；闸复核桥不变量；
   * 一条 RegionFieldsCommand + touchRegions（物化父 cells）。
   */
  attachElement(id: string): void {
    const w = this.world;
    if (!w) return;
    const best = bestParentFor(w, id);
    if (!best) {
      this.status = '无可挂靠的父层元素（本层无父层或已有父）';
      return;
    }
    const el = w.regions.find((r) => r.id === id);
    if (!el) return;
    const before = el.parentId;
    const err = reparentElement(w, id, best.id);
    if (err) {
      this.status = `挂靠失败：${err}`;
      return;
    }
    history.run(
      w,
      new RegionFieldsCommand(
        [{ id, before: { parentId: before }, after: { parentId: best.id } }],
        '挂靠',
      ),
      { alreadyApplied: true },
    );
    this.touchRegions();
    this.status = `已挂靠到「${best.name || best.id}」（Ctrl+Z 可撤销）`;
  }

  /**
   * 设核心格（首府/省会/中心，LABEL_DESIGN R16）：一条 RegionFieldsCommand 入栈可撤销（两形态互斥，顺带清 coreRegionId）。
   * **失效域 = regions**：centerCellId 只影响符号渲染、不动几何——原先 setCenterAt 走
   * touchWorld（bumpAllRev → geomRev++ → 全部件环换键重建）是闪屏根因，接 UI 时一并纠正。
   */
  setCoreCell(regionId: string, cellId: CellId): void {
    const w = this.world;
    if (!w) return;
    const r = w.regions.find((x) => x.id === regionId);
    if (!r) return;
    if (!r.cells.includes(cellId)) {
      this.status = '该格不在元素地块内，未设置核心';
      return;
    }
    if (r.centerCellId === cellId && !r.coreRegionId) {
      this.status = '核心格未变化';
      return;
    }
    const before = { centerCellId: r.centerCellId, coreRegionId: r.coreRegionId };
    // 两形态互斥（选项1）：设地块核心 → 清子元素核心。alreadyApplied 必须**手动写世界**
    r.centerCellId = cellId;
    r.coreRegionId = undefined;
    history.run(
      w,
      new RegionFieldsCommand(
        [{ id: regionId, before, after: { centerCellId: cellId, coreRegionId: undefined } }],
        '设核心格',
      ),
      { alreadyApplied: true },
    );
    this.touchRegions();
    this.status = `已设核心格 → #${cellId}（Ctrl+Z 撤销）`;
  }

  /**
   * 核心第二形态（选项1 · 2026-10-04 用户拍板）：核心 = 某个**子元素**。
   * 闸：必须是本元素的子元素（parentId=regionId，且跨层桥不变量由层树保证）。
   * 两形态互斥：设子元素核心 → 清 centerCellId。地图上点格 → store 找到该格所属子元素后调这里。
   */
  setCoreRegion(regionId: string, coreRegionId: string): void {
    const w = this.world;
    if (!w) return;
    const r = w.regions.find((x) => x.id === regionId);
    const child = w.regions.find((x) => x.id === coreRegionId);
    if (!r || !child) return;
    if (child.parentId !== r.id) {
      this.status = '核心子元素必须是本元素的直接子元素，未设置';
      return;
    }
    if (r.coreRegionId === coreRegionId) {
      this.status = '核心子元素未变化';
      return;
    }
    const before = { centerCellId: r.centerCellId, coreRegionId: r.coreRegionId };
    r.centerCellId = undefined; // alreadyApplied：必须手动写世界
    r.coreRegionId = coreRegionId;
    history.run(
      w,
      new RegionFieldsCommand(
        [{ id: regionId, before, after: { centerCellId: undefined, coreRegionId } }],
        '设核心子元素',
      ),
      { alreadyApplied: true },
    );
    this.touchRegions();
    this.status = `核心设为子元素「${child.name}」（Ctrl+Z 撤销）`;
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

  /** 添加自定义图层（可选名称，与工作区创建同一套 header）——1-b 命令化 */
  addLayer(name?: string) {
    if (!this.world) return;
    const n = this.world.layers.filter((l) => l.id.startsWith('custom-')).length + 1;
    const id = `custom-${Date.now().toString(36)}`;
    const label = (name ?? this.newName)?.trim() || `图层 ${n}`;
    const layer = {
      id,
      name: label,
      kind: 'custom',
      modeDefault: 'edit',
      allowOverlap: true,
      requireAdjacency: false,
      requireCenter: false,
      styleSetId: 'default',
    } as World['layers'][number];
    this.world.layers.push(layer);
    history.run(this.world, new AddLayerCommand(layer), { alreadyApplied: true });
    this.newName = '';
    this.touchWorld();
    this.focusLayer = id;
    this.status = `已添加图层「${label}」（Ctrl+Z 可撤销）`;
  }

  randomLayerName(): string {
    const pool = ['领地', '文明圈', '信仰带', '商路', '军区', '自治区', '遗迹区', '部落域'];
    return pool[Math.floor(Math.random() * pool.length)] + ' ' + (1 + Math.floor(Math.random() * 9));
  }

  /** 图层显示样式（DisplayStyle 面板）：显示**生效值**（含视图级默认覆盖，与地图一致） */
  layerStyleConfig(id: string): ElementStyle {
    return resolveLayerStyle(this.world, id, styleById(this.ctx.styleId));
  }

  /**
   * 地块标记循环（包5 · 特殊地块）：单击格子 = 无 → ★ → ● → ◆ → 无。
   * 整表 before/after 快照一条入栈（CellMarksCommand，alreadyApplied → 手动写世界）；
   * 失效域 touchLayerView（标记只影响装饰渲染）。
   */
  cycleCellMark(cellId: CellId): void {
    const w = this.world;
    if (!w) return;
    const before = (w.cellMarks ?? []).map((m) => ({ ...m }));
    const cur = before.find((m) => m.cellId === cellId);
    const order: ('star' | 'circle' | 'diamond')[] = ['star', 'circle', 'diamond'];
    let after: CellMark[];
    if (!cur) after = [{ cellId, symbol: 'star' }];
    else {
      const i = order.indexOf(cur.symbol);
      const next = i + 1;
      after = next < order.length ? before.map((m) => (m.cellId === cellId ? { ...m, symbol: order[next] } : m)) : before.filter((m) => m.cellId !== cellId);
    }
    w.cellMarks = after.length ? after : undefined; // alreadyApplied：手动写世界
    history.run(w, new CellMarksCommand(before, after), { alreadyApplied: true });
    this.touchLayerView();
    const label = (m?: CellMark) => (!m ? '无' : m.symbol === 'star' ? '★' : m.symbol === 'circle' ? '●' : '◆');
    const still = after.find((m) => m.cellId === cellId);
    this.status = still
      ? `标记 #${cellId} → ${label(still)}（再点同格切换，Ctrl+Z 撤销）`
      : `已清除 #${cellId} 的标记（Ctrl+Z 撤销）`;
  }

  /**
   * 图层注记配置（包5 配置面）：labelMode/档位/字号/门槛/符号 一次性 patch。
   * 一条 LayerFieldsCommand 入栈可撤销（alreadyApplied → **先手动写世界**）；
   * 失效域 = `touchLayerView`（只影响装饰渲染：bumpRegionsRev + 换身份 + notify，
   * 不碰几何/件环——注记配置不改任何 cell 集）。
   */
  setLayerDecor(id: string, patch: LayerDecorPatch): void {
    const w = this.world;
    if (!w) return;
    const l = w.layers.find((x) => x.id === id);
    if (!l) return;
    const before: LayerDecorPatch = {};
    for (const k of Object.keys(patch) as (keyof LayerDecorPatch)[]) {
      (before as Record<string, unknown>)[k] = (l as unknown as Record<string, unknown>)[k];
    }
    Object.assign(l, patch); // alreadyApplied：手动写世界
    history.run(w, new LayerFieldsCommand([{ id, before, after: patch }], '注记设置'), {
      alreadyApplied: true,
    });
    this.touchLayerView();
    this.status = '已更新注记设置（Ctrl+Z 撤销）';
  }

  setLayerStyle(id: string, patch: ElementStylePatch) {
    if (!this.world) return;
    const map = this.world.layerRenderConfig ?? new Map();
    const before = resolveLayerStyle(this.world, id);
    // 只叠局部 patch，不整份回写默认
    const next = clampElementStyle(patchElementStyle(before, patch));
    map.set(id, next);
    this.world.layerRenderConfig = map;
    // 1-b 样式命令化：before/after = 完整样式引用（拖滑块连发会 coalesce 吗——不 coalesce：
    // 样式是离散 undo 步，逐次可撤；高频由 debounce 在 UI 层收敛）
    history.run(this.world, new LayerStyleCommand(id, before, next, '显示参数'), {
      alreadyApplied: true,
    });
    this.touchRegions();
  }

  /** 显示开关：点击图层 box；最多 3 个颜色根树（父+子占 1 名额） */
  toggleLayerVisible(id: string) {
    if (!this.world) return;
    // 1-b 显隐命令化：整批 id→visible 前后快照（3 树连动/父子链都收敛为一条命令）
    const visIds = this.world.layers.map((l) => l.id);
    const visBefore = this.world.layers.map((l) => l.visible);
    const commitVis = () => {
      if (!this.world) return;
      const visAfter = this.world.layers.map((l) => l.visible);
      if (visBefore.some((v, i) => v !== visAfter[i])) {
        history.run(this.world, new LayersVisibilityCommand(visIds, visBefore, visAfter, '显隐'), {
          alreadyApplied: true,
        });
      }
    };
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
          // 父链可能被点亮，保持原状即可（不回滚父，避免误关）——**净变化入栈**（否则撤销缺账）
          commitVis();
          // 父链 visible 已被写 true：必须失效显示缓存/换 world 身份，否则
          // 「眼睛=显示中但地图没画」（2026-10-01 用户反馈的断点）
          this.touchLayerView();
          this.status = '最多同时显示 3 个图层树（父+子占 1 席）';
          this.notify();
          return;
        }
      }
      void roots;
      this.status = `显示「${layer.name || id}」`;
    } else {
      // D8（HIERARCHY 包2，2026-10-03 用户委托按推荐实施）：关 = **只写自身**——
      // 子孙有效隐藏由 I6 读时派生承担，各自 visible 保留；父层再开时子孙回到
      // 原状态（原「关=写穿子树」退役，LayersVisibilityCommand 快照域随之变小）。
      layer.visible = false;
      this.status = `隐藏「${layer.name || id}」`;
    }
    commitVis();
    this.touchLayerView();
  }

  /**
   * 字段快照执行器（1-b）：fn 前后对全部 Region 浅字段（name/color/
   * attributes/hidden）快照 → diff → 单命令入栈。覆盖「core 直改字段」类操作
   * （元素保存信息、外交 attributes 等）；cells 不在此域（成员变更走笔画快照-diff）。
   */
  /** 路径整表快照：**手动平面拷贝**——points 经 $state 深代理，structuredClone 会 DataCloneError（2026-10-01 实测），必须重建纯对象。 */
  static snapPaths(w: World): NonNullable<World['paths']> {
    return (w.paths ?? []).map((p) => ({
      ...p,
      points: (p.points ?? []).map((q) => ({ lon: q.lon, lat: q.lat })),
    }));
  }

  /** 路径快照执行器（1-b）：fn 前后对 world.paths 整表快照 → 有变化才入栈一条 PathsCommand；统一 touch。 */
  withPaths(label: string, fn: () => void): void {
    if (!this.world) return;
    const snap = () => CommandService.snapPaths(this.world!);
    const before = snap();
    fn();
    const after = snap();
    // 写回纯对象：fn 可能把 $state 代理（pathDraft/llAt 链）存进 world——代理会炸
    // structuredClone（autosave Worker）；规范化后 world.paths 恒为平面数据。
    this.world.paths = after;
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      history.run(this.world, new PathsCommand(before, after, label), { alreadyApplied: true });
    }
    this.touchRegions();
  }

  /** 控制点拖动会话（1-b）：pointerdown 快照 / pointerup 提交——移动过程直改不入栈，一次手势一条命令 */
  private pathsDragSnap: NonNullable<World['paths']> | null = null;
  beginPathsDrag(): void {
    if (this.world) this.pathsDragSnap = CommandService.snapPaths(this.world);
  }
  commitPathsDrag(label = '移动控制点'): void {
    if (!this.world || !this.pathsDragSnap) return;
    const before = this.pathsDragSnap;
    this.pathsDragSnap = null;
    const after = CommandService.snapPaths(this.world);
    this.world.paths = after; // 拖动过程中 points 可能含代理引用 → 规范化为平面数据
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      history.run(this.world, new PathsCommand(before, after, label), { alreadyApplied: true });
    }
    this.touchRegions();
  }

  patchRegions(label: string, fn: () => void): void {
    if (!this.world) return;
    const FIELDS = ['name', 'color', 'attributes', 'hidden'] as const;
    type Snap = Record<string, unknown>;
    const snap = () =>
      new Map<string, Snap>(
        this.world!.regions.map((r) => [
          r.id,
          Object.fromEntries(FIELDS.map((f) => [f, r[f]])),
        ]),
      );
    const before = snap();
    fn();
    const after = snap();
    const patches: { id: string; before: Partial<Region>; after: Partial<Region> }[] = [];
    for (const [id, a] of after) {
      const b = before.get(id);
      if (!b) continue;
      if (FIELDS.some((f) => b[f] !== a[f])) {
        patches.push({ id, before: b as Partial<Region>, after: a as Partial<Region> });
      }
    }
    if (patches.length) {
      history.run(this.world, new RegionFieldsCommand(patches, label), { alreadyApplied: true });
    }
    this.touchRegions();
  }

  setLayerOpacity(id: string, opacity: number) {
    if (!this.world) return;
    const layer = this.world.layers.find((l) => l.id === id);
    if (!layer) return;
    layer.opacity = Math.max(0, Math.min(1, opacity));
    this.touchLayerView();
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
    if (isFreeLayerDef(meta)) {
      const name = this.newName.trim() || `${meta.name} ${(this.world.paths?.filter((p) => p.layerId === layerId).length ?? 0) + 1}`;
      if (!this.world.paths) this.world.paths = [];
      const existingEmpty = this.world.paths.find(
        (p) => p.layerId === layerId && (!p.points || p.points.length < 2),
      );
      if (existingEmpty) {
        this.withPaths('重命名路径', () => {
          existingEmpty.name = name;
        });
        this.newName = '';
        this.status = `已重命名「${name}」，在地图上点击绘制`;
        return;
      }
      const nid = `${layerId}-${Date.now().toString(36)}`;
      this.withPaths('新建路径', () => {
        const w = this.world!;
        if (!w.paths) w.paths = [];
        w.paths.push({
          id: nid,
          layerId: layerId as 'road' | 'route' | 'river',
          name,
          points: [],
          color: defaultPathColor(layerId as 'road' | 'route' | 'river'),
          attributes: {},
        });
      });
      const pid = nid;
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
        attributes: {},
      }),
    );
    moveAmongSiblings(this.world, id, null, 'before');
    this.touchRegions();
    this.newName = '';
    this.selectedRegionId = id;
    this.status = `已新增「${name}」`;
  }


}
