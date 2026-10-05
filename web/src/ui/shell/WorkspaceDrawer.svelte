<script lang="ts">
  /**
   * 元素面板（左栏，第十一轮结构定稿）：ul = 创建行（新元素文本框**兼过滤器** + 🎲 + ➕，
   * 拉满与 button 同宽）→ 元素行（缩进行 button 内短竖线；li 左垫 = depth×14）。
   * 行上无任何操作控件（行内滑块已退役）；滑块只在高度（区间）元素的展开内容里。
   * 选中即进入绘制；空白点击/Esc 收起。右键菜单：复制一个、删除。
   * 内滚：.grid overflow-y auto。组织模式展开区只有上移/下移（无缩进/提升）。
   */
  import { editor } from '../../app/store.svelte';
  import { tick } from 'svelte';
  import type { Region, World } from '../../core/types';
  import { rebuildHeightIntervalElements, heightIntervalRegions } from '../../core/layer/heightElements';
  import { editsHeightAt } from '../../core/layer/flags';
  import { isFreeLayerId } from '../../core/displayCompose';
  import { childLayerIdOf } from '../../core/hierarchy/derive';
  import ItemButton from './ItemButton.svelte';
  import StateCapsule from './StateCapsule.svelte';
  import ModeCapsule from './ModeCapsule.svelte';
  import CapsuleSlider from './CapsuleSlider.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import CreateRow from './CreateRow.svelte';
  import { ROW_EST, VIRTUAL_MIN, listWindow } from './virtualList';
  import { measureSlot } from './liftDrag';
import { isRowOrControlClick } from './shell';
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
    /** 区间型元素滑块联动：涂改值 = 滑块数字（滑块在展开内容，第十一轮） */
    /** 随机名（返回生成的名字，顶层文本框回填；同时写全局供子级创建框） */
    /** 组织模式四操作（拖动已退役，2026-09-30） */
    /** 右键菜单：上移/下移一层（dir=-1 上移） */
    /** 右键菜单：复制一个 */
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

  const isHeight = $derived(editsHeightAt(world, focusLayer));

  /** 点选核心（两种形态统一「地图点格」，选项1）：再点同一键 = 取消模态 */
  function corePickT(regionId: string, mode: 'cell' | 'child') {
    if (editor.centerPickId === regionId && editor.centerPickMode === mode) editor.cancelCenterPick();
    else editor.beginCenterPick(regionId, mode);
  }
  const isFreeLayer = $derived(isFreeLayerId(world, focusLayer));

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

  /** 同父分组（2026-10-06 用户定）：焦点层为子图层 → 同父元素聚拢 + 组头（父名小字居左）
   *  + 组间横分割线；顶层图层（无 parentLayerId）平铺不变。 */
  const groupedByParent = $derived(
    !!focusLayer && !!world?.layers.find((l) => l.id === focusLayer)?.parentLayerId,
  );

  /** 单列网格的全部格：行（ItemButton）+ 选中行后的模式展开区（panel）+ 分组头/分隔线。
   *  子级建子行（CreateBox）随子元素功能一起删除（2026-10-01）。 */
  const cells = $derived.by(() => {
    const acc: { kind: 'row' | 'head' | 'sep'; node: Node }[] = [];
    if (!groupedByParent) {
      for (const v of visibleFlat) acc.push({ kind: 'row', node: v.node });
      return acc;
    }
    // 稳定分区：无父组置顶，其后按父元素首见序（= 原叠放反序里的首次出现序）；
    // 组内保持原序（排序不改元素相对次序，只聚拢）
    const order: string[] = [];
    const buckets = new Map<string, { node: Node }[]>();
    for (const v of visibleFlat) {
      const pid = v.node.region.parentId ?? '';
      let b = buckets.get(pid);
      if (!b) {
        b = [];
        buckets.set(pid, b);
        order.push(pid);
      }
      b.push(v);
    }
    order.sort((a, b) => (a === '' ? 1 : 0) - (b === '' ? 1 : 0)); // 无父组置顶（合法弱序）
    const regionById = new Map(world!.regions.map((r) => [r.id, r]));
    let firstGroup = true;
    for (const pid of order) {
      const rows = buckets.get(pid)!;
      if (!rows.length) continue;
      if (!firstGroup) acc.push({ kind: 'sep', node: rows[0].node });
      firstGroup = false;
      if (pid) {
        const pr = regionById.get(pid);
        acc.push({
          kind: 'head',
          node: { region: pr ?? rows[0].node.region, depth: 0, parentId: null, expandable: false },
        });
      }
      for (const r of rows) acc.push({ kind: 'row', node: r.node });
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

  let listEl: HTMLElement | undefined = $state();

  $effect(() => {
    // 只补缺失的高度区间元素；禁止依赖 world.regions 的条件重建（会无限触发）
    if (world && isHeight && heightIntervalRegions(world).length === 0) {
      rebuildHeightIntervalElements(world);
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
  /** 高度笔刷模式/强度档（2026-10-06 拍板） */
  const HMODE_ITEMS = [
    { id: 'paint', icon: '🖌', label: '涂改' },
    { id: 'smooth', icon: '〰', label: '平滑' },
  ];
  const HITER_ITEMS = [
    { id: '1', icon: '1', label: '轻' },
    { id: '3', icon: '3', label: '中' },
    { id: '5', icon: '5', label: '强' },
  ];
  function paintValueOf(id: string, attrs: { min: number }): number {
    return paintValues[id] ?? attrs.min;
  }
  function onSliderValue(id: string, v: number) {
    paintValues[id] = v;
    editor.setHeightPaint(id, v);
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
    if (selectedRegionId === id) editor.selectElement(null); // 再点收起 = 单开互斥
    else editor.selectElement(id);
    const r = world?.regions.find((x) => x.id === id);
    if (r && selectedRegionId !== id && canExpand(r)) toggleExpand(id);
  }

  /** 点击面板空白处 = 无选中元素 = 收起（绘制退出由 App 推导）；守卫与图层面板同源 */
  function onBlankClick(e: MouseEvent) {
    if (isRowOrControlClick(e)) return;
    if (selectedRegionId) editor.selectElement(null);
  }

  // —— 右键菜单 ——
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  function openMenu(e: MouseEvent, id: string) {
    // 右键菜单简化（2026-09-30 拍板 3）：信息/显示参数 → 检查模式展开区；
    // 显隐 → 检查区开关；上移/下移 → 组织模式行内钮（拖动已退役）。只留无其他入口的复制/删除。
    const reg = world?.regions.find((x) => x.id === id);
    const derived = !!reg && !!intervalAttrs(reg);
    const items: MenuItem[] = [
      {
        id: 'copy',
        label: derived ? '复制一个（派生项不可复制）' : '复制一个',
        disabled: derived,
        action: () => editor.copyItem(id),
      },
      {
        id: 'del',
        label: derived ? '删除（派生项不可删）' : '删除',
        danger: !derived,
        disabled: derived,
        action: () => { editor.selectedRegionId = id; editor.deleteSelected(); },
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
              const n = editor.randomName(editor.focusLayer === 'province' ? 'province' : 'country');
              editor.newName = n;
              if (n) text = n;
            }}
            onCreate={() => {
              editor.newName = text;
              editor.createRegion(editor.focusLayer);
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
        hidden = false,
        badge = false,
      )}
        <ItemButton
          logoColor={color}
          name={name}
          {depth}
          selected={selectedRegionId === id}
          {hidden}
          {badge}
          {open}
          content={body ?? undefined}
          onClick={() => {
            handleSelect(id);
            if (ia && taskMode === 'draw') editor.setHeightPaint(id, paintValueOf(id, ia));
          }}
          onMenu={(e) => openMenu(e, id)}
        />
      {/snippet}

      {#snippet cellNode(c: { kind: 'row' | 'create' | 'head' | 'sep'; node: Node }, i: number)}
        {@const n = c.node}
        {@const id = n.region.id}
        {#if c.kind === 'sep'}
          <!-- 组间横分割线（不同父元素之间，2026-10-06） -->
          <li class="cell gsep" aria-hidden="true"></li>
        {:else if c.kind === 'head'}
          <!-- 组头：同父元素列表上方、居左小字 = 父元素名 -->
          <li class="cell ghead" data-kind="group-head">{n.region.name}</li>
        {:else}
        <li
          class="cell"
          class:create={c.kind === 'create'}
          class:open={c.kind === 'row' && selectedRegionId === id}
          title={taskMode === 'gen' && c.kind === 'row'
            ? '元素级生成待重新设计（2026-10-01 拍板先删）'
            : undefined}
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
                  onMove={(dir) => editor.organize(dir === -1 ? 'up' : 'down', id)}
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
                      onInput={(v) => (editor.draw = { ...editor.draw, radiusDeg: v })}
                    />
                    <span class="dim">{brushRadius.toFixed(1)}°</span>
                  </label>
                  {#if ia}
                    <!-- 高度笔刷模式（2026-10-06 拍板 2a/3）：涂改=写值；平滑=抹台阶 -->
                    <span class="field inline">
                      <span>模式</span>
                      <ModeCapsule
                        value={editor.draw.heightMode ?? 'paint'}
                        onChange={(v) => (editor.draw = { ...editor.draw, heightMode: v as 'paint' | 'smooth' })}
                        items={HMODE_ITEMS}
                        ariaLabel="高度笔刷模式"
                        segMinW={54}
                      />
                    </span>
                    {#if (editor.draw.heightMode ?? 'paint') === 'smooth'}
                      <span class="field inline">
                        <span>强度</span>
                        <ModeCapsule
                          value={String(editor.draw.smoothIter ?? 3)}
                          onChange={(v) => (editor.draw = { ...editor.draw, smoothIter: Number(v) as 1 | 3 | 5 })}
                          items={HITER_ITEMS}
                          ariaLabel="平滑强度"
                          segMinW={40}
                        />
                      </span>
                      <span
                        class="field inline"
                        title="开 = 海岸线保护（只在同侧扩散 + 陆≥1/海≤0，轮廓不动）；关 = 自由扩散（可抹平海岸）"
                      >
                        <span>护岸</span>
                        <StateCapsule
                          icon="🌊"
                          onText="保护"
                          offText="自由"
                          on={editor.draw.smoothCoast ?? true}
                          onchange={(v) => (editor.draw = { ...editor.draw, smoothCoast: v })}
                        />
                      </span>
                    {/if}
                  {/if}
                  <span
                    class="field inline"
                    title="开 = 抢占（replace：连同其他元素占着的格一起夺）；关 = 只填空白（emptyOnly，现状）。2026-10-04 用户拍板 6.2"
                  >
                    <span>抢占</span>
                    <StateCapsule
                      icon="⚔️"
                      onText="抢占"
                      offText="填空"
                      on={!editor.draw.addMode}
                      onchange={(v) => (editor.draw = { ...editor.draw, addMode: !v })}
                    />
                  </span>
                  <!-- 核心选取（2026-10-04 用户：在**绘制模式**下选核心，联排胶囊按钮） -->
                  <div class="field inline">
                    <span>核心</span>
                    <div class="seg-group" role="group" aria-label="核心选取方式">
                      <button
                        type="button"
                        class:on={editor.centerPickId === id && editor.centerPickMode === 'cell'}
                        title="核心 = 地块：地图上单击本元素的一格（Esc 取消）"
                        onclick={() => corePickT(id, 'cell')}
                      >
                        {editor.centerPickId === id && editor.centerPickMode === 'cell' ? '点格中…' : '地块'}
                      </button>
                      <button
                        type="button"
                        class:on={editor.centerPickId === id && editor.centerPickMode === 'child'}
                        title="核心 = 子元素：地图上单击该子元素的任意一格（Esc 取消）"
                        onclick={() => corePickT(id, 'child')}
                      >
                        {editor.centerPickId === id && editor.centerPickMode === 'child' ? '点子元素…' : '子元素'}
                      </button>
                      <button
                        type="button"
                        title="核心 = 面内最宽阔处（一键设置，Ctrl+Z 可撤销）"
                        onclick={() => editor.setCoreVisualCenter(id)}
                      >
                        视觉中心
                      </button>
                    </div>
                  </div>
                  {#if n.region.coreRegionId}
                    <div class="dim">核心「{world?.regions.find((x) => x.id === n.region.coreRegionId)?.name ?? '?'}」</div>
                  {:else if n.region.centerCellId !== undefined}
                    <div class="dim">核心 #{n.region.centerCellId}</div>
                  {/if}
                  <!-- 特殊地块标记（包5）：单击格子循环 ★→●→◆→无，模态保持 -->
                  <div class="field inline">
                    <span>标记</span>
                    <div class="seg-group" role="group" aria-label="特殊地块标记">
                      <button
                        type="button"
                        class:on={editor.markerPick}
                        title="点格添加/切换特殊地块标记：★ → ● → ◆ → 无（Esc 取消）"
                        onclick={() => editor.toggleMarkerPick()}
                      >
                        {editor.markerPick ? '点格中…' : '点标记'}
                      </button>
                    </div>
                    <span class="dim">{(world?.cellMarks?.length ?? 0) || '—'}</span>
                  </div>
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
        {/if}
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
                onMove={(dir) => editor.organize(dir === -1 ? 'up' : 'down', p.id)}
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
              p.hidden ?? false,
              true,
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
    font-size: var(--fs-md);
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
    gap: var(--sp-3);
  }
  .field.inline {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    color: var(--text-dim);
    font-size: var(--fs-sm);
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
    gap: var(--sp-2);
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
  /* 分组头（2026-10-06）：父元素名，居左小字 */
  .cell.ghead {
    height: 24px;
    display: flex;
    align-items: flex-end;
    padding: 0 2px 2px;
    font-size: var(--fs-xs);
    color: var(--text-dim);
    white-space: nowrap;
    overflow: hidden;
  }
  /* 组间横分割线 */
  .cell.gsep {
    height: 9px;
    position: relative;
  }
  .cell.gsep::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 4px;
    border-top: 1px solid var(--border, #3a4354);
    opacity: 0.7;
  }
  .dim.pad {
    padding: 12px;
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }
  .dim-pad {
    flex: 0 0 auto;
    margin: 0;
    padding: 8px 10px;
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }
</style>
