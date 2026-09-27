<script lang="ts">
  /**
   * 工作区元素树 — 指针拖放（不依赖 HTML5 DnD）。
   * 排序 = 同父兄弟插入；展开 = 子图层存在。
   */
  import type { Region, World } from '../../core/types';
  import { LAYER_META } from '../workbench/layerMeta';
  import { rebuildHeightIntervalElements } from '../../core/layer/heightElements';
  import { childLayerIdOf } from '../../core/regionOps';
  import {
    diplomacyBadge,
    enemiesOf,
    alliesOf,
    suzerainOf,
  } from '../../core/diplomacy';
  import PanelHeader from './PanelHeader.svelte';
  import EntityRowShell from './EntityRowShell.svelte';
  import EntityInfoModal from './EntityInfoModal.svelte';
  import CreateBox from './CreateBox.svelte';
  import {
    DRAG_THRESHOLD,
    hintAtPoint,
    hintForShell,
    type DropHint,
    type RowMeta,
  } from './dnd';
  import {
    ROW_EST,
    VIRTUAL_MIN,
    listWindow,
    syntheticRowRects,
  } from './virtualList';

  let {
    world,
    focusLayer = 'cells',
    selectedRegionId = null,
    expandedIds = $bindable(new Set<string>()),
    drawActive = false,
    brushRadius = 1.5,
    newName = '',
    infoRegionId = null,
    onSelect,
    onInfo,
    onDelete,
    onDraw,
    onPaintValue,
    onRadius,
    onDrawMode,
    onCreate,
    onCreateChild,
    onRandomName,
    onNewName,
    onCloseInfo,
    onSaveInfo,
    onRegionDrag,
    onSetSuzerain,
    onToggleEnemy,
    onToggleAlly,
  }: {
    world: World | null;
    focusLayer?: string;
    selectedRegionId?: string | null;
    expandedIds?: Set<string>;
    drawActive?: boolean;
    brushRadius?: number;
    newName?: string;
    infoRegionId?: string | null;
    onSelect: (id: string | null) => void;
    onInfo: (id: string) => void;
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
    onCloseInfo?: () => void;
    onSaveInfo?: (patch: {
      name?: string;
      color?: string;
      exclusiveColor?: string;
      description?: string;
    }) => void;
    onRegionDrag?: (fromId: string, hint: DropHint) => void;
    onSetSuzerain?: (vassalId: string, suzerainId: string | null) => void;
    onToggleEnemy?: (aId: string, bId: string) => void;
    onToggleAlly?: (aId: string, bId: string) => void;
  } = $props();

  const meta = $derived(LAYER_META[focusLayer]);
  const isHeight = $derived(focusLayer === 'height');
  const isFreeLayer = $derived(
    focusLayer === 'road' || focusLayer === 'route' || focusLayer === 'river',
  );
  const focusChildLayerId = $derived(world ? childLayerIdOf(world, focusLayer) : null);

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
    childTint: boolean;
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
        childTint: !!r.parentId,
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
  const pathIds = $derived(pathItems.map((p) => p.id));
  const vwin = $derived(
    virtualMode ? listWindow(visibleFlat.length, scrollTop, listH, ROW_EST) : null,
  );
  const vSlice = $derived(virtualMode && vwin ? visibleFlat.slice(vwin.start, vwin.end) : []);
  const vIds = $derived(visibleFlat.map((v) => v.node.region.id));
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

  const infoRegion = $derived(
    infoRegionId && world ? (world.regions.find((r) => r.id === infoRegionId) ?? null) : null,
  );
  const infoBasicColor = $derived(() => {
    if (!infoRegion || !world) return '#888888';
    if (!infoRegion.parentId) return infoRegion.color;
    return world.regions.find((r) => r.id === infoRegion.parentId)?.color ?? infoRegion.color;
  });
  const infoBasicEditable = $derived(infoRegion ? !infoRegion.parentId : true);
  /** 外交：同层顶层元素（国家层） */
  const showDiplo = $derived(!!infoRegion && !infoRegion.parentId && focusLayer === 'country');
  const diploPeers = $derived(
    world && infoRegion
      ? world.regions
          .filter(
            (r) =>
              r.layerId === infoRegion.layerId &&
              r.id !== infoRegion.id &&
              !r.parentId,
          )
          .map((r) => ({ id: r.id, name: r.name, color: r.color }))
      : [],
  );
  const diploBadge = $derived((r: Region) =>
    world && focusLayer === 'country' ? (diplomacyBadge(world, r) ?? '') : '',
  );

  let enterId: string | null = $state(null);
  let createPulseParent: string | null = $state(null);
  let listEl: HTMLElement | undefined = $state();

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
    handleSelect(id, new MouseEvent('click') as unknown as MouseEvent);
    onPaintValue?.(id, v);
  }

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }

  /** 选中即进入绘制（无需再点绘制按钮）；工作区拖动功能已整体移除 */
  function handleSelect(id: string, _e?: MouseEvent) {
    onSelect(id);
    onDraw?.(id);
    const r = world?.regions.find((x) => x.id === id);
    if (r && canExpand(r)) toggleExpand(id);
  }

  /** 点击面板空白处 = 无选中元素 = 退出绘制（与完成/Esc 同效） */
  function onBlankClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('button') || t.closest('input') || t.closest('.box-slot')) return;
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

  function neighborsOf(region: Region): { id: string; name: string; color: string }[] {
    if (!world?.sharedEdges) return [];
    const own = new Set(region.cells);
    const ownerOfCell = new Map<number, string>();
    for (const r of world.regions) {
      for (const c of r.cells) if (!ownerOfCell.has(c)) ownerOfCell.set(c, r.id);
    }
    const hit = new Set<string>();
    for (const [key] of world.sharedEdges) {
      const [i, j] = key.split('-').map(Number);
      const aIn = own.has(i);
      const bIn = own.has(j);
      if (aIn === bIn) continue;
      const otherId = ownerOfCell.get(aIn ? j : i);
      if (otherId && otherId !== region.id) hit.add(otherId);
    }
    return [...hit].slice(0, 20).map((id) => {
      const r = world.regions.find((x) => x.id === id)!;
      return { id, name: r?.name ?? id, color: r?.color ?? '#666' };
    });
  }
  const infoNeighbors = $derived(infoRegion ? neighborsOf(infoRegion) : []);
</script>

{#if !world}
  <p class="dim pad">世界尚未生成。</p>
{:else}
  {@const hd = activeHeader()}
  <div class="ws" onclick={onBlankClick}>
    <PanelHeader
      icon={hd.icon}
      title={hd.title}
      placeholder="新元素"
      {newName}
      showCreate={!isHeight}
      onNewName={(v) => onNewName?.(v)}
      onRandom={() => onRandomName?.()}
      onCreate={() => onCreate?.()}
    />

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

    {#snippet rowNode(n: Node)}
      {@const open = expandedIds.has(n.region.id) && n.expandable}
      {@const id = n.region.id}
      {@const ia = intervalAttrs(n.region)}
      <li class="node" data-row-id={id} data-kind="region">
        <div class="rowwrap" class:sel={selectedRegionId === id}>
          <!-- 行按钮：滑块就在 button 里；选中即进入绘制 -->
          <button
            type="button"
            class="rowbtn"
            onclick={() => {
              handleSelect(id);
              if (ia) onPaintValue?.(id, paintValueOf(id, ia));
            }}
          >
            <span class="swatch" style="background:{n.region.color}"></span>
            <span class="nm">{n.region.name}</span>
            <span class="dim">{n.region.cells.length}c</span>
            {#if diploBadge(n.region)}<span class="badge">{diploBadge(n.region)}</span>{/if}
            {#if ia}
              <input
                type="range"
                min={ia.lo}
                max={ia.hi}
                step="1"
                value={paintValueOf(id, ia)}
                aria-label="{n.region.name} 涂改高度"
                oninput={(e) => onSliderInput(id, e)}
                onclick={(e) => e.stopPropagation()}
                onpointerdown={(e) => e.stopPropagation()}
              />
              <span class="val">{paintValueOf(id, ia)}</span>
              <span class="dim rng">{ia.lo}~{ia.hi}</span>
            {/if}
          </button>
          <span class="actbtns">
            <button type="button" title="信息" onclick={(e) => { e.stopPropagation(); onInfo(id); }}>ℹ️</button>
            {#if n.expandable}
              <button type="button" title="展开子元素" onclick={(e) => { e.stopPropagation(); toggleExpand(id); }}>{open ? '▾' : '▸'}</button>
            {/if}
            <button type="button" title="删除（保留子元素）" onclick={(e) => { e.stopPropagation(); onDelete(id); }}>🗑️</button>
          </span>
        </div>
        {#if n.expandable}
          <div class="branch" class:open>
            <div class="branch-inner">
              <div class="create-slot" class:pulse={createPulseParent === id} class:visible={open}>
                <EntityRowShell depth={n.depth + 1} hint={null} onSelect={() => {}}>
                  {#snippet box()}
                    <CreateBox
                      placeholder={`新${childNameOf(n.region)}`}
                      {newName}
                      onNewName={(v) => onNewName?.(v)}
                      onRandom={() => onRandomName?.()}
                      onCreate={() => handleCreateChild(id)}
                    />
                  {/snippet}
                </EntityRowShell>
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
            <EntityRowShell
              depth={0}
              name={p.name}
              color={p.color}
              selected={selectedRegionId === p.id}
              showActions={true}
              onSelect={() => onSelect(p.id)}
              onInfo={() => onInfo(p.id)}
              onDraw={() => onDraw(p.id)}
              onDelete={() => onDelete(p.id)}
            />
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
{/if}

<EntityInfoModal
  open={!!infoRegion}
  title={infoRegion ? `${meta?.emoji ?? ''} ${meta?.name ?? ''} · 元素` : '元素信息'}
  name={infoRegion?.name ?? ''}
  basicColor={infoBasicColor()}
  exclusiveColor={infoRegion?.exclusiveColor ?? ''}
  basicEditable={infoBasicEditable}
  cellCount={infoRegion?.cells.length ?? 0}
  description={(infoRegion?.attributes?.description as string) ?? ''}
  neighbors={infoNeighbors}
  extra={infoRegion
    ? [
        { label: 'ID', value: infoRegion.id },
        {
          label: '子元素',
          value: String(world ? world.regions.filter((r) => r.parentId === infoRegion.id).length : 0),
        },
        ...(showDiplo && infoRegion
          ? [
              {
                label: '附庸',
                value: String(
                  world ? world.regions.filter((r) => suzerainOf(r) === infoRegion.id).length : 0,
                ),
              },
            ]
          : []),
      ]
    : []}
  showDiplomacy={showDiplo}
  suzerainId={infoRegion ? suzerainOf(infoRegion) : null}
  peers={diploPeers}
  enemyIds={infoRegion ? enemiesOf(infoRegion) : []}
  allyIds={infoRegion ? alliesOf(infoRegion) : []}
  onSetSuzerain={(sid) => {
    if (infoRegionId) onSetSuzerain?.(infoRegionId, sid);
  }}
  onToggleEnemy={(oid) => {
    if (infoRegionId) onToggleEnemy?.(infoRegionId, oid);
  }}
  onToggleAlly={(oid) => {
    if (infoRegionId) onToggleAlly?.(infoRegionId, oid);
  }}
  onClose={() => onCloseInfo?.()}
  onSave={(patch) => onSaveInfo?.(patch)}
/>

<style>
  .ws {
    font-size: 12px;
    user-select: none;
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
  .promote-zone {
    margin: 8px 8px 0;
    padding: 8px;
    border: 1px dashed rgba(240, 195, 106, 0.55);
    border-radius: 8px;
    font-size: 10px;
    color: var(--text-dim);
    text-align: center;
  }
  .promote-zone.over {
    border-color: rgba(240, 195, 106, 0.9);
    color: var(--text);
    background: rgba(240, 195, 106, 0.12);
  }
  .list {
    --gap: 4px;
    list-style: none;
    margin: 0;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }
  .list.dragging {
    --gap: 14px;
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
  .list.dragging :global(.branch),
  .list.dragging :global(.create-slot),
  .list.dragging :global(.kid-wrap) {
    transition: none !important;
    animation: none !important;
  }
  /* 行卡：滑块在 button 里；只有选中的是黄色外框 */
  .rowwrap {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .rowwrap.sel {
    border: 1px solid #f0c36a;
    border-radius: 9px;
    box-shadow: 0 0 0 1px rgba(240, 195, 106, 0.35);
  }
  .rowbtn {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    cursor: pointer;
    text-align: left;
    font: inherit;
  }
  .rowbtn:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .rowbtn .swatch {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    border-radius: 3px;
  }
  .rowbtn .nm {
    flex: 0 0 auto;
    max-width: 96px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rowbtn .dim {
    flex: 0 0 auto;
  }
  .rowbtn input[type='range'] {
    flex: 1;
    min-width: 60px;
  }
  .rowbtn .val {
    font-size: 11px;
    font-variant-numeric: tabular-nums;
    min-width: 34px;
    text-align: right;
  }
  .rowbtn .rng {
    font-size: 10px;
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
  .node {
    margin: 0;
    display: flex;
    flex-direction: column;
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
</style>
