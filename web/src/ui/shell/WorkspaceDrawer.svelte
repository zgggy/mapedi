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
    onSelect: (id: string) => void;
    onInfo: (id: string) => void;
    onDelete: (id: string) => void;
    onDraw: (id: string) => void;
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

  let dragId: string | null = $state(null);
  let dropHint = $state<DropHint | null>(null);
  let enterId: string | null = $state(null);
  let createPulseParent: string | null = $state(null);

  let ptr = { x: 0, y: 0, id: null as string | null };
  let listEl: HTMLElement | undefined = $state();
  let promoteEl: HTMLElement | undefined = $state();
  /** 拖拽中复用首帧 rect，避免每次 pointermove 读 layout */
  let rectCache: { id: string; top: number; bottom: number; left: number; right: number }[] | null =
    null;
  let promoteRectCache: DOMRect | null = null;

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

  function toggleExpand(id: string) {
    const next = new Set(expandedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    expandedIds = next;
  }

  function handleSelect(id: string, e?: MouseEvent) {
    if (e && ptr.id === id && Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y) > DRAG_THRESHOLD) {
      return;
    }
    if (dragId) return;
    onSelect(id);
    const r = world?.regions.find((x) => x.id === id);
    if (r && canExpand(r)) toggleExpand(id);
  }

  function collectRects(): { id: string; top: number; bottom: number; left: number; right: number }[] {
    if (rectCache) return rectCache;
    if (isFreeLayer && pathWin && listEl) {
      const top = listEl.getBoundingClientRect().top;
      rectCache = syntheticRowRects(pathIds, top, ROW_EST, dragId);
      return rectCache;
    }
    if (virtualMode && listEl) {
      const top = listEl.getBoundingClientRect().top;
      rectCache = syntheticRowRects(vIds, top, ROW_EST, dragId);
      return rectCache;
    }
    if (!listEl) return [];
    const nodes = listEl.querySelectorAll<HTMLElement>('[data-row-id]');
    rectCache = Array.from(nodes).map((el) => {
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

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const li = (e.target as HTMLElement).closest?.('[data-row-id]') as HTMLElement | null;
    if (!li) return;
    ptr = { x: e.clientX, y: e.clientY, id: li.dataset.rowId ?? null };
    rectCache = null;
    promoteRectCache = null;
  }

  function onPointerMove(e: PointerEvent) {
    if (!ptr.id) return;
    const dist = Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y);
    if (!dragId && dist > DRAG_THRESHOLD) {
      dragId = ptr.id;
      rectCache = null;
      promoteRectCache = promoteEl?.getBoundingClientRect() ?? null;
      (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
    }
    if (!dragId) return;

    // 升级区
    if (promoteEl) {
      const pr = promoteRectCache ?? promoteEl.getBoundingClientRect();
      if (!promoteRectCache) promoteRectCache = pr;
      if (e.clientY >= pr.top && e.clientY <= pr.bottom) {
        dropHint = { kind: 'promote' };
        return;
      }
    }
    const rects = collectRects().filter((r) => r.id !== dragId);
    dropHint = hintAtPoint(e.clientY, rects, dragRows);
  }

  function onPointerUp(e: PointerEvent) {
    if (dragId && dropHint && onRegionDrag) {
      onRegionDrag(dragId, dropHint);
    }
    dragId = null;
    dropHint = null;
    ptr.id = null;
    rectCache = null;
    promoteRectCache = null;
    (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
  }

  function onPointerCancel() {
    dragId = null;
    dropHint = null;
    ptr.id = null;
    rectCache = null;
    promoteRectCache = null;
  }

  function shellHint(id: string) {
    return hintForShell(dropHint, id, dragRows);
  }
  function parentHl(id: string) {
    return !!dropHint && dropHint.kind === 'gap' && dropHint.highlightParentId === id;
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
  <div
    class="ws"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onpointercancel={onPointerCancel}
  >
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
        <button type="button" class:active={drawActive} onclick={() => onDrawMode?.()}>
          🖌️ {drawActive ? '绘制中…' : '绘制'}
        </button>
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

    {#if dragId && focusChildLayerId}
      <div class="promote-zone" class:over={dropHint?.kind === 'promote'} bind:this={promoteEl}>
        ↑ 升级为{meta?.name}
      </div>
    {/if}

    {#snippet rowNode(n: Node)}
      {@const open = expandedIds.has(n.region.id) && n.expandable}
      {@const id = n.region.id}
      <li class="node" data-row-id={id} data-kind="region">
        <EntityRowShell
          depth={n.depth}
          name={n.region.name}
          color={n.region.color}
          badge={diploBadge(n.region)}
          selected={selectedRegionId === id}
          showActions={true}
          expandable={n.expandable}
          expanded={open}
          childTint={n.childTint}
          dragging={dragId === id}
          hint={shellHint(id)}
          parentHighlight={parentHl(id)}
          nestHighlight={!!dropHint && dropHint.kind === 'nest' && dropHint.targetId === id}
          onSelect={(e) => handleSelect(id, e)}
          onInfo={() => onInfo(id)}
          onDraw={() => onDraw(id)}
          onDelete={() => onDelete(id)}
        />
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
      class:dragging={!!dragId}
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
        {@const n = item.node}
        {@const id = n.region.id}
        <li class="node flat" data-row-id={id} data-kind="region">
          <EntityRowShell
            depth={n.depth}
            name={n.region.name}
            color={n.region.color}
            badge={diploBadge(n.region)}
            selected={selectedRegionId === id}
            showActions={true}
            expandable={n.expandable}
            expanded={item.open}
            childTint={n.childTint}
            dragging={dragId === id}
            hint={shellHint(id)}
            parentHighlight={parentHl(id)}
            nestHighlight={!!dropHint && dropHint.kind === 'nest' && dropHint.targetId === id}
            onSelect={(e) => handleSelect(id, e)}
            onInfo={() => onInfo(id)}
            onDraw={() => onDraw(id)}
            onDelete={() => onDelete(id)}
          />
        </li>
      {/each}
      {#if vwin}
        <li class="v-pad" style="height:{vwin.padBottom}px" aria-hidden="true"></li>
      {/if}
    </ul>
    {:else}
    <ul class="list" class:dragging={!!dragId} role="list" bind:this={listEl}>
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
