<script lang="ts">
  /**
   * 图层面板：PanelShell 壳 + 统一 ItemButton 行。
   * 行 = 眼睛（显隐）+ 图层 logo + 名称；单击选中并开工作区；双击打开显示面板。
   * 拖动 = 长按（进度条填满解锁）；拖动时其他行让开（gap），松手触发重排重算。
   */
  import { tick } from 'svelte';
  import { LAYER_META } from '../workbench/layerMeta';
  import type { World } from '../../core/types';
  import PanelShell from './PanelShell.svelte';
  import ItemButton from './ItemButton.svelte';
  import CreateRow from './CreateRow.svelte';
  import {
    hintAtPoint,
    hintForShell,
    type DropHint,
    type RowMeta,
  } from './dnd';
  import { defaultLayerVisible } from '../../core/displayCompose';

  let {
    world,
    open = true,
    focusLayer = 'cells',
    leftW = 220,
    newName = '',
    onSelect,
    onToggleVisible,
    onDrawLayer,
    onStyleLayer,
    onDragLayer,
    onAddLayer,
    onNewName,
    onRandomName,
    onCollapse,
  }: {
    world: World | null;
    open?: boolean;
    focusLayer?: string;
    leftW?: number;
    newName?: string;
    /** 单击选中（并置顶显示） */
    onSelect?: (id: string) => void;
    /** 眼睛图标：显隐 */
    onToggleVisible?: (id: string) => void;
    /** 选中并打开工作区 */
    onDrawLayer?: (id: string) => void;
    /** 双击：打开该图层显示参数面板 */
    onStyleLayer?: (id: string) => void;
    onDragLayer?: (
      fromId: string,
      hint:
        | { kind: 'nest'; targetId: string; nestFirst?: boolean }
        | { kind: 'gap'; afterId: string | null }
        | { kind: 'root' },
    ) => void;
    onAddLayer?: () => void;
    onNewName?: (v: string) => void;
    onRandomName?: () => void;
    onCollapse?: () => void;
  } = $props();

  let dragId: string | null = $state(null);
  let dropHint = $state<DropHint | null>(null);
  let listEl: HTMLElement | undefined = $state();
  let rectCache: { id: string; top: number; bottom: number; left: number; right: number }[] | null = null;
  /** 等 gap 布局后再测 rect，避免高亮错位 */
  let dragReady = false;
  let ghost = $state<{ x: number; y: number; name: string } | null>(null);

  type Meta = { emoji: string; name: string; kind: string; category: string; pending?: boolean };

  const rows = $derived.by(() => {
    const layers = world?.layers ?? [];
    const parentOf = new Map<string, string>();
    for (const l of layers) if (l.parentLayerId) parentOf.set(l.id, l.parentLayerId);
    const children = new Map<string | null, string[]>();
    for (const l of layers) {
      const p = parentOf.get(l.id);
      const key = p && layers.some((x) => x.id === p) ? p : null;
      let arr = children.get(key);
      if (!arr) {
        arr = [];
        children.set(key, arr);
      }
      arr.push(l.id);
    }
    const byId = new Map(layers.map((l) => [l.id, l]));
    const out: {
      id: string;
      depth: number;
      parentId: string | null;
      meta: Meta;
      nestable: boolean;
      visible: boolean;
    }[] = [];
    const walk = (pid: string | null, depth: number) => {
      for (const id of children.get(pid) ?? []) {
        const layer = byId.get(id);
        if (!layer) continue;
        const base = (LAYER_META[id] ?? {
          emoji: '📄',
          name: layer.name,
          kind: layer.kind,
          category: 'custom',
        }) as Meta;
        out.push({
          id,
          depth,
          parentId: pid,
          meta: { ...base, name: layer.name || base.name },
          nestable: true,
          visible: layer.visible ?? defaultLayerVisible(layer),
        });
        walk(id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  const rowMetas = $derived(
    rows.map((r) => ({
      id: r.id,
      depth: r.depth,
      parentId: r.parentId,
      nestable: r.nestable,
    })) as RowMeta[],
  );

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

  /** 长按进度条满 → 拖动接管 */
  async function onRowHold(id: string, start: { x: number; y: number }) {
    dragId = id;
    dragReady = false;
    rectCache = null;
    const row = rows.find((r) => r.id === id);
    ghost = { x: start.x + 12, y: start.y - 14, name: row?.meta.name ?? id };
    // 等 dragging class 布局变化稳定后再测，消除高亮错位
    await tick();
    rectCache = null;
    dragReady = true;
  }

  function onRowMove(e: PointerEvent) {
    if (!dragId) return;
    if (ghost) ghost = { ...ghost, x: e.clientX + 12, y: e.clientY - 14 };
    if (!dragReady) return;
    const rects = collectRects().filter((r) => r.id !== dragId);
    dropHint = hintAtPoint(e.clientY, rects, rowMetas);
  }

  function onRowEnd() {
    if (dragId && dropHint && onDragLayer && dragReady) {
      const h = dropHint;
      if (h.kind === 'nest' || h.kind === 'nest-first') {
        onDragLayer(dragId, {
          kind: 'nest',
          targetId: h.targetId,
          nestFirst: h.kind === 'nest-first',
        });
      } else if (h.kind === 'gap') {
        onDragLayer(dragId, { kind: 'gap', afterId: h.afterId });
      }
    }
    dragId = null;
    dropHint = null;
    rectCache = null;
    dragReady = false;
    ghost = null;
  }

  function shellHint(id: string) {
    return hintForShell(dropHint, id, rowMetas);
  }

  function handleSelect(id: string) {
    onSelect?.(id);
    onDrawLayer?.(id);
  }

  function onBlankClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('[data-row-id]')) return;
    if (t?.closest?.('button,input,select,textarea')) return;
    onSelect?.('');
  }
</script>

<PanelShell title="图层" icon="📚" side="left" width={leftW} {open} onCollapse={onCollapse}>
  <div class="create">
    <CreateRow
      placeholder="新图层"
      {newName}
      onNewName={(v) => onNewName?.(v)}
      onRandom={() => onRandomName?.()}
      onCreate={() => onAddLayer?.()}
    />
  </div>
  <p class="hint">单击选中并开工作区 · 眼睛显隐 · 双击显示面板 · 长按拖动</p>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul class="list" class:dragging={!!dragId} role="list" bind:this={listEl} onclick={onBlankClick}>
    {#each rows as row (row.id)}
      {@const h = shellHint(row.id)}
      <li
        class="node"
        class:gap-above={h?.kind === 'gap-top'}
        class:gap-below={h?.kind === 'gap-bottom'}
        class:nest-hl={h?.kind === 'nest'}
        data-row-id={row.id}
        style="padding-left:{row.depth * 12}px"
      >
        <ItemButton
          visible={row.visible}
          onEye={() => onToggleVisible?.(row.id)}
          logo={row.meta.emoji}
          name={row.meta.name}
          selected={focusLayer === row.id}
          dragging={dragId === row.id}
          onClick={() => handleSelect(row.id)}
          onDblclick={() => onStyleLayer?.(row.id)}
          onHold={(s) => onRowHold(row.id, s)}
          onDragMove={onRowMove}
          onDragEnd={onRowEnd}
        />
      </li>
    {/each}
  </ul>
  {#if ghost}
    <div class="drag-ghost" style="left:{ghost.x}px;top:{ghost.y}px" aria-hidden="true">
      {ghost.name}
    </div>
  {/if}
</PanelShell>

<style>
  .create {
    flex: 0 0 auto;
    padding: 8px 8px 4px;
    border-bottom: 1px solid var(--panel-border);
  }
  .hint {
    flex: 0 0 auto;
    margin: 0;
    padding: 4px 10px 6px;
    font-size: 10px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--panel-border);
  }
  .list {
    flex: 1;
    min-height: 0;
    overflow: auto;
    list-style: none;
    margin: 0;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .node {
    margin: 0;
  }
  /* 拖动中相邻行让开，形成插入位 */
  .list.dragging .node {
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
