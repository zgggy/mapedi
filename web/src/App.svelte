<script lang="ts">
  import { onMount } from 'svelte';
  import Viewport from './ui/Viewport.svelte';
  import { defaultProjParams } from './core/project/projections';
  import type { HoverInfo } from './render/map2d';
  import { editor } from './app/store.svelte';
  import { initialShell, type ShellState, type ViewMode } from './ui/shell/shell';
  import TopBar from './ui/shell/TopBar.svelte';
  import LayersPanel from './ui/shell/LayersPanel.svelte';
  import WorkspacePanel from './ui/shell/WorkspacePanel.svelte';
  import WorkspaceDrawer from './ui/shell/WorkspaceDrawer.svelte';
  import StatusBar from './ui/shell/StatusBar.svelte';
  import BrushHud from './ui/shell/BrushHud.svelte';
  import DisplayStylePanel from './ui/shell/DisplayStylePanel.svelte';
  import ValidatorPanel from './ui/shell/ValidatorPanel.svelte';
  import { setSuzerain, toggleEnemy, toggleAlly } from './core/diplomacy';

  let shell = $state<ShellState>(initialShell());
  let hover = $state<HoverInfo | null>(null);
  let styleId = $state('dark');
  let reliefSmooth = $state(0.35);
  let globeAxis = $state(true);
  let globeEcliptic = $state(true);
  let globeSpin = $state(true);
  let projParams = $state(defaultProjParams());
  let fps = $state(0);
  let viewFade = $state(1);
  let infoRegionId = $state<string | null>(null);
  let expandedIds = $state(new Set<string>());
  let bootError = $state('');
  let styleLayerId = $state<string | null>(null);
  let lastFocusForStyle = '';
  $effect(() => {
    const f = focusLayer;
    if (!styleLayerId) {
      lastFocusForStyle = f;
      return;
    }
    if (f && f !== lastFocusForStyle) {
      lastFocusForStyle = f;
      styleLayerId = f;
    }
  });
  let exportCanvas: HTMLCanvasElement | null = null;
  const globeRev = $derived(editor.rev);

  const world = $derived(editor.world);
  const focusLayer = $derived(editor.focusLayer);
  const draw = $derived(editor.draw);
  const selectedRegionId = $derived(editor.selectedRegionId);
  const newName = $derived(editor.newName);
  const annexPick = $derived(editor.annexPick);
  const status = $derived(editor.status);
  const issues = $derived(editor.issues);
  const showValidator = $derived(editor.showValidator);
  /** 图层父子关系：childId → parentId */
  const layerParentOf = $derived(
    world
      ? Object.fromEntries(world.layers.filter((l) => l.parentLayerId).map((l) => [l.id, l.parentLayerId!]))
      : {},
  );

  function switchView(m: ViewMode) {
    if (m === shell.viewMode) return;
    if (m !== 'view-2d') exportCanvas = null;
    viewFade = 0.2;
    shell.viewMode = m;
    requestAnimationFrame(() => {
      viewFade = 1;
    });
  }

  function selectLayer(id: string) {
    editor.focusLayer = id;
    editor.selectedRegionId = null;
    // 路/航/河：只切换图层，不自动进绘制；在工作区选中路径后再编辑
    if (editor.draw.active && editor.draw.targetRegionId === '__path__') {
      editor.draw = { ...editor.draw, active: false, targetRegionId: null };
    }
    editor.notify();
    shell.workspaceOpen = true;
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
          if (!ok) return editor.generate(Number(editor.seedInput) || 1, editor.densityInput || 30000);
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
    infoRegionId = null;
    expandedIds = new Set();
    hover = null;
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
    <div class="view" style="opacity:{viewFade}">
      {#if shell.viewMode === 'view-2d'}
        <Viewport
          {world}
          {focusLayer}
          drawActive={draw.active}
          drawTool={draw.tool}
          brushRadiusDeg={draw.radiusDeg}
          workspaceOpen={shell.workspaceOpen}
          highlightRegionId={draw.active
            ? (draw.parentRegionId ?? draw.targetRegionId)
            : selectedRegionId}
          roadSegments={editor.roadSegments()}
          projection={'mercator'}
          {projParams}
          {reliefSmooth}
          {styleId}
          bindCanvas={(c) => (exportCanvas = c)}
          onhover={(h) => (hover = h)}
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
            drawActive={draw.active}
            rev={globeRev}
            climate={editor.climateDraft}
            astro={editor.astro ?? undefined}
            {styleId}
            {reliefSmooth}
            highlightRegionId={selectedRegionId}
            showAxis={globeAxis}
            showEcliptic={globeEcliptic}
            spinPreview={globeSpin}
            onPatchAstro={(patch) => editor.patchAstro(patch)}
            onpaint={(lon, lat, shift, ctrl) => editor.paint(lon, lat, shift, ctrl)}
            onpick={(lon, lat) => {
              editor.status = `${lon.toFixed(1)}° ${lat.toFixed(1)}°`;
            }}
            onstrokeend={() => editor.commitStroke()}
          />
        {/await}
      {/if}
    </div>
  {:else}
    <div class="loading">生成世界… {editor.status}</div>
  {/if}

  <TopBar
    bind:open={shell.projectOpen}
    bind:settingsOpen={shell.settingsOpen}
    mapName={world?.meta ? `世界 ${world.meta.seed}` : '未命名世界'}
    viewMode={shell.viewMode}
    {styleId}
    {reliefSmooth}
    generating={editor.generating}
    genProgress={editor.genProgress}
    genStep={editor.genStep}
    seedInput={editor.seedInput}
    densityInput={editor.densityInput}
    autosaveAt={editor.autosaveAt}
    globeShowAxis={globeAxis}
    globeShowEcliptic={globeEcliptic}
    globeSpin={globeSpin}
    globeTilt={editor.climateDraft.axialTiltDeg}
    globeRotHours={editor.climateDraft.rotationHours}
    onGenerate={(s, n) => {
      bootError = '';
      return editor.generate(s, n);
    }}
    onSwitchView={switchView}
    onStyle={(s) => (styleId = s)}
    onRelief={(v) => (reliefSmooth = v)}
    onGlobeShowAxis={(v) => (globeAxis = v)}
    onGlobeShowEcliptic={(v) => (globeEcliptic = v)}
    onGlobeSpin={(v) => (globeSpin = v)}
    onGlobeTilt={(v) => {
      editor.climateDraft = { ...editor.climateDraft, axialTiltDeg: v };
    }}
    onGlobeRotHours={(v) => {
      editor.climateDraft = { ...editor.climateDraft, rotationHours: v };
    }}
    onExport={(k) => {
      if (k === 'json') editor.exportProject?.();
      else if (k === 'png') {
        if (exportCanvas && shell.viewMode === 'view-2d') editor.exportPng(exportCanvas);
        else editor.status = '请切换到平面视图导出 PNG';
      }
      else if (k === 'svg') editor.exportSvg?.();
    }}
    onImport={async (k, f) => {
      if (k === 'json') {
        await editor.importProjectFile(f);
        if (editor.status.startsWith('已导入')) bootError = '';
      }
    }}
    onClearCache={() => editor.clearAutosave()}
  />

  <LayersPanel
    bind:open={shell.layersOpen}
    {world}
    {focusLayer}
    leftW={shell.leftW}
    newName={editor.newName}
    onSelect={(id) => {
      if (!id) {
        editor.clearLayerSelection();
        return;
      }
      // 再次点击已选中图层 → 开关右侧工作区
      if (editor.focusLayer === id) {
        shell.workspaceOpen = !shell.workspaceOpen;
        editor.notify();
        return;
      }
      editor.selectLayerTop(id);
    }}
    onToggleVisible={(id) => editor.toggleLayerVisible(id)}
    onDrawLayer={(id) => {
      editor.focusLayerForDraw(id);
      shell.workspaceOpen = true;
    }}
    onStyleLayer={(id) => {
      if (styleLayerId === id) {
        styleLayerId = null;
      } else {
        styleLayerId = id;
        editor.focusLayer = id;
        lastFocusForStyle = id;
      }
    }}
    onDragLayer={handleLayerDrag}
    onAddLayer={() => editor.addLayer()}
    onNewName={(v) => (editor.newName = v)}
    onRandomName={() => (editor.newName = editor.randomLayerName())}
  />

  <WorkspacePanel bind:open={shell.workspaceOpen} bind:width={shell.rightW}>
    <WorkspaceDrawer
      {world}
      {focusLayer}
      {selectedRegionId}
      {newName}
      {infoRegionId}
      bind:expandedIds
      drawActive={draw.active}
      brushRadius={draw.radiusDeg}
      onSelect={(id) => {
        // 高度：选中区间 = 工作区间（与其它层同一列表）
        if (focusLayer === 'height') {
          editor.setHeightInterval(id);
          editor.selectedRegionId = id;
          editor.notify();
          return;
        }
        editor.selectedRegionId = id;
        // 工作区选中路径元素 → 进入该条曲线的编辑（控件/加点）
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
        // 选中图层元素：边界高亮 + 该层置顶显示
        const reg = world?.regions?.find((r) => r.id === id);
        if (reg) {
          editor.selectLayerTop(reg.layerId);
          editor.selectedRegionId = id;
          editor.status = `选中「${reg.name}」`;
          editor.notify();
          return;
        }
        editor.notify();
      }}
      onInfo={(id) => {
        infoRegionId = infoRegionId === id ? null : id;
        editor.selectedRegionId = id;
      }}
      onDelete={(id) => {
        editor.selectedRegionId = id;
        editor.deleteSelected();
      }}
      onDraw={(id) => editor.startDraw(id)}
      onRadius={(v) => {
        editor.draw = { ...editor.draw, radiusDeg: v };
      }}
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
      onCloseInfo={() => (infoRegionId = null)}
      onRegionDrag={handleRegionDrag}
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
      onSaveInfo={(patch) => {
        if (!world || !infoRegionId) return;
        const r = world.regions.find((x) => x.id === infoRegionId);
        if (!r) return;
        if (patch.name) r.name = patch.name;
        if (patch.color && !r.parentId) r.color = patch.color;
        if (patch.exclusiveColor !== undefined) {
          r.exclusiveColor = patch.exclusiveColor || undefined;
        }
        if (patch.description !== undefined)
          r.attributes = { ...r.attributes, description: patch.description };
        editor.touchRegions();
        infoRegionId = null;
        editor.status = '已保存';
      }}
    />
  </WorkspacePanel>

  <StatusBar {hover} {status} {fps} />

  <BrushHud
    {draw}
    label={editor.drawTargetLabel}
    isHeight={focusLayer === 'height'}
    onTool={(t) => editor.setDrawTool(t)}
    onEnd={() => editor.endDraw()}
    onRadius={(v) => {
      editor.draw = { ...editor.draw, radiusDeg: v };
    }}
  />

  <DisplayStylePanel
    open={!!styleLayerId}
    layerId={styleLayerId ?? ''}
    layerName={styleLayerId ?? ''}
    cfg={styleLayerId ? editor.layerStyleConfig(styleLayerId) : undefined}
    onChange={(patch) => {
      if (styleLayerId) editor.setLayerStyle(styleLayerId, patch);
    }}
    onClose={() => (styleLayerId = null)}
  />

  <ValidatorPanel
    show={showValidator}
    {issues}
    onJump={(i) => editor.jumpIssue(i)}
    onFix={(i) => editor.applyFix(i)}
    onRerun={() => editor.runValidator()}
    onClose={() => {
      editor.showValidator = false;
    }}
  />
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
</style>
