<script lang="ts">
  /**
   * 检查模式展开区（2026-09-30 三模式重构）：图层/元素的详情 + 显示参数，
   * 取代原 ElementInfoPanel / LayerInfoPanel / DisplayStylePanel 三个右键 popover
   * （重复入口已删，展开区 = 唯一驻留信息入口）。
   *
   * 数据直取 editor（Viewport/GlobeView 同款先例）；样式为**层级**属性（元素展开显示其所属层样式）。
   */
  import type { World } from '../../core/types';
  import { LAYER_META } from '../workbench/layerMeta';
  import EntityInfoBody from './EntityInfoBody.svelte';
  import DisplayStylePanel from './DisplayStylePanel.svelte';
  import StateCapsule from './StateCapsule.svelte';
  import { editor } from '../../app/store.svelte';
  import { defaultLayerVisible } from '../../core/displayCompose';
  import { exactCountOfInterval } from '../../core/layer/heightElements';
  import { childLayerIdOf } from '../../core/hierarchy/derive';
  import { bestParentFor } from '../../core/hierarchy/ops';
  
  let {
    world,
    kind,
    id,
  }: {
    world: World | null;
    kind: 'layer' | 'element';
    /** layerId（kind=layer）或 regionId（kind=element）；null/空 = 不渲染 */
    id: string | null;
  } = $props();

  const catLabel = (c: string) =>
    c === 'cell' ? '依赖地块' : c === 'free' ? '不依赖地块' : '自定义';

  /** 邻接（纯函数版：显式传 world，避免闭包同引用截断） */
  function neighborsOfWorld(w: World | null, reg: { id: string; cells: number[] }): { id: string; name: string; color: string }[] {
    if (!w?.sharedEdges) return [];
    const own = new Set(reg.cells);
    const ownerOfCell = new Map<number, string>();
    for (const r of w.regions) {
      for (const c of r.cells) if (!ownerOfCell.has(c)) ownerOfCell.set(c, r.id);
    }
    const hit = new Set<string>();
    for (const [key] of w.sharedEdges) {
      const [i, j] = key.split('-').map(Number);
      const aIn = own.has(i);
      const bIn = own.has(j);
      if (aIn === bIn) continue;
      const otherId = ownerOfCell.get(aIn ? j : i);
      if (otherId && otherId !== reg.id) hit.add(otherId);
    }
    return [...hit].slice(0, 20).map((xid) => {
      const r = w.regions.find((x) => x.id === xid)!;
      return { id: xid, name: r?.name ?? xid, color: r?.color ?? '#666' };
    });
  }

  /**
   * 展示快照（2026-10-01 根因修复）：`worldRaw = $state.raw`（无深代理）→ 模板/派生对
   * 普通对象属性（layer.visible / region.hidden / name / …）的读取**不被追踪**；中间派生
   * 输出同引用还会把失效信号截断（world 身份换了也白换）→ 眼睛标签等「数据翻了、界面不跟」。
   * 修法：所有展示值收敛到本快照——依赖 `rev`（每次 touch* notify 必 +1）与 `world` 身份，
   * 输出**全新对象** → 下游模板/props 必然重算刷新。新增展示字段一律进这里，禁止在模板里
   * 直读 world/region/layer 的可变属性。
   */
  const rev = $derived(editor.rev);
  const view = $derived.by(() => {
    void rev;
    const r = kind === 'element' && id && world ? (world.regions.find((x) => x.id === id) ?? null) : null;
    const l = kind === 'layer' && id && world ? (world.layers.find((x) => x.id === id) ?? null) : null;
    const meta = kind === 'layer' ? (LAYER_META[id ?? ''] ?? null) : null;
    const a = r?.attributes;
    // 元素基本色 = 自身渲染色（2026-10-04：子元素改为父色同系微调后，父色≠自色，
    // 面板必须显示地图上真实画的颜色；仍然禁止单独改——色随生成/挂靠策略走）
    const basic = r ? r.color : '#888888';
    const heightIv =
      r && a && a.kind === 'interval'
        ? {
            lo: typeof a.lo === 'number' ? a.lo : 0,
            hi: typeof a.hi === 'number' ? a.hi : 1,
            min: typeof a.min === 'number' ? a.min : (typeof a.lo === 'number' ? a.lo : 0),
          }
        : null;
    const styleId = r ? (r.layerId ?? '') : (id ?? '');
    // 层级导航（HIERARCHY §6.4，包4）：子元素 = 子图层中 parentId=本元素（快照取 id/name，
    // 模板禁读活引用）；挂靠入口 = 孤儿且父层有元素（D4 手动，打分单源 ops.bestParentFor）
    const childLid = r && world ? childLayerIdOf(world, r.layerId) : null;
    const childItems =
      r && childLid && world
        ? world.regions
            .filter((x) => x.layerId === childLid && x.parents?.includes(r.id))
            .map((x) => ({ id: x.id, name: x.name }))
        : [];
    const attach = r && world ? bestParentFor(world, r.id) : null;
    // 核心格入口（LABEL_DESIGN 包3 R16）：只有「要求核心」的层才显示（首府/省会/中心）

    return {
      regionId: r?.id ?? null,
      layerId: l?.id ?? null,
      hidden: r ? !!r.hidden : null,
      layerVisible: l ? !!(l.visible ?? defaultLayerVisible(l)) : null,
      name: r ? r.name : l ? l.name || meta?.name || id || '' : '',
      basicColor: basic,
      basicEditable: r ? !r.parents?.length : true,
      cellCount: r && world
        ? exactCountOfInterval(world, r) // 区间型=精确档现算（累积 cells.length 非精确档，2026-10-06 包 B）
        : l && world
          ? world.regions.filter((x) => x.layerId === id).length
          : 0,
      description: r ? ((a?.description as string) ?? '') : meta ? `${meta.emoji} ${meta.kind}` : '',
      // 子元素行已删（2026-10-01 拍板：子元素相关功能之后重新设计）
      extra: r
        ? [{ label: 'ID', value: r.id, detail: true }]
        : l
          ? [
              {
                label: '子层',
                value: String(world ? world.layers.filter((x) => x.displayParent === id).length : 0),
              },
              { label: '分类', value: catLabel(meta?.category ?? 'custom'), detail: true },
              { label: 'ID', value: id ?? '', detail: true },
            ]
          : [],
      neighbors: r && world ? neighborsOfWorld(world, r) : [],
      heightIv,
      styleId,
      styleName: world?.layers.find((x) => x.id === styleId)?.name ?? styleId,
      styleCfg: styleId ? editor.layerStyleConfig(styleId) : null,
      parentId: r?.parents?.[0] ?? null,
      parents: r && world
        ? (r.parents ?? []).map((pid) => ({
            id: pid,
            name: world.regions.find((x) => x.id === pid)?.name ?? pid,
          }))
        : [],
      parentName: r?.parents?.length
        ? (world?.regions.find((x) => x.id === r.parents![0])?.name ?? r.parents![0])
        : null,
      childItems,
      childLayerId: childLid,
      attachTo: attach ? { id: attach.id, name: attach.name } : null,
    };
  });

  function saveElement(patch: {
    name?: string;
    color?: string;
    description?: string;
  }) {
    if (!view.regionId || !world) return;
    const rid = view.regionId;
    // 1-b：经字段快照执行器入栈（改名/描述/颜色可撤销）
    editor.patchRegions('保存信息', () => {
      const reg = world.regions.find((x) => x.id === rid);
      if (!reg) return;
      if (patch.name) reg.name = patch.name;
      if (patch.color && !reg.parents?.length) reg.color = patch.color;
      if (patch.description !== undefined)
        reg.attributes = { ...reg.attributes, description: patch.description };
    });
    editor.status = '已保存（Ctrl+Z 可撤销）';
  }

  /** 隶属跳转（2026-10-02 D8 拍板）：聚焦父层 + 选中父元素——父子导航第一跳 */
  function jumpParentTo(pid: string) {
    const p = world ? world.regions.find((x) => x.id === pid) : null;
    if (!p) return;
    editor.selectLayerTop(p.layerId);
    editor.selectedRegionId = p.id;
    editor.status = `跳转「${p.name}」`;
    editor.notify();
  }

  /** 子元素逐个跳转（O1 反向，包4）：重复点击按序轮换子图层元素 */
  let childCursor = 0;
  function jumpChild() {
    const kids = view.childItems;
    const lid = view.childLayerId;
    if (!kids.length || !lid) return;
    const k = kids[childCursor % kids.length];
    childCursor = (childCursor + 1) % kids.length;
    editor.selectLayerTop(lid);
    editor.selectedRegionId = k.id;
    editor.status = `跳转子元素「${k.name}」(${childCursor || kids.length}/${kids.length})`;
    editor.notify();
  }

  /** 手动挂靠（D4）：孤儿 → 共享邻接最多的父层元素 */
  function attach() {
    const rid = view.regionId;
    if (!rid) return;
    editor.attachElement(rid);
    editor.notify();
  }
</script>

<div class="ins">
  <!-- 状态条（2026-10-02 方案 §4.3；2026-10-04：元素显隐胶囊废除——单体显隐无意义）：
       图层显隐胶囊 · 区间徽章（只读，涂改在绘制） · 隶属/子元素跳转 · 挂靠 -->
  <div class="srow">
    {#if kind === 'layer' && view.layerId}
      <StateCapsule
        size="md"
        onIcon="👁"
        offIcon="🚫"
        onText="显示中"
        offText="已隐藏"
        on={!!view.layerVisible}
        title={view.layerVisible ? '点击隐藏' : '点击显示'}
        onchange={() => editor.toggleLayerVisible(view.layerId!)}
      />
    {/if}
    {#if view.heightIv}
      <span class="ivb">区间 {view.heightIv.lo}–{view.heightIv.hi}</span>
    {/if}
    {#if kind === 'element' && view.parents.length}
      {#if view.parents.length > 1}
        <span class="ivb" title="多归属（争议区）：同时属于多个父元素">多归属 {view.parents.length}</span>
      {/if}
      {#each view.parents as p (p.id)}
        <span class="ownpill">
          <button type="button" class="jump" title="跳转到「{p.name}」" onclick={() => jumpParentTo(p.id)}>
            隶属 {p.name} ›
          </button>
          <button
            type="button"
            class="ownx"
            title="移除该归属（过 Min 闸；空 = 游离）"
            onclick={() => view.regionId && editor.removeParent(view.regionId, p.id)}
          >×</button>
        </span>
      {/each}
    {/if}
    {#if kind === 'element' && view.childItems.length}
      <button
        type="button"
        class="jump"
        title="跳转到子元素（子图层，重复点击逐个轮换）"
        onclick={jumpChild}
      >
        子元素 {view.childItems.length} ›
      </button>
    {/if}
    {#if kind === 'element' && view.attachTo}
      <button
        type="button"
        class="jump attach"
        title="归属到共享邻接最多的目标元素（已达上限则不再出现；撤销可退）"
        onclick={attach}
      >
        归属「{view.attachTo.name}」
      </button>
    {/if}
  </div>
  {#if kind === 'element' && view.regionId}
    <EntityInfoBody
      name={view.name}
      basicColor={view.basicColor}
      basicEditable={view.basicEditable}
      cellCount={view.cellCount}
      countLabel="地块"
      description={view.description}
      neighbors={view.neighbors}
      extra={view.extra}
      onSave={saveElement}
    />
  {:else if kind === 'layer' && view.layerId}
    <EntityInfoBody
      name={view.name}
      basicColor="#6b7c93"
      basicEditable={false}
      cellCount={view.cellCount}
      countLabel="元素"
      showAdjacent={false}
      description={view.description}
      neighbors={[]}
      extra={view.extra}
      onSave={() => {
        editor.status = '图层信息只读（图层名由数据决定）';
        editor.notify();
      }}
    />
  {:else}
    <p class="dim">{kind === 'element' ? '尚未选中元素。' : '尚未聚焦图层。'}</p>
  {/if}

  {#if view.styleId && view.styleCfg}
    <div class="sty">
      <DisplayStylePanel
        embedded
        layerId={view.styleId}
        layerName={view.styleName}
        {world}
        cfg={view.styleCfg}
        onChange={(patch) => editor.setLayerStyle(view.styleId, patch)}
        onDecor={(patch) => editor.setLayerDecor(view.styleId, patch)}
      />
    </div>
  {/if}
</div>

<style>
  .ins {
    font-size: var(--fs-md);
    user-select: none;
  }
  /* 显隐开关（把手语言；第八轮：自行按钮移入） */
  .srow {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    margin: 4px 0 2px;
  }
  /* 区间只读徽章（D2：涂改滑块归绘制模式） */
  .ivb {
    border: 1px solid var(--panel-border);
    border-radius: var(--r-pill);
    padding: 2px 8px;
    font-size: var(--fs-xs);
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .ownpill {
    display: inline-flex;
    align-items: center;
    gap: 2px;
  }
  .ownx {
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: transparent;
    color: inherit;
    border-radius: 6px;
    font-size: 11px;
    line-height: 1;
    padding: 2px 5px;
    cursor: pointer;
    opacity: 0.75;
  }
  .ownx:hover {
    opacity: 1;
    border-color: rgba(255, 120, 120, 0.6);
  }

  /* 隶属跳转胶囊（D8） */
  .jump {
    border: 1px solid var(--panel-border);
    border-radius: var(--r-pill);
    background: rgba(120, 160, 220, 0.14);
    color: var(--text);
    padding: 3px 9px;
    font-size: var(--fs-sm);
    cursor: pointer;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .jump:hover {
    background: rgba(120, 160, 220, 0.28);
  }
  /* 挂靠入口（D4）：暖色调区分导航与写入动作 */
  .jump.attach {
    background: rgba(61, 154, 106, 0.16);
    border-color: rgba(61, 154, 106, 0.45);
  }
  .jump.attach:hover {
    background: rgba(61, 154, 106, 0.3);
  }
  .sty {
    margin-top: 4px;
  }
  .dim {
    margin: 0;
    padding: var(--sp-4);
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }
</style>
