<script lang="ts">
  /**
   * 元素面板（左栏，第十一轮结构定稿）：ul = 创建行（新元素文本框**兼过滤器** + 🎲 + ➕，
   * 拉满与 button 同宽）→ 元素行（缩进行 button 内短竖线；li 左垫 = depth×14）。
   * 行上无任何操作控件（行内滑块已退役）；滑块只在高度（区间）元素的展开内容里。
   * 选中即进入绘制；空白点击/Esc 收起。右键菜单：复制一个、删除。
   * 内滚：.grid overflow-y auto。组织模式展开区只有上移/下移（无缩进/提升）。
   */
  import { tick } from 'svelte';
  import type { Region, World } from '../../core/types';
  import { rebuildHeightIntervalElements } from '../../core/layer/heightElements';
  import { childLayerIdOf } from '../../core/regionOps';
  import ItemButton from './ItemButton.svelte';
  import CapsuleSlider from './CapsuleSlider.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import CreateRow from './CreateRow.svelte';
  import { ROW_EST, VIRTUAL_MIN, listWindow } from './virtualList';
  import { measureSlot } from './liftDrag';
  import OrganizeRow from './OrganizeRow.svelte';

  let {
    world,
    focusLayer = 'cells',
    selectedRegionId = null,
    expandedIds = $bindable(new Set<string>()),
    drawActive = false,
    brushRadius = 1.5,
    newName = '',
    taskMode = 'check',
    onSelect,
    onDelete,
    onPaintValue,
    onRadius,
    onCreate,
    onRandomName,
    onNewName,
    onOrganize,
    onMoveItem,
    onCopyItem,
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
    /** 工作区三模式（2026-09-30 拍板：检查 / 生成 / 绘制；胶囊已上移至左栏顶） */
    taskMode?: 'check' | 'gen' | 'draw' | 'organize';
    onSelect: (id: string | null) => void;
    onDelete: (id: string) => void;
    /** 区间型元素滑块联动：涂改值 = 滑块数字（滑块在展开内容，第十一轮） */
    onPaintValue?: (id: string, value: number) => void;
    onRadius?: (v: number) => void;
    onCreate?: (name: string) => void;
    /** 随机名（返回生成的名字，顶层文本框回填；同时写全局供子级创建框） */
    onRandomName?: () => string;
    onNewName?: (v: string) => void;
    /** 组织模式四操作（拖动已退役，2026-09-30） */
    onOrganize?: (action: 'up' | 'down' | 'indent' | 'unindent', id: string) => void;
    /** 右键菜单：上移/下移一层（dir=-1 上移） */
    onMoveItem?: (id: string, dir: -1 | 1) => void;
    /** 右键菜单：复制一个 */
    onCopyItem?: (id: string) => void;
    /** 图层树聚焦行下方的模式展开内容（检查=InspectSection / 生成=GenerateSection / 绘制=不传=空） */
    layerPanel?: import('svelte').Snippet;
    /** 元素树选中行下方的模式展开内容（检查=InspectSection / 生成=元素级生成占位；绘制=本地绘制参数区） */
    elementPanel?: import('svelte').Snippet;
    /** globe = 球面纯展示：隐藏创建行（列表/搜索/面板仍可用） */
    mode?: 'plane' | 'globe';
  } = $props();

  /**
   * 过滤器 = 本面板创建行文本（2026-10-01 用户定：两面板各自只搜自己，互不影响）。
   * 顶层创建行用局部 text（子级 CreateBox 已随子元素功能删除，2026-10-01）。
   */
  let text = $state('');
  const filter = $derived(text);

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
  };

  function childLayerFor(region: Region): string | null {
    if (!world) return null;
    return childLayerIdOf(world, region.layerId);
  }
  function canExpand(r: Region): boolean {
    return !!childLayerFor(r);
  }
  const roots = $derived.by(() => {
    if (!world) return [] as Node[];
    const all = world.regions.filter((r) => r.layerId === focusLayer);
    const tops = all.filter((r) => {
      if (!r.parentId) return true;
      const p = world.regions.find((x) => x.id === r.parentId);
      return !p || p.layerId !== focusLayer;
    });
    // 2026-10-01 用户拍板：子元素显示与子级创建先删（之后重新设计）→ 节点不再嵌套
    const build = (r: Region, depth: number, parentId: string | null): Node => ({
      region: r,
      depth,
      parentId,
      expandable: canExpand(r),
    });
    // 列表 = 叠放的**反序**（顶部 = 后画/最高）：绘制序 = 数组序（低者先画），
    // 工作区顶部 = 数组末 = 绘制最上层（与图层面板同一约定：上 = 高）
    const tree = tops.reverse().map((r) => build(r, 0, null));
    // 名称过滤（C4）：本级命中保留（子级行已随子元素显示一起删除）
    const q = filter.trim().toLowerCase();
    if (!q) return tree;
    return tree.filter((n) => n.region.name.toLowerCase().includes(q));
  });

  /** 可见行（单列网格渲染源）：子元素行已删（2026-10-01）→ 本级平铺，无递归 */
  const visibleFlat = $derived.by(() => {
    const out: { node: Node; open: boolean }[] = [];
    for (const n of roots) {
      out.push({ node: n, open: n.expandable && expandedIds.has(n.region.id) });
    }
    return out;
  });

  /** 单列网格的全部格：行（ItemButton）+ 选中行后的模式展开区（panel）。
   *  子级建子行（CreateBox）随子元素功能一起删除（2026-10-01）。 */
  const cells = $derived.by(() => {
    const acc: { kind: 'row'; node: Node }[] = [];
    for (const v of visibleFlat) acc.push({ kind: 'row', node: v.node });
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
  /** 每元素涂改值（初始 = 区间 min）——$state 保证滑块值回显。
   *  第十一轮：滑块从 button 移入展开内容（行已选中，不再 handleSelect 触发开合）。 */
  const paintValues = $state<Record<string, number>>({});
  function paintValueOf(id: string, attrs: { min: number }): number {
    return paintValues[id] ?? attrs.min;
  }
  function onSliderValue(id: string, v: number) {
    paintValues[id] = v;
    onPaintValue?.(id, v);
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

  // 行内容（名称换行/改名）变化后统一行高：MutationObserver 稳定触发（等高保留；拖动已退役）
  $effect(() => {
    const el = listEl;
    if (!el) return;
    measureSlot(el);
    const mo = new MutationObserver(() => {
      measureSlot(el);
    });
    mo.observe(el, { subtree: true, childList: true, characterData: true });
    return () => mo.disconnect();
  });

  // —— 组织模式（2026-09-30 第十轮：替代拖动；第十一轮：同级判定 + 元素只留上移/下移）——
  /** 同级判定（按显示列表）：first = 无上一个同级（上移禁用）；last = 无下一个同级（下移禁用）；
   *  top = 顶层（元素面板已不渲染提升钮，保留占位）。 */
  function organizeFlagsOf(id: string): { first: boolean; last: boolean; top: boolean } {
    if (isFreeLayer) {
      const i = pathItems.findIndex((p) => p.id === id);
      return { first: i <= 0, last: i < 0 || i >= pathItems.length - 1, top: true };
    }
    const idx = visibleFlat.findIndex((v) => v.node.region.id === id);
    if (idx < 0) return { first: true, last: true, top: true };
    const pid = visibleFlat[idx].node.parentId;
    const first = !visibleFlat.slice(0, idx).some((v) => v.node.parentId === pid);
    const last = !visibleFlat.slice(idx + 1).some((v) => v.node.parentId === pid);
    const r = world?.regions.find((x) => x.id === id);
    return { first, last, top: !r?.parentId };
  }

  /** 该行模式展开区是否非空（第十一轮：展开后为空 → 直接不能展开）。
   *  组织 / 绘制（笔刷区恒有）/ 检查（InspectSection 恒有）恒非空；
   *  生成 = 子元素相关功能已删（2026-10-01 拍板先删、之后重设计）→ 恒不可展开。 */
  function modeBodyOf(_id: string): boolean {
    return taskMode !== 'gen';
  }
</script>

{#if !world}
  <div class="sec-root">
    <p class="dim pad">世界尚未生成。</p>
  </div>
{:else}
  <!-- 第七轮：身份行已删（首行 = 新元素 CreateRow）；面板名与开合由左栏 ExpandPanel 承担 -->
  <div class="sec-root">
    <div class="ws" onclick={onBlankClick}>
      <!-- 空态（图层行再点=取消聚焦后回此态）；创建行常驻（聚焦时）——文本框兼过滤器 -->
      {#if !focusLayer}
        <p class="dim-pad">点击左侧图层查看或创建其元素</p>
      {:else}
        <div class="create">
          <CreateRow
            placeholder="新元素"
            newName={text}
            canCreate={mode === 'plane' && !isHeight}
            onNewName={(v) => (text = v)}
            onRandom={() => {
              const n = onRandomName?.();
              if (n) text = n;
            }}
            onCreate={() => {
              onCreate?.(text);
              text = '';
            }}
          />
        </div>
      {/if}

      {#snippet itemBtn(
        id: string,
        name: string,
        color: string,
        ia: { lo: number; hi: number; min: number } | null,
        open: boolean,
        body: import('svelte').Snippet | null,
        depth: number,
      )}
        <ItemButton
          logoColor={color}
          name={name}
          {depth}
          selected={selectedRegionId === id}
          {open}
          content={body}
          onClick={() => {
            handleSelect(id);
            if (ia && taskMode === 'draw') onPaintValue?.(id, paintValueOf(id, ia));
          }}
          onMenu={(e) => openMenu(e, id)}
        />
      {/snippet}

      {#snippet cellNode(c: { kind: 'row' | 'create'; node: Node }, i: number)}
        {@const n = c.node}
        {@const id = n.region.id}
        <li
          class="cell"
          class:create={c.kind === 'create'}
          class:open={c.kind === 'row' && selectedRegionId === id}
          data-row-id={c.kind === 'row' ? id : undefined}
          data-kind={c.kind === 'row' ? 'region' : 'create'}
          style="padding-left:{n.depth * 14}px"
        >
          {#if c.kind === 'row'}
            <!-- 第八轮：行按钮自身 = 把手（原地展开，不另起 panel 行） -->
            {#snippet rowBody()}
              {#if taskMode === 'organize'}
                {@const flags = organizeFlagsOf(id)}
                <!-- 第十一轮：元素面板不提供缩进/提升（只上移/下移） -->
                <OrganizeRow
                  name={n.region.name}
                  first={flags.first}
                  last={flags.last}
                  top={flags.top}
                  onMove={(dir) => onOrganize?.(dir === -1 ? 'up' : 'down', id)}
                />
              {:else if taskMode === 'draw'}
                <!-- 2026-10-01：去框去说明——只留控件（状态栏已有操作指引） -->
                {@const ia = intervalAttrs(n.region)}
                <div class="mpanel">
                  {#if ia}
                    <label class="field inline">
                      <span>高度</span>
                      <CapsuleSlider
                        min={ia.lo}
                        max={ia.hi}
                        step={1}
                        value={paintValueOf(id, ia)}
                        label="{n.region.name} 涂改高度"
                        width={130}
                        onInput={(v) => onSliderValue(id, v)}
                      />
                    </label>
                  {/if}
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
                </div>
              {:else if elementPanel}
                {@render elementPanel()}
              {/if}
            {/snippet}
            {@render itemBtn(
              id,
              n.region.name,
              n.region.color,
              intervalAttrs(n.region),
              selectedRegionId === id,
              selectedRegionId === id && modeBodyOf(id) ? rowBody : null,
              n.depth,
            )}
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
          <!-- 第八轮：路径行同款把手化；第十一轮：组织模式可展开（上移/下移，路径无层级）；
               绘制模式不再有提示段落（状态栏给指引）→ 绘制态不展开 -->
          {#snippet pathBody()}
            {#if taskMode === 'organize'}
              {@const flags = organizeFlagsOf(p.id)}
              <OrganizeRow
                name={p.name}
                first={flags.first}
                last={flags.last}
                top={flags.top}
                onMove={(dir) => onOrganize?.(dir === -1 ? 'up' : 'down', p.id)}
              />
            {/if}
          {/snippet}
          <li
            class="cell"
            class:open={selectedRegionId === p.id}
            data-row-id={p.id}
            data-kind="path"
          >
            {@render itemBtn(
              p.id,
              p.name,
              p.color,
              null,
              selectedRegionId === p.id,
              selectedRegionId === p.id && taskMode === 'organize' ? pathBody : null,
              0,
            )}
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
  /* 第七轮：身份行 header 已删（首行 = 新元素）；面板头 = 左栏 ExpandPanel 把手 */
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
    padding: 4px 1px; /* 与列表同宽；第十一轮：左右间距再调小 */
  }
  /* 第八轮：选中行原地展开（li 高度随把手内容自适应；等高机制只测头部） */
  .cell.open {
    height: auto;
  }
  .mpanel {
    /* 2026-10-01：去框去底——展开内容不套框，行间用间距 */
    display: flex;
    flex-direction: column;
    gap: 6px;
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
    padding: 1px; /* 第十一轮：左右间距再调小（用户定） */
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
    font-size: 11px;
  }
</style>
