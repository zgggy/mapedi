<script lang="ts">
  /**
   * 工作区：PanelShell 壳 + 统一 ItemButton 行（眼睛 + 元素色 + 名称 + 简介 + 可选控件）。
   * 选中即进入绘制；空白点击/Esc/完成退出。
   * 拖动 = 长按（进度条填满解锁）；拖动时其他行让开，松手触发重排重算。
   * 区间型元素（attributes.kind === 'interval'）行内滑块：拖滑块 = 选中该元素，涂改值 = 滑块数字。
   */
  import { tick } from 'svelte';
  import type { Region, World } from '../../core/types';
  import { LAYER_META } from '../workbench/layerMeta';
  import { rebuildHeightIntervalElements } from '../../core/layer/heightElements';
  import { childLayerIdOf } from '../../core/regionOps';
  import { diplomacyBadge } from '../../core/diplomacy';
  import { defaultLayerVisible } from '../../core/displayCompose';
  import PanelShell from './PanelShell.svelte';
  import ItemButton from './ItemButton.svelte';
  import CreateRow from './CreateRow.svelte';
  import CreateBox from './CreateBox.svelte';
  import {
    hintAtPoint,
    hintForShell,
    type DropHint,
    type RowMeta,
  } from './dnd';
  import { ROW_EST, VIRTUAL_MIN, listWindow } from './virtualList';

  let {
    world,
    open = true,
    focusLayer = 'cells',
    selectedRegionId = null,
    expandedIds = $bindable(new Set<string>()),
    drawActive = false,
    brushRadius = 1.5,
    newName = '',
    onSelect,
    onDelete,
    onDraw,
    onPaintValue,
    onRadius,
    onDrawMode,
    onCreate,
    onCreateChild,
    onRandomName,
    onNewName,
    onRegionDrag,
    onCollapse,
  }: {
    world: World | null;
    open?: boolean;
    focusLayer?: string;
    selectedRegionId?: string | null;
    expandedIds?: Set<string>;
    drawActive?: boolean;
    brushRadius?: number;
    newName?: string;
    onSelect: (id: string | null) => void;
    onDelete: (id: string) => void;
    onDraw: (id: string) => void;
    /** 区间型元素滑块联动：滑动即选定该元素 + 涂改值 = 滑块数字 */
    onPaintValue?: (id: string, value: number) => void;
    onRadius?: (v: number) => void;
    onDrawMode?: () => void;
    onCreate?: () => void;
    onCreateChild?: (parentId: string) => void;
    onRandomName?: () => void;
    onNewName?: (v: string) => void;
    onRegionDrag?: (fromId: string, hint: DropHint) => void;
    onCollapse?: () => void;
  } = $props();

  const meta = $derived(LAYER_META[focusLayer]);
  const isHeight = $derived(focusLayer === 'height');
  const isFreeLayer = $derived(
    focusLayer === 'road' || focusLayer === 'route' || focusLayer === 'river',
  );
  /** 自由路径层：列出 paths（与 cell 无关） */
  const pathItems = $derived(
    world && isFreeLayer
      ? (world.paths ?? []).filter((p) => p.layerId === focusLayer)
      : [],
  );

  type Node = {
    region: Region;
    depth: number;
    parentId: string | null;
    expandable: boolean;
    kids: Node[];
  };

  function childLayerFor(region: Region): string | null {
    if (!world) return null;
    return childLayerIdOf(world, region.layerId);
  }
  function canExpand(r: Region): boolean {
    return !!childLayerFor(r);
  }
  function kidsOf(r: Region): Region[] {
    if (!world) return [];
    const cl = childLayerFor(r);
    if (!cl) return [];
    return world.regions.filter((x) => x.parentId === r.id && x.layerId === cl);
  }

  const roots = $derived.by(() => {
    if (!world) return [] as Node[];
    const all = world.regions.filter((r) => r.layerId === focusLayer);
    const tops = all.filter((r) => {
      if (!r.parentId) return true;
      const p = world.regions.find((x) => x.id === r.parentId);
      return !p || p.layerId !== focusLayer;
    });
    const build = (r: Region, depth: number, parentId: string | null): Node => {
      const expandable = canExpand(r);
      return {
        region: r,
        depth,
        parentId,
        expandable,
        kids: expandable ? kidsOf(r).map((c) => build(c, depth + 1, r.id)) : [],
      };
    };
    return tops.map((r) => build(r, 0, null));
  });

  const flatRows = $derived.by(() => {
    const out: RowMeta[] = [];
    const walk = (nodes: Node[]) => {
      for (const n of nodes) {
        out.push({
          id: n.region.id,
          depth: n.depth,
          parentId: n.parentId,
          nestable: n.expandable,
        });
        walk(n.kids);
      }
    };
    walk(roots);
    return out;
  });

  /** 展开路径上的可见行（虚拟化渲染源） */
  const visibleFlat = $derived.by(() => {
    const out: { node: Node; open: boolean }[] = [];
    const walk = (nodes: Node[]) => {
      for (const n of nodes) {
        const open = n.expandable && expandedIds.has(n.region.id);
        out.push({ node: n, open });
        if (open) walk(n.kids);
      }
    };
    walk(roots);
    return out;
  });

  let scrollTop = $state(0);
  let listH = $state(360);
  const virtualMode = $derived(
    isFreeLayer
      ? pathItems.length >= VIRTUAL_MIN
      : !isFreeLayer && visibleFlat.length >= VIRTUAL_MIN,
  );
  const pathWin = $derived(
    isFreeLayer && pathItems.length >= VIRTUAL_MIN
      ? listWindow(pathItems.length, scrollTop, listH, ROW_EST)
      : null,
  );
  const pathSlice = $derived(
    pathWin ? pathItems.slice(pathWin.start, pathWin.end) : pathItems,
  );
  const vwin = $derived(
    virtualMode ? listWindow(visibleFlat.length, scrollTop, listH, ROW_EST) : null,
  );
  const vSlice = $derived(virtualMode && vwin ? visibleFlat.slice(vwin.start, vwin.end) : []);
  const dragRows = $derived(
    isFreeLayer
      ? pathItems.map(
          (p) =>
            ({
              id: p.id,
              depth: 0,
              parentId: null,
              nestable: false,
            }) satisfies RowMeta,
        )
      : virtualMode
        ? visibleFlat.map(
            (v) =>
              ({
                id: v.node.region.id,
                depth: v.node.depth,
                parentId: v.node.parentId,
                nestable: v.node.expandable,
              }) satisfies RowMeta,
          )
        : flatRows,
  );

  let enterId: string | null = $state(null);
  let createPulseParent: string | null = $state(null);
  let listEl: HTMLElement | undefined = $state();

  // —— 长按拖动（区域重排）——
  let dragId: string | null = $state(null);
  let dropHint = $state<DropHint | null>(null);
  let rectCache: { id: string; top: number; bottom: number; left: number; right: number }[] | null = null;
  let dragReady = false;
  let ghost = $state<{ x: number; y: number; name: string } | null>(null);

  $effect(() => {
    // 只补缺失的高度区间元素；禁止依赖 world.regions 的条件重建（会无限触发）
    if (world && isHeight) {
      const has = world.regions.some((r) => r.layerId === 'height' && r.attributes?.kind === 'interval');
      if (!has) {
        rebuildHeightIntervalElements(world);
      }
    }
  });

  $effect(() => {
    if (virtualMode && listEl) listH = listEl.clientHeight || 360;
  });

  /** 区间型元素（attributes.kind === 'interval'，带 lo/hi/min）：滑块区间 = 元素高度区间。
   *  数据驱动——未来任何「区间型元素」都自动获得滑块；单值型元素不渲染滑块。 */
  function intervalAttrs(r: { attributes?: Record<string, unknown> }): { lo: number; hi: number; min: number } | null {
    const a = r.attributes;
    if (!a || a.kind !== 'interval') return null;
    const lo = typeof a.lo === 'number' ? a.lo : 0;
    const hi = typeof a.hi === 'number' ? a.hi : 1;
    const min = typeof a.min === 'number' ? a.min : lo;
    return { lo, hi, min };
  }
  /** 每元素涂改值（初始 = 区间 min） */
  const paintValues: Record<string, number> = {};
  function paintValueOf(id: string, attrs: { min: number }): number {
    return paintValues[id] ?? attrs.min;
  }
  function onSliderInput(id: string, e: Event) {
    const v = Number((e.currentTarget as HTMLInputElement).value);
    paintValues[id] = v;
    handleSelect(id);
    onPaintValue?.(id, v);
  }

  /** 行简介：区间元素 = 高度范围；其余 = 描述或地块数 */
  function descOf(r: Region): string {
    const ia = intervalAttrs(r);
    if (ia) return `${ia.lo}~${ia.hi}`;
    const d = r.attributes?.description;
    return typeof d === 'string' && d ? d : `${r.cells.length}c`;
  }

  function layerVisibleOf(layerId: string): boolean {
    const l = world?.layers.find((x) => x.id === layerId);
    return l ? (l.visible ?? defaultLayerVisible(l)) : true;
  }

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }

  /** 选中即进入绘制（无需再点绘制按钮） */
  function handleSelect(id: string) {
    onSelect(id);
    onDraw?.(id);
    const r = world?.regions.find((x) => x.id === id);
    if (r && canExpand(r)) toggleExpand(id);
  }

  /** 点击面板空白处 = 无选中元素 = 退出绘制（与完成/Esc 同效） */
  function onBlankClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('button') || t.closest('input') || t.closest('.ibtn')) return;
    onSelect(null as unknown as string);
    if (drawActive) onDrawMode?.();
  }

  function activeHeader() {
    if (isHeight) return { icon: '⛰️', title: '高度' };
    return { icon: meta?.emoji ?? '📄', title: meta?.name ?? focusLayer };
  }
  function childNameOf(r: Region): string {
    const cl = childLayerFor(r);
    return cl ? (LAYER_META[cl]?.name ?? cl) : '子元素';
  }

  function handleCreateChild(parentId: string) {
    onCreateChild?.(parentId);
    createPulseParent = parentId;
    queueMicrotask(() => {
      if (selectedRegionId) enterId = selectedRegionId;
      setTimeout(() => {
        enterId = null;
        createPulseParent = null;
      }, 320);
    });
  }

  function collectRects() {
    if (rectCache) return rectCache;
    if (!listEl) return [];
    rectCache = Array.from(listEl.querySelectorAll<HTMLElement>('[data-row-id]')).map((el) => {
      const r = el.getBoundingClientRect();
      return {
        id: el.dataset.rowId!,
        top: r.top,
        bottom: r.bottom,
        left: r.left,
        right: r.right,
      };
    });
    return rectCache;
  }

  async function onRowHold(id: string, start: { x: number; y: number }) {
    dragId = id;
    dragReady = false;
    rectCache = null;
    const name =
      world?.regions.find((r) => r.id === id)?.name ??
      world?.paths?.find((p) => p.id === id)?.name ??
      id;
    ghost = { x: start.x + 12, y: start.y - 14, name };
    await tick();
    rectCache = null;
    dragReady = true;
  }

  function onRowMove(e: PointerEvent) {
    if (!dragId) return;
    if (ghost) ghost = { ...ghost, x: e.clientX + 12, y: e.clientY - 14 };
    if (!dragReady) return;
    const rects = collectRects().filter((r) => r.id !== dragId);
    dropHint = hintAtPoint(e.clientY, rects, dragRows);
  }

  function onRowEnd() {
    if (dragId && dropHint && onRegionDrag && dragReady && !isFreeLayer) {
      onRegionDrag(dragId, dropHint);
    }
    dragId = null;
    dropHint = null;
    rectCache = null;
    dragReady = false;
    ghost = null;
  }

  function shellHint(id: string) {
    return hintForShell(dropHint, id, dragRows);
  }

  function diploBadgeOf(r: Region): string {
    return world && focusLayer === 'country' ? (diplomacyBadge(world, r) ?? '') : '';
  }
</script>

{#if !world}
  <PanelShell title="工作区" icon="🗂" side="right" width={320} {open} onCollapse={onCollapse}>
    <p class="dim pad">世界尚未生成。</p>
  </PanelShell>
{:else}
  {@const hd = activeHeader()}
  <PanelShell title="工作区 · {hd.title}" icon={hd.icon} side="right" width={320} {open} onCollapse={onCollapse}>
    <div class="ws" onclick={onBlankClick}>
      {#if !isHeight}
        <div class="create">
          <CreateRow
            placeholder="新元素"
            {newName}
            onNewName={(v) => onNewName?.(v)}
            onRandom={() => onRandomName?.()}
            onCreate={() => onCreate?.()}
          />
        </div>
      {/if}

      {#if isHeight}
        <div class="tools">
          <label class="field inline">
            <span>笔刷 {brushRadius.toFixed(1)}°</span>
            <input
              type="range"
              min="0.3"
              max="8"
              step="0.1"
              value={brushRadius}
              oninput={(e) => onRadius?.(Number(e.currentTarget.value))}
            />
          </label>
        </div>
      {/if}

      {#snippet rowBtn(r: Region)}
        {@const ia = intervalAttrs(r)}
        <ItemButton
          visible={layerVisibleOf(r.layerId)}
          logoColor={r.color}
          name={r.name}
          desc={descOf(r)}
          badge={diploBadgeOf(r)}
          selected={selectedRegionId === r.id}
          dragging={dragId === r.id}
          onClick={() => {
            handleSelect(r.id);
            if (ia) onPaintValue?.(r.id, paintValueOf(r.id, ia));
          }}
          onHold={(s) => onRowHold(r.id, s)}
          onDragMove={onRowMove}
          onDragEnd={onRowEnd}
        >
          {#snippet control()}
            {#if ia}
              <input
                type="range"
                min={ia.lo}
                max={ia.hi}
                step="1"
                value={paintValueOf(r.id, ia)}
                aria-label="{r.name} 涂改高度"
                oninput={(e) => onSliderInput(r.id, e)}
              />
              <span class="val">{paintValueOf(r.id, ia)}</span>
            {/if}
          {/snippet}
        </ItemButton>
      {/snippet}

      {#snippet rowNode(n: Node)}
        {@const open = expandedIds.has(n.region.id) && n.expandable}
        {@const id = n.region.id}
        {@const h = shellHint(id)}
        <li
          class="node"
          class:gap-above={h?.kind === 'gap-top'}
          class:gap-below={h?.kind === 'gap-bottom'}
          class:nest-hl={h?.kind === 'nest'}
          data-row-id={id}
          data-kind="region"
        >
          <div class="rowwrap">
            {@render rowBtn(n.region)}
            <span class="actbtns">
              {#if n.expandable}
                <button type="button" title="展开子元素" onclick={(e) => { e.stopPropagation(); toggleExpand(id); }}>{open ? '▾' : '▸'}</button>
              {/if}
              <button type="button" title="删除（保留子元素）" onclick={(e) => { e.stopPropagation(); onDelete(id); }}>🗑</button>
            </span>
          </div>
          {#if n.expandable}
            <div class="branch" class:open>
              <div class="branch-inner">
                <div class="create-slot" class:pulse={createPulseParent === id} class:visible={open}>
                  <CreateBox
                    placeholder={`新${childNameOf(n.region)}`}
                    {newName}
                    onNewName={(v) => onNewName?.(v)}
                    onRandom={() => onRandomName?.()}
                    onCreate={() => handleCreateChild(id)}
                  />
                </div>
                {#each n.kids as kid (kid.region.id)}
                  <div
                    class="kid-wrap"
                    class:visible={open}
                    class:enter={enterId === kid.region.id}
                  >
                    {@render rowNode(kid)}
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        </li>
      {/snippet}

      {#if isFreeLayer}
        <p class="dim-pad">
          每个元素 = 一条曲线。点工作区元素选中后再画；➕ 可新建多条。Esc 退出编辑。
        </p>
        <ul
          class="list"
          class:virtual={!!pathWin}
          role="list"
          bind:this={listEl}
          onscroll={(e) => {
            if (!pathWin) return;
            scrollTop = e.currentTarget.scrollTop;
            listH = e.currentTarget.clientHeight || 360;
          }}
        >
          {#if pathWin}
            <li class="v-pad" style="height:{pathWin.padTop}px" aria-hidden="true"></li>
          {/if}
          {#each pathWin ? pathSlice : pathItems as p (p.id)}
            <li class="node flat" data-row-id={p.id} data-kind="path">
              <div class="rowwrap">
                <ItemButton
                  visible={layerVisibleOf(p.layerId)}
                  logoColor={p.color}
                  name={p.name}
                  desc=""
                  selected={selectedRegionId === p.id}
                  onClick={() => onSelect(p.id)}
                  onHold={(s) => onRowHold(p.id, s)}
                  onDragMove={onRowMove}
                  onDragEnd={onRowEnd}
                />
                <span class="actbtns">
                  <button type="button" title="删除" onclick={(e) => { e.stopPropagation(); onDelete(p.id); }}>🗑</button>
                </span>
              </div>
            </li>
          {/each}
          {#if pathWin}
            <li class="v-pad" style="height:{pathWin.padBottom}px" aria-hidden="true"></li>
          {/if}
          {#if !pathItems.length}
            <li class="dim-pad">暂无路径，在地图上绘制</li>
          {/if}
        </ul>
      {:else if virtualMode && !isFreeLayer}
        <ul
          class="list virtual"
          role="list"
          bind:this={listEl}
          onscroll={(e) => {
            scrollTop = e.currentTarget.scrollTop;
            listH = e.currentTarget.clientHeight || 360;
          }}
        >
          {#if vwin}
            <li class="v-pad" style="height:{vwin.padTop}px" aria-hidden="true"></li>
          {/if}
          {#each vSlice as item (item.node.region.id)}
            {@render rowNode(item.node)}
          {/each}
          {#if vwin}
            <li class="v-pad" style="height:{vwin.padBottom}px" aria-hidden="true"></li>
          {/if}
        </ul>
      {:else}
        <ul class="list" role="list" bind:this={listEl}>
          {#each roots as n (n.region.id)}
            {@render rowNode(n)}
          {/each}
        </ul>
      {/if}
    </div>
    {#if ghost}
      <div class="drag-ghost" style="left:{ghost.x}px;top:{ghost.y}px" aria-hidden="true">
        {ghost.name}
      </div>
    {/if}
  </PanelShell>
{/if}

<style>
  .ws {
    font-size: 12px;
    user-select: none;
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }
  .create {
    flex: 0 0 auto;
    padding: 8px 8px 4px;
    border-bottom: 1px solid var(--panel-border);
  }
  .tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    padding: 8px;
  }
  .field.inline {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--text-dim);
    font-size: 11px;
    margin: 0;
  }
  .field.inline input {
    width: 100px;
  }
  .list {
    --gap: 4px;
    flex: 1;
    min-height: 0;
    list-style: none;
    margin: 0;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }
  .list.virtual {
    overflow: auto;
    max-height: min(52vh, 520px);
    gap: 0;
  }
  .list.virtual .v-pad {
    list-style: none;
    margin: 0;
    padding: 0;
    pointer-events: none;
  }
  .list.virtual .node.flat {
    height: 40px;
    box-sizing: border-box;
  }
  /* 行卡：ItemButton 为主体，行动按钮在旁；选中黄框在按钮上 */
  .rowwrap {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .actbtns {
    flex: 0 0 auto;
    display: flex;
    gap: 2px;
  }
  .actbtns button {
    border: none;
    background: transparent;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 5px;
    font-size: 12px;
  }
  .actbtns button:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .val {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    min-width: 30px;
    text-align: right;
  }
  .node {
    margin: 0;
    display: flex;
    flex-direction: column;
    flex: 0 0 auto;
  }
  /* 拖动中相邻行让开，形成插入位 */
  .list .node {
    transition:
      margin 0.18s ease,
      padding 0.18s ease;
  }
  .node.gap-above {
    margin-top: 28px;
  }
  .node.gap-below {
    margin-bottom: 28px;
  }
  .node.nest-hl :global(.ibtn) {
    border-color: rgba(240, 195, 106, 0.8);
    background: rgba(240, 195, 106, 0.12);
  }
  .branch {
    display: grid;
    grid-template-rows: 0fr;
    transition: grid-template-rows 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .branch.open {
    grid-template-rows: 1fr;
  }
  .branch-inner {
    overflow: hidden;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding-top: 4px;
  }
  .create-slot {
    opacity: 0;
    transform: translateY(-10px);
    transition:
      opacity 0.22s ease,
      transform 0.28s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .create-slot.visible {
    opacity: 1;
    transform: none;
  }
  .create-slot.pulse {
    animation: createDrop 0.32s ease;
  }
  .kid-wrap {
    opacity: 0;
    transform: translateY(-12px);
    transition:
      opacity 0.24s ease,
      transform 0.3s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .kid-wrap.visible {
    opacity: 1;
    transform: none;
  }
  .kid-wrap.enter {
    animation: kidIn 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes kidIn {
    from {
      opacity: 0;
      transform: translateY(-14px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
  @keyframes createDrop {
    0% {
      transform: translateY(-8px);
      opacity: 0.4;
    }
    100% {
      transform: none;
      opacity: 1;
    }
  }
  .dim.pad {
    padding: 12px;
    color: var(--text-dim);
    font-size: 11px;
  }
  .dim-pad {
    flex: 0 0 auto;
    margin: 0;
    padding: 8px 10px;
    color: var(--text-dim);
    font-size: 10px;
  }
  .drag-ghost {
    position: fixed;
    z-index: 80;
    pointer-events: none;
    opacity: 0.55;
    padding: 4px 10px;
    border-radius: 8px;
    background: rgba(30, 34, 44, 0.9);
    border: 1px solid rgba(240, 195, 106, 0.65);
    color: var(--text);
    font-size: 12px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
    transform: translateZ(0);
  }
</style>
