<script lang="ts">
  /**
   * 图层段（左轨内的图层子面板，设计稿 §3.2）：
   * - header 常驻：`[⊟ 收起整轨] 当前聚焦层（emoji·名·eye·元素数） [展开/收起]`
   * - 展开：CreateRow + 单列网格 ItemButton 行（内滚由左轨段负责，§3.1 双滚动模型）
   * 行 = 眼睛（显隐）+ 图层 logo + 名称；单击聚焦（C1：不进绘制）；双击打开显示参数。
   * 右键菜单：显示/隐藏、上移一层、下移一层、复制一个、删除。
   * 拖动 = 长按进度条解锁 → 整个按钮被拿起来（浮动件跟指针）→ 目标格与下方元素让一格
   *（transform + 过渡动画）→ 松手触发重排重算。
   */
  import { tick } from 'svelte';
  import { LAYER_META } from '../workbench/layerMeta';
  import type { World } from '../../core/types';
  import ItemButton from './ItemButton.svelte';
  import ExpandPanel from './ExpandPanel.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import CreateRow from './CreateRow.svelte';
  import { defaultLayerVisible } from '../../core/displayCompose';
  import { liftTransforms, insertIndex, insertPlan, measureSlot, SLOT, type FlatRow, type RowRect } from './liftDrag';

  let {
    world,
    focusLayer = 'cells',
    newName = '',
    onSelect,
    onToggleVisible,
    onDrawLayer,
    onDragLayer,
    onAddLayer,
    onNewName,
    onRandomName,
    onMoveLayer,
    onCopyLayer,
    onDeleteLayer,
    expandPanel,
  }: {
    world: World | null;
    focusLayer?: string;
    newName?: string;
    /** 单击选中（并置顶显示） */
    onSelect?: (id: string) => void;
    /** 眼睛图标：显隐 */
    onToggleVisible?: (id: string) => void;
    /** 选中（C1：单击只聚焦，不进绘制） */
    onDrawLayer?: (id: string) => void;
    onDragLayer?: (
      fromId: string,
      hint:
        | { kind: 'nest'; nestFirst?: boolean }
        | { kind: 'gap'; afterId: string | null }
        | { kind: 'root' },
    ) => void;
    onAddLayer?: () => void;
    onNewName?: (v: string) => void;
    onRandomName?: () => void;
    /** 右键菜单：上移/下移一层（dir=-1 上移） */
    onMoveLayer?: (id: string, dir: -1 | 1) => void;
    /** 右键菜单：复制一个 */
    onCopyLayer?: (id: string) => void;
    /** 右键菜单：删除 */
    onDeleteLayer?: (id: string) => void;
    /** 聚焦行下方的模式展开区（检查=InspectSection / 生成=GenerateSection / 绘制=不传=空） */
    expandPanel?: import('svelte').Snippet;
  } = $props();

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
          visible: layer.visible ?? defaultLayerVisible(layer),
        });
        walk(id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });

  const flatRows = $derived(rows.map((r) => ({ id: r.id, parentId: r.parentId }) as FlatRow));

  /** 行级展开区收起态（第七轮：header 点击=收起；换聚焦层自动重开——逻辑与元素侧一致） */
  let collapsedFor = $state<string | null>(null);
  $effect(() => {
    // 聚焦层变化即视为新的展开（收起只对当次聚焦有效）
    void focusLayer;
    collapsedFor = null;
  });

  // —— 右键菜单 ——
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  function openMenu(e: MouseEvent, id: string) {
    // 简化（2026-09-30 拍板 3）：显隐 → 行内 eye；信息/显示参数 → 检查模式展开区；
    // 上移/下移 → 长按拖动。只留无其他入口的复制/删除。
    const items: MenuItem[] = [{ id: 'copy', label: '复制一个', action: () => onCopyLayer?.(id) }];
    if (id.startsWith('custom-')) {
      items.push({ id: 'del', label: '删除', danger: true, action: () => onDeleteLayer?.(id) });
    } else {
      items.push({ id: 'del', label: '删除（内置层不可删）', disabled: true });
    }
    menu = { x: e.clientX, y: e.clientY, items };
  }

  // —— 抬起式拖动 ——
  let dragId: string | null = $state(null);
  let dragIndex = -1;
  let lift = $state<{ x: number; y: number; name: string; emoji: string; visible: boolean } | null>(null);
  let offsets = $state<number[]>([]);
  let listEl: HTMLElement | undefined = $state();
  // 行内容（名称换行/改名）变化后统一行高：MutationObserver 稳定触发
  $effect(() => {
    const el = listEl;
    if (!el) return;
    slot = measureSlot(el);
    const mo = new MutationObserver(() => {
      slot = measureSlot(el);
    });
    mo.observe(el, { subtree: true, childList: true, characterData: true });
    return () => mo.disconnect();
  });

  let rectCache: RowRect[] = [];
  let dragReady = false;
  let slot = SLOT;

  async function onRowHold(id: string, start: { x: number; y: number }) {
    dragIndex = rows.findIndex((r) => r.id === id);
    if (dragIndex < 0) return;
    slot = measureSlot(listEl);
    dragId = id;
    dragReady = false;
    const row = rows[dragIndex];
    lift = { x: start.x, y: start.y, name: row.meta.name, emoji: row.meta.emoji, visible: row.visible };
    offsets = liftTransforms(rows.length, dragIndex, dragIndex, slot);
    await tick();
    // 拖动起点缓存行矩形：让位动画的 transform 不反馈进命中
    rectCache = [];
    let ci = 0;
    for (const el of listEl?.querySelectorAll<HTMLElement>('li.cell') ?? []) {
      const r = el.getBoundingClientRect();
      rectCache.push({ idx: ci++, top: r.top, bottom: r.bottom });
    }
    dragReady = true;
  }

  function onRowMove(e: PointerEvent) {
    if (!dragId || !dragReady) return;
    lift = { x: e.clientX, y: e.clientY, name: lift!.name, emoji: lift!.emoji, visible: lift!.visible };
    const k = insertIndex(rectCache, dragIndex, 0, e.clientY);
    offsets = liftTransforms(rows.length, dragIndex, k, slot);
  }

  function onRowEnd(e: PointerEvent) {
    if (dragId && dragReady && onDragLayer) {
      const k = insertIndex(rectCache, dragIndex, 0, e.clientY);
      const plan = insertPlan(flatRows, dragIndex, k);
      if (plan.kind === 'nest-first') {
        onDragLayer(dragId, { kind: 'nest', targetId: plan.targetId, nestFirst: true });
      } else {
        onDragLayer(dragId, { kind: 'gap', afterId: plan.afterId });
      }
    }
    dragId = null;
    dragIndex = -1;
    lift = null;
    offsets = [];
    rectCache = [];
    dragReady = false;
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

<div class="sec-root">
  <!-- 2026-09-30 第六轮终稿：header/胶囊/轻区头已上移或退役——本组件 = 纯图层列表
       （收起/展开把手由 LeftRail 的面板框架承担） -->
    <div class="body">
      <div class="create">
    <CreateRow
      placeholder="新图层"
      {newName}
      onNewName={(v) => onNewName?.(v)}
      onRandom={() => onRandomName?.()}
      onCreate={() => onAddLayer?.()}
    />
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul class="grid" role="list" bind:this={listEl} onclick={onBlankClick}>
    {#each rows as row, i (row.id)}
      <li class="cell" data-row-id={row.id} style="transform:translateY({offsets[i] ?? 0}px)">
        <ItemButton
          visible={row.visible}
          onEye={() => onToggleVisible?.(row.id)}
          logo={row.meta.emoji}
          name={row.meta.name}
          selected={focusLayer === row.id}
          dragging={dragId === row.id}
          onClick={() => handleSelect(row.id)}
          onMenu={(e) => openMenu(e, row.id)}
          onHold={(s) => onRowHold(id, s)}
          onDragMove={onRowMove}
          onDragEnd={onRowEnd}
        />
      </li>
      {#if focusLayer === row.id && expandPanel}
        <li class="cell panel">
          <!-- 行级展开区 = 同一 ExpandPanel 单体（第七轮：只换传参；点击 header 收起） -->
          <ExpandPanel
            icon={row.meta.emoji}
            label={row.meta.name}
            open={collapsedFor !== row.id}
            onToggle={(v) => (collapsedFor = v ? null : row.id)}
            title="收起该图层的展开区"
            content={expandPanel}
          />
        </li>
      {/if}
    {/each}
      </ul>
    </div>

  {#if lift && dragId}
    <div class="lift" style="transform:translate({lift.x + 12}px,{lift.y - 20}px)">
      <ItemButton lift visible={lift.visible} logo={lift.emoji} name={lift.name} />
    </div>
  {/if}

  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
  {/if}
</div>

<style>
  .sec-root {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  /* header = 设计稿 §3.1 的一行：[⊟] 当前层/图层 [展开|收起] */
  /* 展开体：由左轨段负责滚动（§3.1 双滚动模型），这里只撑满 */
  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .create {
    flex: 0 0 auto;
    padding: 6px 6px 4px;
    border-bottom: 1px solid var(--panel-border);
  }
  /* 单列网格：一格 = 一个 ItemButton（与工作区列表同 padding/gap：2026-09-30 紧凑统一） */
  .grid {
    flex: 1;
    min-height: 0;
    list-style: none;
    margin: 0;
    padding: 6px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 4px;
    align-content: start;
  }
  .cell {
    margin: 0;
    height: var(--ibtn-h, 40px);
    transition: transform 0.18s ease;
  }
  /* 模式展开区（panel 节点，可变高） */
  .cell.panel {
    height: auto;
    margin-bottom: 4px;
    padding-left: 0 !important;
  }
  .lift {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 200;
    width: 200px;
    pointer-events: none;
    transition: transform 0.08s linear;
  }
</style>
