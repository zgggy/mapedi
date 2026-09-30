<script lang="ts">
  import { onMount } from 'svelte';
  import Viewport from './ui/Viewport.svelte';
  import { defaultProjParams } from './core/project/projections';
  import { DEFAULT_DENSITY } from './core/world';
  import type { HoverInfo } from './render/map2d';
  import { editor } from './app/store.svelte';
  import { initialShell, type ShellState, type ViewMode } from './ui/shell/shell';
  import TopBar from './ui/shell/TopBar.svelte';
  import GenerateSection from './ui/shell/GenerateSection.svelte';
  import LeftRail from './ui/shell/LeftRail.svelte';
  import { persistRailOpen } from './ui/shell/shell';
  import { clearViewMemory } from './ui/viewMemory';
  import { isLayerShown } from './core/displayCompose';
  import LayersPanel from './ui/shell/LayersPanel.svelte';
  import WorkspaceDrawer from './ui/shell/WorkspaceDrawer.svelte';
  import LayerInfoPanel from './ui/shell/LayerInfoPanel.svelte';
  import ElementInfoPanel from './ui/shell/ElementInfoPanel.svelte';
  import StatusBar from './ui/shell/StatusBar.svelte';
  import DisplayStylePanel from './ui/shell/DisplayStylePanel.svelte';
  import { setSuzerain, toggleEnemy, toggleAlly } from './core/diplomacy';

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
  let styleLayerId = $state<string | null>(null);
  /** 图层信息卡片的目标层（菜单可从任意层/元素发起，不再绑定 focusLayer） */
  let infoLayerId = $state<string | null>(null);
  /** 信息/参数卡片锚点（右键菜单处打开，越界 clamp，§4） */
  let infoAnchor = $state({ x: 250, y: 56 });
  /** panels.layers = 图层子面板展开；其余三张信息卡片（同刻最多一张，入口 = 行右键菜单） */
  let panels = $state({
    layers: true,
    layerInfo: false,
    style: false,
    elementInfo: false,
  });

  let exportCanvas: HTMLCanvasElement | null = null;
  const globeRev = $derived(editor.rev);

  const world = $derived(editor.world);
  const focusLayer = $derived(editor.focusLayer);
  const draw = $derived(editor.draw);
  const selectedRegionId = $derived(editor.selectedRegionId);
  const newName = $derived(editor.newName);
  const status = $derived(editor.status);
  const styleLayer = $derived(styleLayerId ?? focusLayer);

  /**
   * C1 配套守卫：会话内目标图层不可见 → 状态栏常驻红字警示。
   * 防「画在一个看不见的层上」——旧契约下这是选中即绘制催生的陷阱。
   */
  const drawGuard = $derived.by(() => {
    if (!draw.active || !world) return '';
    const t = draw.targetRegionId ?? '';
    const layerId = t.startsWith('__height__')
      ? 'height'
      : (world.regions.find((r) => r.id === t)?.layerId ?? focusLayer);
    const l = world.layers.find((x) => x.id === layerId);
    if (!l) return '';
    return isLayerShown(world, l.id, null)
      ? ''
      : `⚠ 正在绘制「${l.name}」但该图层已隐藏 —— 笔画画了看不见`;
  });

  /**
   * 选中元素（C1）：**只选中，不武装笔刷**——列表单击与画布反选共用同一语义。
   * id = null（列表空白点击）= 清空选中；画布点空白则不动作（onpick 自行短路）。
   */
  function selectElement(id: string | null) {
    if (id === null) {
      editor.selectedRegionId = null;
      editor.notify();
      return;
    }
    // 高度：选中区间 = 工作区间（与其它层同一列表）
    if (focusLayer === 'height') {
      editor.setHeightInterval(id);
      editor.selectedRegionId = id;
      editor.notify();
      return;
    }
    editor.selectedRegionId = id;
    const reg = world?.regions?.find((r) => r.id === id);
    if (reg) {
      editor.selectLayerTop(reg.layerId);
      editor.selectedRegionId = id;
      editor.status = `选中「${reg.name}」`;
      editor.notify();
      return;
    }
    editor.notify();
  }

  /** C1 画布反选：cell → 焦点层包含归属 → 与列表单击同语义 */
  function pickElement(cellId: number | null) {
    if (cellId === null || !world) return;
    let hit: string | null = null;
    for (const id of editor.regionIdsOfCell(cellId)) {
      const r = world.regions.find((x) => x.id === id);
      if (r?.layerId === focusLayer) hit = id; // 同层多归属时取列表末（与叠放一致）
    }
    if (hit) selectElement(hit);
  }

  /**
   * 右键菜单 → 信息/参数卡片（需求 4）：锚在菜单点击处、越界 clamp、同刻只开一张。
   * id = 图层行给 layerId、元素行给 regionId —— 两者都能解出 layerId。
   */
  function openInfoPanel(
    kind: 'style' | 'layerInfo' | 'elementInfo',
    id: string,
    x: number,
    y: number,
  ) {
    const reg = world?.regions.find((r) => r.id === id);
    const layerId = reg ? reg.layerId : id;
    const W = kind === 'style' ? 230 : 280;
    infoAnchor = {
      x: Math.max(8, Math.min(x, window.innerWidth - W - 8)),
      y: Math.max(44, Math.min(y, window.innerHeight - 260)),
    };
    panels.style = kind === 'style';
    panels.layerInfo = kind === 'layerInfo';
    panels.elementInfo = kind === 'elementInfo';
    if (kind === 'style') styleLayerId = layerId;
    if (kind === 'layerInfo') infoLayerId = layerId;
    if (kind === 'elementInfo') {
      editor.selectedRegionId = id;
      editor.notify();
    }
  }

  /** 信息/参数卡片：点外 / Esc 关闭（§4）；卡片是 App 顶层唯一的 PanelShell（.ps）浮面 */
  function closeInfoPanels() {
    if (panels.style || panels.layerInfo || panels.elementInfo) {
      panels.style = false;
      panels.layerInfo = false;
      panels.elementInfo = false;
    }
  }
  function onInfoDocPointer(e: PointerEvent) {
    if (!(panels.style || panels.layerInfo || panels.elementInfo)) return;
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('.ps')) return;
    closeInfoPanels();
  }
  function onInfoDocKey(e: KeyboardEvent) {
    if (e.key === 'Escape') closeInfoPanels();
  }

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

  /** 拖拽：nest/gap/root 由编辑器统一处理（显示父子，无包含校验） */
  function handleLayerDrag(
    fromId: string,
    hint:
      | { kind: 'nest'; targetId: string; nestFirst?: boolean }
      | { kind: 'gap'; afterId: string | null }
      | { kind: 'root' },
  ) {
    editor.dragLayer(fromId, hint);
  }

  function handleRegionDrag(fromId: string, hint: import('./core/regionOps').DropHint) {
    editor.dragRegion(fromId, hint);
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
      if (e.key === 'Escape') editor.endDraw();
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

<svelte:document onpointerdown={onInfoDocPointer} onkeydown={onInfoDocKey} />

<main>
  {#if bootError}
    <div class="err">启动错误：{bootError}</div>
  {/if}

  {#if world}
    <div class="view" style="opacity:{viewFade}">
      {#if shell.viewMode === 'view-2d'}
        <Viewport
          {world}
          {focusLayer}
          drawActive={draw.active}
          drawTool={draw.tool}
          brushRadiusDeg={draw.radiusDeg}
          workspaceOpen={shell.railOpen}
          railW={shell.railOpen ? shell.leftW : 0}
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
          onpaint={(lon, lat, shift, ctrl) => editor.paint(lon, lat, shift, ctrl)}
          onradius={(v) => {
            editor.draw = { ...editor.draw, radiusDeg: v };
          }}
          onendpoint={(cellId, lon, lat, phase) => editor.endpoint(cellId, lon, lat, phase)}
          onstrokeend={() => editor.commitStroke()}
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
    onRename={(n) => editor.renameWorld(n)}
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
    onClearCache={() => editor.clearAutosave()}
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

  {#snippet layersSn()}

  <LayersPanel
    expanded={panels.layers}
    {world}
    {focusLayer}
    newName={editor.newName}
    onSelect={(id) => {
      if (!id) {
        editor.clearLayerSelection();
        return;
      }
      editor.selectLayerTop(id);
    }}
    onToggleVisible={(id) => editor.toggleLayerVisible(id)}
    onDrawLayer={(id) => {
      // 图层行点击 = 聚焦 + 工作区切换上下文（§3.2）；显隐只由眼睛开关（用户定）
      editor.focusLayerForDraw(id);
    }}
    onStyleLayer={(id) => {
      styleLayerId = id;
      editor.focusLayer = id;
      panels.style = true;
    }}
    onDragLayer={handleLayerDrag}
    onAddLayer={() => editor.addLayer()}
    onNewName={(v) => (editor.newName = v)}
    onRandomName={() => (editor.newName = editor.randomLayerName())}
    onCollapse={() => {
      shell.railOpen = false;
      persistRailOpen(false);
    }}
    onToggleExpand={() => (panels.layers = !panels.layers)}
    onOpenPanel={openInfoPanel}
    onMoveLayer={(id, dir) => editor.moveItemStep(id, dir)}
    onCopyLayer={(id) => editor.copyItem(id)}
    onDeleteLayer={(id) => editor.deleteItem(id)}
  />
  {/snippet}

  {#snippet wsSn()}
  <!-- 2026-09-30：星球参数回迁顶栏 ⚙ 面板（3d/2d 按模式互斥显示）——
       工作区不再分叉：球面 = 图层+列表+显示（隐藏绘制/创建），平面 = 四把手全量 -->
    {#snippet generate()}
      <!-- 段4 低频折叠区：生成把手（D5 长按进度）+ 显示把手（§4 单源卡片） -->
      <GenerateSection
        generating={editor.generating}
        genProgress={editor.genProgress}
        genStep={editor.genStep}
        seedInput={editor.seedInput}
        densityInput={editor.densityInput}
        shape={editor.worldShape}
        layerId={focusLayer}
        layerName={world?.layers.find((l) => l.id === focusLayer)?.name ?? focusLayer}
        layerParams={focusLayer === 'height' ? null : (editor.profiles.find((p) => p.layerId === focusLayer)?.params ?? null)}
        mode={shell.viewMode === 'view-globe' ? 'globe' : 'plane'}
        onShape={(k, v) => editor.setProfileParam('height', k, v)}
        onRegen={(id) => editor.regenLayer(id)}
        onParam={(k, v) => editor.setProfileParam(focusLayer, k, v)}
        onGenerate={(s, n) => {
          bootError = '';
          // 重新生成完成 → 进入球面展示（用户定）
          return editor.generate(s, n).then((r) => {
            switchView('view-globe');
            return r;
          });
        }}
        onOpenStyle={(x, y) => openInfoPanel('style', focusLayer, x, y)}
      />
    {/snippet}
  <WorkspaceDrawer
    {world}
    {focusLayer}
    {selectedRegionId}
    {newName}
    mode={shell.viewMode === 'view-globe' ? 'globe' : 'plane'}
    bind:expandedIds
    drawActive={draw.active}
    brushRadius={draw.radiusDeg}
    onSelect={selectElement}
    onDraw={(id) => {
      // C1：双击 = 进入绘制会话；路径元素 = 进入该条曲线的编辑（控件/加点）
      const path = world?.paths?.find((p) => p.id === id);
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
    }}
    onUndo={() => editor.undo()}
    onRedo={() => editor.redo()}
    onOpenPanel={openInfoPanel}
    onDelete={(id) => {
      editor.selectedRegionId = id;
      editor.deleteSelected();
    }}
    onPaintValue={(id, v) => editor.setHeightPaint(id, v)}
    onRadius={(v) => {
      editor.draw = { ...editor.draw, radiusDeg: v };
    }}
    drawTool={draw.tool}
    onTool={(t) => editor.setDrawTool(t)}
    onDrawMode={() => {
      if (editor.draw.active) editor.endDraw();
      else if (focusLayer === 'height') editor.startHeightDraw();
      else if (editor.selectedRegionId) editor.startDraw(editor.selectedRegionId);
      else editor.status = '请先选中元素';
    }}
    onCreate={() => {
      editor.createRegion(editor.focusLayer);
    }}
    onCreateChild={(parentId) => {
      if (!world) return;
      const parent = world.regions.find((r) => r.id === parentId);
      if (!parent) return;
      const cl = world.layers.find((l) => l.parentLayerId === parent.layerId);
      editor.createRegion(cl?.id ?? parent.layerId, parentId);
      // 确保父元素保持展开
      if (!expandedIds.has(parentId)) {
        expandedIds = new Set([...expandedIds, parentId]);
      }
    }}
    onRandomName={() => {
      editor.newName = editor.randomName(
        editor.focusLayer === 'province' ? 'province' : 'country',
      );
    }}
    onNewName={(n) => (editor.newName = n)}
    onRegionDrag={handleRegionDrag}
    onMoveItem={(id, dir) => editor.moveItemStep(id, dir)}
    onCopyItem={(id) => editor.copyItem(id)}
    onToggleHidden={(id) => editor.toggleItemHidden(id)}
    lowFreq={generate}
  />
  {/snippet}

  {#if shell.railOpen}
    <LeftRail width={shell.leftW} layers={layersSn} workspace={wsSn} />
  {:else}
    <!-- §3.5 收起整轨 → 左上角独立圆钮 -->
    <button
      type="button"
      class="rail-open"
      title="展开左轨"
      onclick={() => {
        shell.railOpen = true;
        persistRailOpen(true);
      }}
    >🗂</button>
  {/if}

  <LayerInfoPanel
    {world}
    layerId={infoLayerId ?? focusLayer}
    open={panels.layerInfo}
    x={infoAnchor.x}
    y={infoAnchor.y}
    onCollapse={() => (panels.layerInfo = false)}
    onNotice={(msg) => {
      editor.status = msg;
      editor.notify();
    }}
  />

  <ElementInfoPanel
    {world}
    regionId={selectedRegionId}
    open={panels.elementInfo}
    onCollapse={() => (panels.elementInfo = false)}
    x={infoAnchor.x}
    y={infoAnchor.y}
    onSaveInfo={(id, patch) => {
      if (!world) return;
      const r = world.regions.find((x) => x.id === id);
      if (!r) return;
      if (patch.name) r.name = patch.name;
      if (patch.color && !r.parentId) r.color = patch.color;
      if (patch.exclusiveColor !== undefined) {
        r.exclusiveColor = patch.exclusiveColor || undefined;
      }
      if (patch.description !== undefined)
        r.attributes = { ...r.attributes, description: patch.description };
      editor.touchRegions();
      editor.status = '已保存';
    }}
    onSetSuzerain={(vid, sid) => {
      if (!world) return;
      if (!setSuzerain(world, vid, sid)) {
        editor.status = '无法建立附庸（同层 / 禁止成环）';
        return;
      }
      editor.touchRegions();
      editor.status = sid ? '已设附庸' : '已解除附庸';
    }}
    onToggleEnemy={(a, b) => {
      if (!world) return;
      toggleEnemy(world, a, b);
      editor.touchRegions();
      editor.status = '已更新敌对关系';
    }}
    onToggleAlly={(a, b) => {
      if (!world) return;
      toggleAlly(world, a, b);
      editor.touchRegions();
      editor.status = '已更新同盟关系';
    }}
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
    onPickElement={(id) => selectElement(id)}
  />

  <DisplayStylePanel
    open={panels.style}
    layerId={styleLayer}
    layerName={world?.layers.find((l) => l.id === styleLayer)?.name ?? styleLayer}
    cfg={editor.layerStyleConfig(styleLayer)}
    onChange={(patch) => {
      editor.setLayerStyle(styleLayer, patch);
    }}
    x={infoAnchor.x}
    y={infoAnchor.y}
    onCollapse={() => (panels.style = false)}
  />

  <!-- ValidatorPanel 已按 D4=B 归档；PanelDock 已随面板退役删除（需求 6：常驻浮窗 = 0） -->
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
  /* 左轨收起后的左上角圆钮（设计稿 §3.5） */
  .rail-open {
    position: fixed;
    left: 8px;
    top: 10px;
    z-index: 60;
    width: 30px;
    height: 30px;
    padding: 0;
    border-radius: 15px;
    font-size: 14px;
    line-height: 1;
    background: rgba(16, 19, 26, 0.94);
    border: 1px solid var(--panel-border);
    cursor: pointer;
  }
  .rail-open:hover {
    background: rgba(30, 34, 44, 0.98);
  }
</style>
