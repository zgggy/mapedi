<script lang="ts">
  import { onMount } from 'svelte';
  import Viewport from './ui/Viewport.svelte';
  import { defaultProjParams } from './core/project/projections';
  import { DEFAULT_DENSITY } from './core/world';
  import type { HoverInfo } from './render/map2d';
  import { editor } from './app/store.svelte';
  import { initialShell, type ShellState, type ViewMode, persistWsMode } from './ui/shell/shell';
  import TopBar from './ui/shell/TopBar.svelte';
  import GenerateSection from './ui/shell/GenerateSection.svelte';
  import InspectSection from './ui/shell/InspectSection.svelte';
  import LeftRail from './ui/shell/LeftRail.svelte';
  import { clearViewMemory } from './ui/viewMemory';
  import { isLayerShown, isFreeLayerId } from './core/displayCompose';
  import { genStrategyOf, editsHeightAt, editsHeightLayerId } from './core/layer/flags';
  import LayersPanel from './ui/shell/LayersPanel.svelte';
  import WorkspaceDrawer from './ui/shell/WorkspaceDrawer.svelte';
  import StatusBar from './ui/shell/StatusBar.svelte';

  let shell = $state<ShellState>(initialShell());
  let hover = $state<HoverInfo | null>(null);
  let styleId = $state('dark');
  let projection = $state<import('./core/project/projections').ProjectionId>('robinson');
  let globeAxis = $state(true);
  let globeEcliptic = $state(true);
  let globeSpin = $state(false);
  let projParams = $state(defaultProjParams());
  let fps = $state(0);
  /** 首启渐现/预热中（Viewport 上报）：只在平面模式存在（球面无预热阶段） */
  let preparing = $state(false);
  let zoomScale = $state(1);
  let viewFade = $state(1);
  let expandedIds = $state(new Set<string>());
  let bootError = $state('');
  // panels 状态已退役（2026-09-30 终稿：图层区恒在，开合把手架构随三模式胶囊化取消）
  /** 左栏两面板开合（LeftRail 回传）：驱动高度标注显示条件（workspaceOpen）；width 为回传遥测 */
  let railState = $state({ layersOpen: true, wsOpen: true, right: 307 });
  /**
   * 地图居中偏移（2026-10-04 用户定）：图层/元素**任一**面板展开 → 视图画布
   * 内缩到栏右缘，自动对准剩余空间中心；双收起 → 内缩归零回屏幕中心。
   * 平面/球面共用 .view 的 CSS 变量（canvas rect 相对坐标全链自适应）。
   */
  const mapInset = $derived(railState.layersOpen || railState.wsOpen ? railState.right : 0);

  let exportCanvas: HTMLCanvasElement | null = null;
  const globeRev = $derived(editor.rev);

  const world = $derived(editor.world);
  const focusLayer = $derived(editor.focusLayer);
  /** 焦点层生成策略（GenerateSection 三分支单源；pre-world 回落 'elements'，行展开本就需要 world） */
  const focusStrategy = $derived(genStrategyOf(world, focusLayer));
  const draw = $derived(editor.draw);
  const selectedRegionId = $derived(editor.selectedRegionId);
  const newName = $derived(editor.newName);
  const status = $derived(editor.status);

  /**
   * C1 配套守卫：会话内目标图层不可见 → 状态栏常驻红字警示。
   * 防「画在一个看不见的层上」——旧契约下这是选中即绘制催生的陷阱。
   */
  const drawGuard = $derived.by(() => {
    if (!draw.active || !world) return '';
    const t = draw.targetRegionId ?? '';
    const layerId = t.startsWith('__height__')
      ? editsHeightLayerId(world.layers)
      : (world.regions.find((r) => r.id === t)?.layerId ?? focusLayer);
    const l = world.layers.find((x) => x.id === layerId);
    if (!l) return '';
    return isLayerShown(world, l.id, focusLayer)
      ? ''
      : `⚠ 正在绘制「${l.name}」但该图层已隐藏 —— 笔画画了看不见`;
  });

  /**
   * 选中元素（C1）：**只选中，不武装笔刷**——列表单击与画布反选共用同一语义。
   * id = null（列表空白点击）= 清空选中；画布点空白则不动作（onpick 自行短路）。
   */
  /** C1 画布反选：cell → 焦点层包含归属 → 与列表单击同语义 */
  function pickElement(cellId: number | null) {
    if (cellId === null || !world) return;
    let hit: string | null = null;
    for (const id of editor.regionIdsOfCell(cellId)) {
      const r = world.regions.find((x) => x.id === id);
      if (r?.layerId === focusLayer) hit = id; // 同层多归属时取列表末（与叠放一致）
    }
    if (hit) editor.selectElement(hit);
  }

  /**
   * 工作区三模式（2026-09-30 拍板）：检查 / 生成 / 绘制。
   * 切换即持久化；球面视图锁定检查（纯展示契约）。
   */
  function setWsMode(m: 'check' | 'gen' | 'draw') {
    if (shell.wsMode === m) return;
    shell.wsMode = m;
    persistWsMode(m);
    editor.notify();
  }

  // 球面锁：离开平面 → 强制检查模式
  $effect(() => {
    if (shell.viewMode === 'view-globe' && shell.wsMode !== 'check') {
      shell.wsMode = 'check';
      persistWsMode('check');
    }
  });

  /**
   * 绘制推导（C1 改写，2026-09-30 拍板）：绘制会话 = 绘制模式 × 选中元素 的纯推导——
   * 有选中即被绘制；无选中（收起）即无绘制能力。路径元素进曲线编辑，其余走 startDraw
   * （内部对 interval 元素路由到高度值涂改）。
   */
  $effect(() => {
    const eligible =
      shell.viewMode === 'view-2d' && shell.wsMode === 'draw' && !!selectedRegionId && !!world;
    if (!eligible) {
      if (editor.draw.active) editor.endDraw();
      return;
    }
    const id = selectedRegionId!;
    // 幂等护栏必须覆盖高度会话（2026-10-01 冻结 P0 根因）：startHeightDraw 存的
    // targetRegionId = `__height__:${id}`，旧护栏只比裸 id 永不命中 → 每轮 effect 重跑都
    // endDraw()(touchWorld 换 world 身份)→startDraw → world 变再弄脏自己 → 批处理重入
    // 不收敛 → 全场冻结。普通元素 target=裸 id 命中即收敛（故只有高度触发）。
    const target = editor.draw.targetRegionId;
    if (editor.draw.active && (target === id || target === `__height__:${id}`)) return;
    if (editor.draw.active) editor.endDraw();
    const path = world!.paths?.find((p) => p.id === id);
    if (path) {
      editor.draw = {
        ...editor.draw,
        active: true,
        targetRegionId: id,
        tool: 'brush',
        addMode: true,
      };
      editor.status = `编辑「${path.name}」：拖控制点 / 点曲线加点 / Esc 退出`;
      editor.notify();
      return;
    }
    editor.startDraw(id);
  });

  function switchView(m: ViewMode) {
    if (m === shell.viewMode) return;
    if (m !== 'view-2d') {
      exportCanvas = null;
      // 球面为纯展示：离开平面即结束绘制态（残留的绘制状态不得带到球面）
      if (draw.active) editor.endDraw();
    }
    viewFade = 0.2;
    shell.viewMode = m;
    requestAnimationFrame(() => {
      viewFade = 1;
    });
  }

  onMount(() => {
    try {
      editor
        .tryRestore()
        .then((ok) => {
          if (!ok) return editor.generate(Number(editor.seedInput) || 1, editor.densityInput || DEFAULT_DENSITY);
        })
        .catch((e) => {
          bootError = `自动存档无法恢复，原存档未覆盖：${e}`;
        });
    } catch (e) {
      bootError = String(e);
    }

    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) editor.redo();
        else editor.undo();
      }
      // Ctrl+Y = redo 等价键（D1：Ctrl+Shift+Z 保留）
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        editor.redo();
      }
      if (e.key === 'Escape') {
        // Esc = 收起选中（单开规则：展开的元素收起 → 绘制由推导退出）；搜索框/菜单内 Esc 已各自 stopPropagation
        if (editor.selectedRegionId) {
          editor.selectedRegionId = null;
          editor.notify();
        }
      }
    };
    window.addEventListener('keydown', onKey);

    let raf = 0;
    let frames = 0;
    let last = performance.now();
    const tick = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 500) {
        fps = Math.round((frames * 1000) / (now - last));
        frames = 0;
        last = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      window.removeEventListener('keydown', onKey);
      cancelAnimationFrame(raf);
    };
  });

  $effect(() => {
    if (!editor.projectEpoch) return;
    expandedIds = new Set();
    hover = null;
    // 换世界：旧世界的取景不得带到新世界（双模式相机记忆的清空时机）
    clearViewMemory();
    preparing = true;
  });

  $effect(() => {
    const w = editor.world;
    if (!w) return;
    void w.cells.length;
    void w.regions.length;
    editor.scheduleAutosave();
  });
</script>

<main>
  {#if bootError}
    <div class="err">启动错误：{bootError}</div>
  {/if}

  {#if world}
    <div class="view" style="opacity:{viewFade}; --map-inset-l: {mapInset}px">
      {#if shell.viewMode === 'view-2d'}
        <Viewport
          {world}
          {focusLayer}
          drawActive={draw.active}
          drawTool={draw.tool}
          brushRadiusDeg={draw.radiusDeg}
          workspaceOpen={railState.wsOpen}
          highlightRegionId={draw.active
            ? (draw.parentRegionId ?? draw.targetRegionId)
            : selectedRegionId}
          roadSegments={editor.roadSegments()}
          projection={projection}
          {projParams}
          {styleId}
          bindCanvas={(c) => (exportCanvas = c)}
          onhover={(h) => {
            if (!h) {
              hover = null;
              return;
            }
            const ids = editor.regionIdsOfCell(h.cellId);
            hover = {
              ...h,
              elementIds: ids,
              elementNames: ids.map(
                (id) => world?.regions.find((r) => r.id === id)?.name ?? id,
              ),
            };
          }}
          onzoom={(z) => (zoomScale = z)}
          onwarm={(done) => (preparing = !done)}
          onpick={pickElement}
        />
      {:else}
        {#await import('./ui/GlobeView.svelte') then mod}
          {@const Globe = mod.default}
          <Globe
            {world}
            {focusLayer}
            rev={globeRev}
            climate={editor.climateDraft}
            astro={editor.astro ?? undefined}
            highlightRegionId={selectedRegionId}
            showAxis={globeAxis}
            showEcliptic={globeEcliptic}
            spinPreview={globeSpin}
          />
        {/await}
      {/if}
    </div>
  {:else}
    <div class="loading">生成世界… {editor.status}</div>
  {/if}

  <TopBar
    viewMode={shell.viewMode}
    onSwitchView={switchView}
    worldName={world?.meta.name || (world?.meta ? `世界 ${world.meta.seed}` : '未命名世界')}
    autosaveAt={editor.autosaveAt}
    onExport={(k) => {
      if (k === 'json') editor.exportJson();
      else if (k === 'gz') editor.exportGz();
      else if (k === 'png') {
        if (exportCanvas && shell.viewMode === 'view-2d') editor.exportPng(exportCanvas);
        else editor.status = '请切换到平面视图导出 PNG';
      } else if (k === 'svg') editor.exportSvg?.();
    }}
    onImport={async (k, f) => {
      if (k === 'json') {
        await editor.importProjectFile(f);
        if (editor.status.startsWith('已导入')) bootError = '';
      }
    }}
    {styleId}
    onStyle={(s) => (styleId = s)}
    projection={projection}
    onProjection={(p) => (projection = p as import('./core/project/projections').ProjectionId)}
    globeShowAxis={globeAxis}
    globeShowEcliptic={globeEcliptic}
    globeSpin={globeSpin}
    globeTilt={editor.climateDraft.axialTiltDeg}
    globeRotHours={editor.climateDraft.rotationHours}
    onGlobeShowAxis={(v) => (globeAxis = v)}
    onGlobeShowEcliptic={(v) => (globeEcliptic = v)}
    onGlobeSpin={(v) => (globeSpin = v)}
    onGlobeTilt={(v) => {
      editor.climateDraft = { ...editor.climateDraft, axialTiltDeg: v };
    }}
    onGlobeRotHours={(v) => {
      editor.climateDraft = { ...editor.climateDraft, rotationHours: v };
    }}
  />

  {#snippet layerExpand()}
    <!-- 图层树聚焦行下方（绘制模式 = 空；球面锁检查） -->
    {#if shell.wsMode === 'check'}
      <InspectSection {world} kind="layer" id={focusLayer} />
    {:else if shell.wsMode === 'gen'}
      <GenerateSection
        generating={editor.generating}
        genProgress={editor.genProgress}
        genStep={editor.genStep}
        seedInput={editor.seedInput}
        densityInput={editor.densityInput}
        shape={editor.worldShape}
        layerId={focusLayer}
        layerName={world?.layers.find((l) => l.id === focusLayer)?.name ?? focusLayer}
        strategy={focusStrategy}
        freeform={!!world && isFreeLayerId(world, focusLayer)}
        layerParams={focusStrategy === 'heightmap' ? null : (editor.profiles.find((p) => p.layerId === focusLayer)?.params ?? null)}
        onGenerate={(s, n) => {
          bootError = '';
          // 重新生成完成 → 进入球面展示（用户定）
          return editor.generate(s, n).then((r) => {
            switchView('view-globe');
            return r;
          });
        }}
      />
    {/if}
  {/snippet}
  {#snippet elementExpand()}
    <!-- 元素树选中行下方（绘制模式 = WorkspaceDrawer 本地绘制参数区） -->
    {#if shell.wsMode === 'check'}
      <InspectSection {world} kind="element" id={selectedRegionId} />
    {/if}
    <!-- 生成模式元素展开：子元素相关功能待重新设计（2026-10-01 用户拍板先删，
         含「元素级生成重生成子元素」占位）→ modeBodyOf(gen)=false 行不可展开 -->
  {/snippet}

  {#snippet layersSn()}

  <LayersPanel
    {world}
    {focusLayer}
    taskMode={shell.wsMode}
    expandPanel={layerExpand}
  />
  {/snippet}

  {#snippet wsSn()}
  <!-- 2026-09-30 三模式重构：双树行级展开区（layerExpand/elementExpand 声明在顶层平级，
       snippet 作用域坑：嵌套声明对兄弟不可见，见 HANDOFF 教训） -->
  <WorkspaceDrawer
    {world}
    {focusLayer}
    {selectedRegionId}
    {newName}
    mode={shell.viewMode === 'view-globe' ? 'globe' : 'plane'}
    taskMode={shell.wsMode}
    layerPanel={layerExpand}
    elementPanel={elementExpand}
    bind:expandedIds
    drawActive={draw.active}
    brushRadius={draw.radiusDeg}
  />
  {/snippet}

  <!-- 2026-09-30 第七轮：面板右缘与圆钮右缘对齐（max-content），宽度经 onState 实测回传 -->
  <LeftRail
    layers={layersSn}
    workspace={wsSn}
    taskMode={shell.wsMode}
    globeLocked={shell.viewMode === 'view-globe'}
    onTaskMode={setWsMode}
    onState={(s) => (railState = s)}
  />

  <StatusBar
    {hover}
    {status}
    error={bootError || drawGuard}
    {fps}
    zoom={zoomScale}
    {preparing}
    mode={shell.viewMode}
    autosaveAt={editor.autosaveAt}
    copyText={editor.lastError}
    onPickElement={(id) => editor.selectElement(id)}
  />

  <!-- 三张信息 popover（图层信息/元素信息/显示参数）已退役（2026-09-30 拍板 3）：
       检查模式展开区（InspectSection）为唯一信息入口 -->
</main>

<style>
  main {
    position: relative;
    width: 100%;
    height: 100%;
    background: #0b1018;
  }
  .view {
    position: absolute;
    inset: 0;
    /* 地图居中偏移：左缘让开左栏（面板展开=剩余空间中心，双收起=0 回屏幕中心） */
    left: var(--map-inset-l, 0px);
    transition: opacity 0.2s ease;
  }
  .loading,
  .err {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    color: var(--text-dim);
    font-size: 14px;
  }
  .err {
    color: #f0a0a0;
    z-index: 99;
  }
</style>
