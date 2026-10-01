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
  import CapsuleSlider from './CapsuleSlider.svelte';
  import { editor } from '../../app/store.svelte';
  import { defaultLayerVisible } from '../../core/displayCompose';

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
    const basic = !r
      ? '#888888'
      : !r.parentId
        ? r.color
        : (world?.regions.find((x) => x.id === r.parentId)?.color ?? r.color);
    const heightIv =
      r && a && a.kind === 'interval'
        ? {
            lo: typeof a.lo === 'number' ? a.lo : 0,
            hi: typeof a.hi === 'number' ? a.hi : 1,
            min: typeof a.min === 'number' ? a.min : (typeof a.lo === 'number' ? a.lo : 0),
          }
        : null;
    const styleId = r ? (r.layerId ?? '') : (id ?? '');
    return {
      regionId: r?.id ?? null,
      layerId: l?.id ?? null,
      hidden: r ? !!r.hidden : null,
      layerVisible: l ? !!(l.visible ?? defaultLayerVisible(l)) : null,
      name: r ? r.name : l ? l.name || meta?.name || id || '' : '',
      basicColor: basic,
      basicEditable: r ? !r.parentId : true,
      cellCount: r
        ? r.cells.length
        : l && world
          ? world.regions.filter((x) => x.layerId === id).length
          : 0,
      description: r ? ((a?.description as string) ?? '') : meta ? `${meta.emoji} ${meta.kind}` : '',
      extra: r
        ? [
            { label: 'ID', value: r.id },
            {
              label: '子元素',
              value: String(world ? world.regions.filter((x) => x.parentId === r.id).length : 0),
            },
          ]
        : l
          ? [
              { label: '分类', value: catLabel(meta?.category ?? 'custom') },
              { label: 'ID', value: id ?? '' },
              {
                label: '子层',
                value: String(world ? world.layers.filter((x) => x.parentLayerId === id).length : 0),
              },
            ]
          : [],
      neighbors: r && world ? neighborsOfWorld(world, r) : [],
      heightIv,
      styleId,
      styleName: world?.layers.find((x) => x.id === styleId)?.name ?? styleId,
      styleCfg: styleId ? editor.layerStyleConfig(styleId) : null,
      parentId: r?.parentId ?? null,
    };
  });

  /** 每元素涂改值（初始 = 区间 min）；滑块联动 setHeightPaint（第十一轮） */
  const paintValues = $state<Record<string, number>>({});
  function onHeightSlider(rid: string, v: number) {
    paintValues[rid] = v;
    editor.setHeightPaint(rid, v);
  }

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
      if (patch.color && !reg.parentId) reg.color = patch.color;
      if (patch.description !== undefined)
        reg.attributes = { ...reg.attributes, description: patch.description };
    });
    editor.status = '已保存（Ctrl+Z 可撤销）';
  }
</script>

<div class="ins">
  <!-- 显隐开关（第八轮拍板：眼睛从行按钮移入检查模式展开区；临时安置） -->
  {#if kind === 'element' && view.regionId}
    <button type="button" class="vis-toggle" onclick={() => editor.toggleItemHidden(view.regionId!)}>
      {view.hidden ? '🚫 已隐藏 · 点击显示' : '👁 显示中 · 点击隐藏'}
    </button>
  {:else if kind === 'layer' && view.layerId}
    <button type="button" class="vis-toggle" onclick={() => editor.toggleLayerVisible(view.layerId!)}>
      {view.layerVisible ? '👁 图层显示中 · 点击隐藏' : '🚫 图层已隐藏 · 点击显示'}
    </button>
  {/if}
  <!-- 第十一轮：高度（区间）元素展开内容带涂改滑块（不分模式；其他元素永不含高度滑块） -->
  {#if view.regionId && view.heightIv}
    <div class="hsl">
      <span class="hsl-lb">高度</span>
      <CapsuleSlider
        min={view.heightIv.lo}
        max={view.heightIv.hi}
        step={1}
        value={paintValues[view.regionId] ?? view.heightIv.min}
        label="{view.name} 涂改高度"
        width={130}
        onInput={(v) => onHeightSlider(view.regionId!, v)}
      />
    </div>
  {/if}
  {#if kind === 'element' && view.regionId}
    <EntityInfoBody
      name={view.name}
      basicColor={view.basicColor}
      basicEditable={view.basicEditable}
      cellCount={view.cellCount}
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
        cfg={view.styleCfg}
        onChange={(patch) => editor.setLayerStyle(view.styleId, patch)}
      />
    </div>
  {/if}
</div>

<style>
  .ins {
    font-size: 12px;
    user-select: none;
  }
  /* 显隐开关（把手语言；第八轮：自行按钮移入） */
  .vis-toggle {
    display: block;
    width: 100%;
    margin: 6px 0 2px;
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-dim);
    padding: 5px 8px;
    font-size: 11px;
    text-align: left;
    cursor: pointer;
  }
  .vis-toggle:hover {
    background: rgba(255, 255, 255, 0.1);
    color: var(--text);
  }
  /* 高度涂改滑块行（第十一轮） */
  .hsl {
    display: flex;
    align-items: center;
    gap: 6px;
    margin: 6px 0 2px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .hsl-lb {
    flex: 0 0 auto;
  }
  .sty {
    margin-top: 6px;
  }
  .dim {
    margin: 0;
    padding: 8px;
    color: var(--text-dim);
    font-size: 11px;
  }
</style>
