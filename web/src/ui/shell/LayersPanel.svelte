<script lang="ts">
  import { tick } from 'svelte';
  import { LAYER_META } from '../workbench/layerMeta';
  import type { World } from '../../core/types';
  import PanelHeader from './PanelHeader.svelte';
  import EntityRowShell from './EntityRowShell.svelte';
  import EntityInfoModal from './EntityInfoModal.svelte';
  import {
    DRAG_THRESHOLD,
    hintAtPoint,
    hintForShell,
    type DropHint,
    type RowMeta,
  } from './dnd';
  import { defaultLayerVisible } from '../../core/displayCompose';

  let {
    world,
    open = $bindable(true),
    focusLayer = 'cells',
    leftW = 200,
    newName = '',
    onSelect,
    onToggleVisible,
    onDrawLayer,
    onStyleLayer,
    onDragLayer,
    onAddLayer,
    onNewName,
    onRandomName,
  }: {
    world: World | null;
    open?: boolean;
    focusLayer?: string;
    leftW?: number;
    newName?: string;
    /** 单击选中（并置顶显示） */
    onSelect?: (id: string) => void;
    /** 眼睛图标：显隐（双击 = 显示面板） */
    onToggleVisible?: (id: string) => void;
    /** 🖌 绘制：打开工作区 */
    onDrawLayer?: (id: string) => void;
    /** 🎨 显示：打开 DisplayStyle 面板 */
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
  } = $props();

  let dragId: string | null = $state(null);
  let dropHint = $state<DropHint | null>(null);
  let infoLayerId: string | null = $state(null);
  let ptr = { x: 0, y: 0, id: null as string | null };
  let listEl: HTMLElement | undefined = $state();
  let rectCache: { id: string; top: number; bottom: number; left: number; right: number }[] | null =
    null;
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

  const infoMeta = $derived(infoLayerId ? LAYER_META[infoLayerId] : null);
  const infoLayer = $derived(
    infoLayerId && world ? world.layers.find((l) => l.id === infoLayerId) : null,
  );

  function catLabel(c: string) {
    return c === 'cell' ? '依赖地块' : c === 'free' ? '不依赖地块' : '自定义';
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

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const li = (e.target as HTMLElement).closest?.('[data-row-id]') as HTMLElement | null;
    if (!li) return;
    ptr = { x: e.clientX, y: e.clientY, id: li.dataset.rowId ?? null };
    rectCache = null;
  }

  async function onPointerMove(e: PointerEvent) {
    if (!ptr.id) return;
    const dist = Math.hypot(e.clientX - ptr.x, e.clientY - ptr.y);
    if (!dragId && dist > DRAG_THRESHOLD) {
      dragId = ptr.id;
      dragReady = false;
      rectCache = null;
      const row = rows.find((r) => r.id === ptr.id);
      ghost = { x: e.clientX + 12, y: e.clientY - 14, name: row?.meta.name ?? ptr.id };
      (e.currentTarget as HTMLElement)?.setPointerCapture?.(e.pointerId);
      // 等 dragging class（gap 变化）布局后再测，消除高亮错位
      await tick();
      rectCache = null;
      dragReady = true;
    }
    if (!dragId) return;
    if (ghost) ghost = { ...ghost, x: e.clientX + 12, y: e.clientY - 14 };
    if (!dragReady) return;
    const rects = collectRects().filter((r) => r.id !== dragId);
    dropHint = hintAtPoint(e.clientY, rects, rowMetas);
  }

  function onPointerUp(e: PointerEvent) {
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
    ptr.id = null;
    rectCache = null;
    dragReady = false;
    ghost = null;
    (e.currentTarget as HTMLElement)?.releasePointerCapture?.(e.pointerId);
  }

  function shellHint(id: string) {
    return hintForShell(dropHint, id, rowMetas);
  }
  function parentHl(id: string) {
    return !!dropHint && dropHint.kind === 'gap' && dropHint.highlightParentId === id;
  }

  /** 悬浮面板收起（左上角按钮） */
  let collapsed = $state(false);

  function handleSelect(id: string) {
    onSelect?.(id);
  }
  function handleToggle(id: string) {
    onToggleVisible?.(id);
  }
  function onBlankClick(e: PointerEvent | MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('[data-row-id]')) return;
    if (t?.closest?.('button,input,select,textarea,.acts')) return;
    onSelect?.('');
  }
</script>

{#if open}
  <aside
    class="lp"
    class:collapsed
    style="width:{collapsed ? 'auto' : leftW + 'px'}"
    onpointerdown={onPointerDown}
    onpointermove={onPointerMove}
    onpointerup={onPointerUp}
    onclick={onBlankClick}
    onpointercancel={() => {
      dragId = null;
      dropHint = null;
      ptr.id = null;
      ghost = null;
      dragReady = false;
    }}
  >
    <div class="lp-head">
      <button
        type="button"
        class="collapse"
        title={collapsed ? '展开图层面板' : '收起图层面板'}
        aria-label={collapsed ? '展开图层面板' : '收起图层面板'}
        onclick={() => (collapsed = !collapsed)}
      >{collapsed ? '☰' : '⊟'}</button>
      {#if !collapsed}
        <PanelHeader
          icon="📚"
          title="图层"
          placeholder="新图层"
          {newName}
          onNewName={(v) => onNewName?.(v)}
          onRandom={() => onRandomName?.()}
          onCreate={() => onAddLayer?.()}
        />
        <p class="hint">单击选中并开工作区 · 眼睛显隐 · 双击显示面板 · ℹ 信息</p>
        <ul class="list" class:dragging={!!dragId} role="list" bind:this={listEl}>
          {#each rows as row (row.id)}
            <li class="node" data-row-id={row.id}>
              <EntityRowShell
                depth={row.depth}
                name={row.meta.name}
                emoji={row.meta.emoji}
                selected={focusLayer === row.id}
                showActions={true}
                visible={row.visible}
                dragging={dragId === row.id}
                hint={shellHint(row.id)}
                parentHighlight={parentHl(row.id)}
                nestHighlight={!!dropHint && dropHint.kind === 'nest' && dropHint.targetId === row.id}
                onSelect={() => {
                  handleSelect(row.id);
                  onDrawLayer?.(row.id);
                }}
                onToggle={() => handleToggle(row.id)}
                onInfo={() => (infoLayerId = row.id)}
                onDraw={() => onDrawLayer?.(row.id)}
                onStyle={() => onStyleLayer?.(row.id)}
              />
            </li>
          {/each}
        </ul>
        {#if ghost}
          <div class="drag-ghost" style="left:{ghost.x}px;top:{ghost.y}px" aria-hidden="true">
            {ghost.name}
          </div>
        {/if}
      {/if}
  </aside>
{/if}

<EntityInfoModal
  open={!!infoLayerId && !!(infoMeta || infoLayer)}
  title="图层信息"
  name={infoLayer?.name ?? infoMeta?.name ?? ''}
  basicColor="#6b7c93"
  exclusiveColor=""
  basicEditable={false}
  cellCount={world?.regions.filter((r) => r.layerId === infoLayerId).length ?? 0}
  description={infoMeta ? `${infoMeta.emoji} ${infoMeta.kind}` : ''}
  extra={infoMeta
    ? [
        { label: '分类', value: catLabel(infoMeta.category) },
        { label: 'ID', value: infoLayerId ?? '' },
        {
          label: '子层',
          value: String(rows.filter((r) => r.parentId === infoLayerId).length),
        },
      ]
    : []}
  onClose={() => (infoLayerId = null)}
  onSave={() => (infoLayerId = null)}
/>

<style>
  .lp {
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    border-radius: 12px;
    border: 1px solid var(--panel-border);
    background: rgba(22, 26, 34, 0.92);
    backdrop-filter: blur(8px);
    position: fixed;
    top: 0;
    bottom: 0;
    left: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    background: rgba(12, 14, 20, 0.94);
    border-right: 1px solid var(--panel-border);
    overflow: hidden;
    font-size: 12px;
    user-select: none;
  }
  .lp.collapsed {
    width: auto !important;
    padding: 4px;
  }
  .lp-head {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .collapse {
    flex: 0 0 auto;
    border: 1px solid var(--panel-border);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    border-radius: 7px;
    padding: 3px 7px;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }
  .collapse:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .hint {
    margin: 0;
    padding: 4px 10px 6px;
    font-size: 10px;
    color: var(--text-dim);
    border-bottom: 1px solid var(--panel-border);
  }
  .list {
    --gap: 4px;
    list-style: none;
    margin: 0;
    padding: 8px;
    overflow: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--gap);
  }
  /* 拖拽中不加大 gap：避免 rect 与视觉错位 */
  .list.dragging {
    --gap: 4px;
  }
  .list.dragging :global(.erow) {
    transition: none !important;
  }
  .node {
    margin: 0;
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
