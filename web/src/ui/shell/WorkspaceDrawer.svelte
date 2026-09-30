<script lang="ts">
  /**
   * 工作区：PanelShell 壳 + 单列网格 ItemButton 行。
   * 行 = 眼睛 + 元素色 + 名称（+ 可选控件：区间元素 = 胶囊滑块）。
   * 选中即进入绘制；空白点击/Esc/完成退出。
   * 右键菜单：显示/隐藏、上移一层、下移一层、复制一个、删除。
   * 拖动 = 长按进度条解锁 → 整个按钮被拿起来（浮动件跟指针）→ 目标格与下方元素让一格
   *（transform + 过渡动画）→ 松手触发重排重算。
   */
  import { tick } from 'svelte';
  import type { Region, World } from '../../core/types';
  import { LAYER_META } from '../workbench/layerMeta';
  import { rebuildHeightIntervalElements } from '../../core/layer/heightElements';
  import { childLayerIdOf } from '../../core/regionOps';
  import { diplomacyBadge } from '../../core/diplomacy';
  import { defaultLayerVisible } from '../../core/displayCompose';
  import ItemButton from './ItemButton.svelte';
  import CapsuleSlider from './CapsuleSlider.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import CreateRow from './CreateRow.svelte';
  import CreateBox from './CreateBox.svelte';
  import { ROW_EST, VIRTUAL_MIN, listWindow } from './virtualList';
  import { liftTransforms, insertIndex, insertPlan, measureSlot, SLOT, type FlatRow, type RowRect } from './liftDrag';

  let {
    world,
    focusLayer = 'cells',
    selectedRegionId = null,
    expandedIds = $bindable(new Set<string>()),
    drawActive = false,
    brushRadius = 1.5,
    newName = '',
    taskMode = 'check',
    globeLocked = false,
    onSelect,
    onDelete,
    onPaintValue,
    onRadius,
    onTaskMode,
    onCreate,
    onCreateChild,
    onRandomName,
    onNewName,
    onRegionDrag,
    onMoveItem,
    onCopyItem,
    onToggleHidden,
    onUndo,
    onRedo,
    layerPanel,
    elementPanel,
    mode = 'plane',
  }: {
    world: World | null;
    focusLayer?: string;
    selectedRegionId?: string | null;
    expandedIds?: Set<string>;
    drawActive?: boolean;
    brushRadius?: number;
    newName?: string;
    /** 工作区三模式（2026-09-30 拍板：检查 / 生成 / 绘制） */
    taskMode?: 'check' | 'gen' | 'draw';
    /** 球面视图锁定检查模式 */
    globeLocked?: boolean;
    onSelect: (id: string | null) => void;
    onDelete: (id: string) => void;
    /** 区间型元素滑块联动：滑动即选定该元素 + 涂改值 = 滑块数字（仅绘制模式行内显示） */
    onPaintValue?: (id: string, value: number) => void;
    onRadius?: (v: number) => void;
    onTaskMode?: (m: 'check' | 'gen' | 'draw') => void;
    onCreate?: () => void;
    onCreateChild?: (parentId: string) => void;
    onRandomName?: () => void;
    onNewName?: (v: string) => void;
    onRegionDrag?: (fromId: string, hint: import('../../core/regionOps').DropHint) => void;
    /** 右键菜单：上移/下移一层（dir=-1 上移） */
    onMoveItem?: (id: string, dir: -1 | 1) => void;
    /** 右键菜单：复制一个 */
    onCopyItem?: (id: string) => void;
    /** 右键菜单：显隐切换 */
    onToggleHidden?: (id: string) => void;
    /** 工具带 undo/redo（D1′：接现有 editor.undo/redo，不造新能力） */
    onUndo?: () => void;
    onRedo?: () => void;
    /** 图层树聚焦行下方的模式展开内容（检查=InspectSection / 生成=GenerateSection / 绘制=不传=空） */
    layerPanel?: import('svelte').Snippet;
    /** 元素树选中行下方的模式展开内容（检查=InspectSection / 生成=元素级生成占位；绘制=本地绘制参数区） */
    elementPanel?: import('svelte').Snippet;
    /** globe = 球面纯展示：隐藏创建行（列表/搜索/面板仍可用） */
    mode?: 'plane' | 'globe';
  } = $props();

  /** 元素名搜索（C4/2026-09-30：默认收起为 🔍 按钮，点击展开搜索框） */
  let filter = $state('');
  let searchOpen = $state(false);
  let searchEl: HTMLInputElement | undefined = $state();
  function toggleSearch() {
    searchOpen = !searchOpen;
    if (searchOpen) queueMicrotask(() => searchEl?.focus());
    else filter = '';
  }

  const meta = $derived(LAYER_META[focusLayer]);
  const isHeight = $derived(focusLayer === 'height');
  const isFreeLayer = $derived(
    focusLayer === 'road' || focusLayer === 'route' || focusLayer === 'river',
  );

  /** 自由路径层：列出 paths（与 cell 无关）；名称过滤（C4） */
  const pathItems = $derived(
    world && isFreeLayer
      ? (world.paths ?? []).filter(
          (p) => p.layerId === focusLayer && p.name.toLowerCase().includes(filter.trim().toLowerCase()),
        )
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
        kids: expandable ? kidsOf(r).reverse().map((c) => build(c, depth + 1, r.id)) : [],
      };
    };
    // 列表 = 叠放的**反序**（顶部 = 后画/最高）：绘制序 = 数组序（低者先画），
    // 工作区顶部 = 数组末 = 绘制最上层（与图层面板同一约定：上 = 高）
    const tree = tops.reverse().map((r) => build(r, 0, null));
    // 名称过滤（C4）：本体命中保留整支；子命中保留祖先路径；两者皆无则摘除
    const q = filter.trim().toLowerCase();
    if (!q) return tree;
    const keep = (n: Node): Node | null => {
      if (n.region.name.toLowerCase().includes(q)) return n;
      const kids = n.kids.map(keep).filter((x): x is Node => !!x);
      return kids.length ? { ...n, kids } : null;
    };
    return tree.map(keep).filter((x): x is Node => !!x);
  });

  /** 展开路径上的可见行（单列网格渲染源） */
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

  const flatRows = $derived(
    visibleFlat.map((v) => ({ id: v.node.region.id, parentId: v.node.parentId }) as FlatRow),
  );

  /** 单列网格的全部格：行（ItemButton）+ 展开时的建子行（CreateBox）+ 选中行后的模式展开区（panel） */
  const cells = $derived.by(() => {
    const acc: { kind: 'row' | 'create' | 'panel'; node: Node }[] = [];
    for (const v of visibleFlat) {
      acc.push({ kind: 'row', node: v.node });
      if (selectedRegionId && v.node.region.id === selectedRegionId) {
        acc.push({ kind: 'panel', node: v.node });
      }
      if (v.open && v.node.expandable) acc.push({ kind: 'create', node: v.node });
    }
    return acc;
  });

  let scrollTop = $state(0);
  let listH = $state(360);
  const virtualMode = $derived(
    isFreeLayer ? pathItems.length >= VIRTUAL_MIN : cells.length >= VIRTUAL_MIN,
  );
  const pathWin = $derived(
    isFreeLayer && pathItems.length >= VIRTUAL_MIN
      ? listWindow(pathItems.length, scrollTop, listH, ROW_EST)
      : null,
  );
  const pathSlice = $derived(pathWin ? pathItems.slice(pathWin.start, pathWin.end) : pathItems);
  const vwin = $derived(virtualMode ? listWindow(cells.length, scrollTop, listH, ROW_EST) : null);
  const vSlice = $derived(virtualMode && vwin ? cells.slice(vwin.start, vwin.end) : cells);

  let enterId: string | null = $state(null);
  let createPulseParent: string | null = $state(null);
  let listEl: HTMLElement | undefined = $state();

  $effect(() => {
    // 只补缺失的高度区间元素；禁止依赖 world.regions 的条件重建（会无限触发）
    if (world && isHeight) {
      const has = world.regions.some(
        (r) => r.layerId === 'height' && r.attributes?.kind === 'interval',
      );
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
  function intervalAttrs(r: {
    attributes?: Record<string, unknown>;
  }): { lo: number; hi: number; min: number } | null {
    const a = r.attributes;
    if (!a || a.kind !== 'interval') return null;
    const lo = typeof a.lo === 'number' ? a.lo : 0;
    const hi = typeof a.hi === 'number' ? a.hi : 1;
    const min = typeof a.min === 'number' ? a.min : lo;
    return { lo, hi, min };
  }
  /** 每元素涂改值（初始 = 区间 min）——$state 保证滑块值回显 */
  const paintValues = $state<Record<string, number>>({});
  function paintValueOf(id: string, attrs: { min: number }): number {
    return paintValues[id] ?? attrs.min;
  }
  function onSliderInput(id: string, v: number) {
    paintValues[id] = v;
    handleSelect(id);
    onPaintValue?.(id, v);
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

  /**
   * 选中与展开（C1 改写，2026-09-30 拍板）：单击 = 选中并展开（单开：再点一次收起）；
   * 绘制模式下选中即被绘制（App 侧推导 startDraw）；检查/生成模式只查看/看参数。
   * 双击不再有独立语义（原「双击进绘制」退役——绘制入口 = 绘制模式）。
   */
  function handleSelect(id: string) {
    if (selectedRegionId === id) onSelect(null); // 再点收起 = 单开互斥
    else onSelect(id);
    const r = world?.regions.find((x) => x.id === id);
    if (r && selectedRegionId !== id && canExpand(r)) toggleExpand(id);
  }

  /** 点击面板空白处 = 无选中元素 = 收起（绘制退出由 App 推导） */
  function onBlankClick(e: MouseEvent) {
    const t = e.target as HTMLElement;
    if (t.closest('button') || t.closest('input') || t.closest('.ibtn')) return;
    if (selectedRegionId) onSelect(null as unknown as string);
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

  function diploBadgeOf(r: Region): string {
    return world && focusLayer === 'country' ? (diplomacyBadge(world, r) ?? '') : '';
  }

  // —— 右键菜单 ——
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  function openMenu(e: MouseEvent, id: string) {
    // 右键菜单简化（2026-09-30 拍板 3）：信息/显示参数 → 检查模式展开区；
    // 显隐 → 行内 eye；上移/下移 → 长按拖动。只留无其他入口的复制/删除。
    const reg = world?.regions.find((x) => x.id === id);
    const derived = !!reg && !!intervalAttrs(reg);
    const items: MenuItem[] = [
      {
        id: 'copy',
        label: derived ? '复制一个（派生项不可复制）' : '复制一个',
        disabled: derived,
        action: () => onCopyItem?.(id),
      },
      {
        id: 'del',
        label: derived ? '删除（派生项不可删）' : '删除',
        danger: !derived,
        disabled: derived,
        action: () => onDelete(id),
      },
    ];
    menu = { x: e.clientX, y: e.clientY, items };
  }

  // —— 抬起式拖动 ——
  let dragId: string | null = $state(null);
  let dragIndex = -1;
  let lift = $state<{ x: number; y: number; name: string; color: string } | null>(null);
  let offsets = $state<number[]>([]);
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

  /** 拖动按格序：行与建子行都占格；可拖的只有行。 */
  function slotsForDrag(): FlatRow[] {
    return isFreeLayer
      ? pathItems.map((p) => ({ id: p.id, parentId: null }))
      : cells.map((c) => ({ id: c.node.region.id, parentId: c.node.parentId }));
  }
  /** 插入语义只看行：格下标 → 行序位（跳过建子行） */
  function rowPosOf(cellIdx: number): number {
    if (isFreeLayer) return cellIdx;
    let n = 0;
    for (let i = 0; i < cellIdx && i < cells.length; i++) if (cells[i].kind === 'row') n++;
    return n;
  }
  const flatRowList = $derived(
    isFreeLayer
      ? pathItems.map((p) => ({ id: p.id, parentId: null }) as FlatRow)
      : cells.filter((c) => c.kind === 'row').map((c) => ({ id: c.node.region.id, parentId: c.node.parentId }) as FlatRow),
  );

  async function onRowHold(id: string, start: { x: number; y: number }) {
    const rows = slotsForDrag();
    dragIndex = rows.findIndex((r) => r.id === id);
    if (dragIndex < 0) return;
    slot = measureSlot(listEl);
    dragId = id;
    dragReady = false;
    const reg = world?.regions.find((x) => x.id === id);
    const path = world?.paths?.find((x) => x.id === id);
    lift = {
      x: start.x,
      y: start.y,
      name: reg?.name ?? path?.name ?? id,
      color: reg?.color ?? path?.color ?? '#888',
    };
    offsets = liftTransforms(rows.length, dragIndex, dragIndex, slot);
    await tick();
    // 拖动起点缓存行矩形（虚拟窗口之前的行由 windowStart 兜底）
    rectCache = [];
    let ci = windowStart();
    for (const el of listEl?.querySelectorAll<HTMLElement>('li.cell') ?? []) {
      const r = el.getBoundingClientRect();
      rectCache.push({ idx: ci++, top: r.top, bottom: r.bottom });
    }
    dragReady = true;
  }

  function onRowMove(e: PointerEvent) {
    if (!dragId || !dragReady || !lift) return;
    lift = { x: e.clientX, y: e.clientY, name: lift.name, color: lift.color };
    const rows = slotsForDrag();
    const k = insertIndex(rectCache, dragIndex, windowStart(), e.clientY);
    offsets = liftTransforms(rows.length, dragIndex, k, slot);
  }

  function onRowEnd(e: PointerEvent) {
    const rows = slotsForDrag();
    if (dragId && dragReady && onRegionDrag && !isFreeLayer) {
      const k = insertIndex(rectCache, dragIndex, windowStart(), e.clientY);
      // 列表 = 叠放反序：显示坐标映射回数组坐标（reverse）再规划插入位置
      const arr = [...flatRowList].reverse();
      const dArr = arr.length - 1 - rowPosOf(dragIndex);
      const kArr = arr.length - rowPosOf(k);
      onRegionDrag(dragId, insertPlan(arr, dArr, kArr));
    }
    dragId = null;
    dragIndex = -1;
    lift = null;
    offsets = [];
    rectCache = [];
    dragReady = false;
  }

  /** 虚拟窗口首行绝对下标（窗口前的行必在指针上方） */
  function windowStart(): number {
    return (pathWin?.start ?? vwin?.start ?? 0) as number;
  }


  function offsetOf(i: number): number {
    return offsets[i] ?? 0;
  }
</script>

{#if !world}
  <div class="sec-root">
    <header class="hd"><span class="ico">🗂</span><span class="nm">工作区</span></header>
    <p class="dim pad">世界尚未生成。</p>
  </div>
{:else}
  {@const hd = activeHeader()}
  <!-- 工作区（2026-09-30 三模式重构）：头部(标题+undo/redo) → 模式 tab → 树区（创建/搜索 + 列表） -->
  <div class="sec-root">
    <header class="hd">
      <span class="ico">{hd.icon}</span>
      <span class="nm">工作区 · {hd.title}</span>
      <button type="button" class="ur" title="撤销 (Ctrl+Z)" onclick={() => onUndo?.()}>↶</button>
      <button type="button" class="ur" title="重做 (Ctrl+Y)" onclick={() => onRedo?.()}>↷</button>
    </header>

    <!-- 三模式 tab（检查 / 生成 / 绘制）；球面锁定检查 -->
    <div class="mtabs" role="tablist" aria-label="工作区模式">
      {#each [{ k: 'check', l: '🔍 检查' }, { k: 'gen', l: '🎲 生成' }, { k: 'draw', l: '✏️ 绘制' }] as t (t.k)}
        <button
          type="button"
          role="tab"
          class="mtab"
          class:on={taskMode === t.k}
          aria-selected={taskMode === t.k}
          disabled={globeLocked && t.k !== 'check'}
          title={globeLocked && t.k !== 'check' ? '球面为纯展示，仅检查模式可用' : undefined}
          onclick={() => onTaskMode?.(t.k as 'check' | 'gen' | 'draw')}>{t.l}</button
        >
      {/each}
    </div>

    <div class="ws" onclick={onBlankClick}>
      <!-- 段2 新增元素（仅平面编辑模式） + 搜索按钮（默认收起，点击展开输入框） -->
      {#if mode === 'plane' && !isHeight}
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
      <div class="filter">
        {#if searchOpen}
          <input
            type="search"
            placeholder="搜索元素…"
            bind:this={searchEl}
            bind:value={filter}
            onkeydown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                toggleSearch();
              }
            }}
          />
          <button type="button" class="search-x" title="收起搜索" onclick={toggleSearch}>✕</button>
        {:else}
          <button type="button" class="search-open" onclick={toggleSearch}>🔍 搜索元素</button>
        {/if}
      </div>

      {#snippet itemBtn(
        id: string,
        name: string,
        color: string,
        badge: string,
        hidden: boolean,
        ia: { lo: number; hi: number; min: number } | null,
      )}
        <ItemButton
          visible={!hidden && layerVisibleOf(focusLayer)}
          onEye={() => onToggleHidden?.(id)}
          logoColor={color}
          name={name}
          badge={badge}
          selected={selectedRegionId === id}
          dragging={dragId === id}
          onClick={() => {
            handleSelect(id);
            if (ia && taskMode === 'draw') onPaintValue?.(id, paintValueOf(id, ia));
          }}
          onMenu={(e) => openMenu(e, id)}
          onHold={(s) => onRowHold(id, s)}
          onDragMove={onRowMove}
          onDragEnd={onRowEnd}
        >
          {#snippet control()}
            {#if ia && taskMode === 'draw'}
              <CapsuleSlider
                min={ia.lo}
                max={ia.hi}
                step={1}
                value={paintValueOf(id, ia)}
                label="{name} 涂改高度"
                width={130}
                onInput={(v) => onSliderInput(id, v)}
              />
            {/if}
          {/snippet}
        </ItemButton>
      {/snippet}

      {#snippet cellNode(c: { kind: 'row' | 'create' | 'panel'; node: Node }, i: number)}
        {@const n = c.node}
        {@const id = n.region.id}
        <li
          class="cell"
          class:create={c.kind === 'create'}
          class:panel={c.kind === 'panel'}
          data-row-id={c.kind === 'row' ? id : undefined}
          data-kind={c.kind === 'row' ? 'region' : c.kind}
          style="transform:translateY({offsetOf(i)}px);padding-left:{n.depth * 14}px"
        >
          {#if c.kind === 'row'}
            {@render itemBtn(
              id,
              n.region.name,
              n.region.color,
              diploBadgeOf(n.region),
              !!n.region.hidden,
              intervalAttrs(n.region),
            )}
          {:else if c.kind === 'panel'}
            <!-- 模式展开区（单开 = 选中行下方）：绘制=本地绘制参数（值滑块在行内）；检查/生成=App 注入 -->
            {#if taskMode === 'draw'}
              <div class="mpanel">
                {#if isFreeLayer}
                  <p class="dim hint">点曲线加点 · 拖控制点 · Esc 收起退出编辑</p>
                {:else}
                  <label class="field inline">
                    <span>笔刷</span>
                    <CapsuleSlider
                      min={0.3}
                      max={8}
                      step={0.1}
                      value={brushRadius}
                      label="笔刷宽度"
                      width={130}
                      onInput={(v) => onRadius?.(v)}
                    />
                    <span class="dim">{brushRadius.toFixed(1)}°</span>
                  </label>
                  <p class="dim hint">
                    {intervalAttrs(n.region)
                      ? '左键刷选定值 · 空白点击 / Esc 收起退出'
                      : '左键加地块 · Shift 移除 · 空白点击 / Esc 收起退出'}
                  </p>
                {/if}
              </div>
            {:else if elementPanel}
              {@render elementPanel()}
            {/if}
          {:else}
            <div class="create-slot" class:pulse={createPulseParent === id}>
              <CreateBox
                placeholder={`新${childNameOf(n.region)}`}
                {newName}
                onNewName={(v) => onNewName?.(v)}
                onRandom={() => onRandomName?.()}
                onCreate={() => handleCreateChild(id)}
              />
            </div>
          {/if}
        </li>
      {/snippet}

      {#if isFreeLayer}
        <p class="dim-pad">
          每个元素 = 一条曲线。点工作区元素选中后再画；➕ 可新建多条。Esc 退出编辑。
        </p>
        <ul
          class="grid"
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
          {#each pathWin ? pathSlice : pathItems as p, i (p.id)}
            <li
              class="cell"
              data-row-id={p.id}
              data-kind="path"
              style="transform:translateY({offsetOf((pathWin?.start ?? 0) + i)}px)"
            >
              {@render itemBtn(p.id, p.name, p.color, '', !!p.hidden, null)}
            </li>
          {/each}
          {#if pathWin}
            <li class="v-pad" style="height:{pathWin.padBottom}px" aria-hidden="true"></li>
          {/if}
          {#if !pathItems.length}
            <li class="dim-pad">暂无路径，在地图上绘制</li>
          {/if}
        </ul>
      {:else if virtualMode}
        <ul
          class="grid virtual"
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
          {#each vSlice as c, i (c.kind + c.node.region.id)}
            {@render cellNode(c, (vwin?.start ?? 0) + i)}
          {/each}
          {#if vwin}
            <li class="v-pad" style="height:{vwin.padBottom}px" aria-hidden="true"></li>
          {/if}
        </ul>
      {:else}
        <ul class="grid" role="list" bind:this={listEl}>
          {#each cells as c, i (c.kind + c.node.region.id)}
            {@render cellNode(c, i)}
          {/each}
        </ul>
      {/if}

      <!-- 过滤无结果（C4）：一句话提示而非空白 -->
      {#if filter.trim() && (isFreeLayer ? !pathItems.length : !cells.length)}
        <p class="dim-pad">没有匹配「{filter.trim()}」的元素</p>
      {/if}
    </div>

    {#if lift && dragId}
      <div class="lift" style="transform:translate({lift.x + 12}px,{lift.y - 20}px)">
        <ItemButton lift visible logoColor={lift.color} name={lift.name} />
      </div>
    {/if}

    {#if menu}
      <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
    {/if}
  </div>
{/if}

<style>
  .sec-root {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  /* 段 header（§3.1 示意的 `-工作区-` 行）：常驻，无按钮 */
  .hd {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--panel-border);
    flex: 0 0 auto;
  }
  .ico {
    font-size: 12px;
    line-height: 1;
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: 12px;
    color: var(--text-dim);
  }
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
    padding: 6px 6px 4px;
    border-bottom: 1px solid var(--panel-border);
  }
  /* 搜索行（按钮态 + 展开态）：默认收起为 🔍 按钮 */
  .filter {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--panel-border);
  }
  .filter input {
    flex: 1;
    min-width: 0;
    background: rgba(0, 0, 0, 0.35);
    color: var(--text, #ddd);
    border: 1px solid var(--panel-border);
    border-radius: 7px;
    padding: 3px 8px;
    font-size: 11px;
  }
  .filter input:focus {
    outline: none;
    border-color: rgba(240, 195, 106, 0.6);
  }
  .search-open,
  .search-x {
    flex: 1;
    text-align: left;
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-dim);
    border: 1px solid var(--panel-border);
    border-radius: 7px;
    padding: 3px 8px;
    font-size: 11px;
    cursor: pointer;
  }
  .search-open:hover {
    background: rgba(255, 255, 255, 0.09);
    color: var(--text);
  }
  .search-x {
    flex: 0 0 auto;
    text-align: center;
    padding: 3px 7px;
  }
  /* —— 模式 tab 行（检查/生成/绘制；2026-09-30 三模式） —— */
  .mtabs {
    display: flex;
    gap: 4px;
    padding: 6px 8px 0;
    flex: 0 0 auto;
  }
  .mtab {
    flex: 1;
    border: 1px solid var(--panel-border);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text-dim);
    border-radius: 999px;
    padding: 4px 6px;
    font-size: 11px;
    line-height: 1.2;
    cursor: pointer;
  }
  .mtab.on {
    background: rgba(240, 195, 106, 0.22);
    border-color: rgba(240, 195, 106, 0.65);
    color: var(--text, #ddd);
  }
  .mtab:disabled {
    opacity: 0.4;
    cursor: default;
  }
  /* 头部右端 undo/redo 小钮 */
  .ur {
    flex: 0 0 auto;
    border: 1px solid var(--panel-border);
    background: rgba(255, 255, 255, 0.06);
    color: var(--text-dim);
    border-radius: 6px;
    padding: 2px 7px;
    font-size: 12px;
    line-height: 1;
    cursor: pointer;
  }
  .ur:hover {
    background: rgba(255, 255, 255, 0.12);
    color: var(--text);
  }
  /* 模式展开区（panel 节点，可变高） */
  .cell.panel {
    height: auto;
    padding-top: 2px;
    padding-bottom: 4px;
  }
  .mpanel {
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
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
  /* 单列网格：一格 = 一个 ItemButton；元素列表 = 工作区段的 flex-1 内滚区（§3.1）
     padding/gap 与图层列表一致（2026-09-30 紧凑统一） */
  .grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    scrollbar-width: none;
    list-style: none;
    margin: 0;
    padding: 6px;
    display: grid;
    grid-template-columns: 1fr;
    gap: 4px;
    align-content: start;
  }
  .grid::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
  .grid.virtual {
    overflow: auto;
    scrollbar-width: none;
  }
  .grid.virtual::-webkit-scrollbar {
    width: 0;
    display: none;
  }
  .grid.virtual .v-pad {
    list-style: none;
    margin: 0;
    padding: 0;
    pointer-events: none;
  }
  .cell {
    margin: 0;
    height: var(--ibtn-h, 40px);
    transition: transform 0.18s ease;
  }
  .cell.create {
    height: var(--ibtn-h, 40px);
    display: flex;
    align-items: center;
  }
  .create-slot {
    flex: 1;
    display: flex;
    align-items: center;
    padding: 0;
  }
  .create-slot.pulse {
    animation: createDrop 0.32s ease;
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
  .lift {
    position: fixed;
    left: 0;
    top: 0;
    z-index: 200;
    width: 280px;
    pointer-events: none;
    transition: transform 0.08s linear;
  }

  .hint {
    margin: 4px 0 0;
  }
</style>
