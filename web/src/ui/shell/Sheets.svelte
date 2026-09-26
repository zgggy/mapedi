<script lang="ts">
  import type { SheetId, SettingsTab } from './Rails.svelte';
  import { LAYER_META } from '../workbench/layerMeta';
  import GenDock from '../chrome/GenDock.svelte';
  import GenerationProfiles from '../workbench/GenerationProfiles.svelte';
  import ViewDock from '../chrome/ViewDock.svelte';
  import ProjectPanel from '../chrome/ProjectPanel.svelte';
  import ToolsPanel from '../workbench/ToolsPanel.svelte';
  import ElementList from '../workbench/ElementList.svelte';
  import type { World } from '../../core/types';
  import type { GenerationProfile } from '../../core/generate/profile';
  import type { EditorStore } from '../../app/store.svelte';

  let {
    sheet = $bindable('none'),
    settingsTab = $bindable('generate'),
    world,
    editor: ed,
    viewMode = $bindable('view-2d'),
    reliefSmooth = $bindable(0.35),
    styleId = $bindable('dark'),
    viewAnim = false,
    listExpandedId = $bindable(null),
    onSwitchView,
    onGenerate,
    onValidate,
    onPreset,
    onExportProject,
    onExportPng,
    onExportSvg,
    onExportGeo,
    onExportHeight,
    onImportFile,
    onClearIdb,
    onSearch,
    onHit,
    onMeasure,
    onInfo,
    onDelete,
    onDraw,
    onAnnex,
    onRadius,
    onDrawMode,
    onAnnexMode,
    onFlood,
    onCenter,
    onUndo,
  }: {
    sheet?: SheetId;
    settingsTab?: SettingsTab;
    world: World | null;
    editor: EditorStore;
    viewMode?: 'view-2d' | 'view-globe';
    reliefSmooth?: number;
    styleId?: string;
    viewAnim?: boolean;
    listExpandedId?: string | null;
    onSwitchView: (m: 'view-2d' | 'view-globe') => void;
    onGenerate: (s: number, n: number) => void;
    onValidate: () => void;
    onPreset: (k: 'view' | 'create' | 'draw') => void;
    onExportProject: () => void;
    onExportPng: () => void;
    onExportSvg: () => void;
    onExportGeo: () => void;
    onExportHeight: () => void;
    onImportFile: (f: File) => void;
    onClearIdb: () => void;
    onSearch: () => void;
    onHit: (id: string) => void;
    onMeasure: () => void;
    onInfo: (id: string) => void;
    onDelete: (id: string) => void;
    onDraw: (id: string) => void;
    onAnnex: (id: string) => void;
    onRadius: (v: number) => void;
    onDrawMode: () => void;
    onAnnexMode: () => void;
    onFlood: () => void;
    onCenter: () => void;
    onUndo: () => void;
  } = $props();
</script>

{#if sheet === 'layers'}
  <div class="sheet left-sheet">
    <div class="head">📚 图层</div>
    <ul class="layer-list">
      {#each Object.entries(LAYER_META) as [id, meta] (id)}
        <li>
          <button
            type="button"
            class="layer-row"
            class:active={ed.focusLayer === id}
            onclick={() => {
              ed.focusLayer = id;
              ed.selectedRegionId = null;
            }}
          >
            {meta.emoji} {meta.name}
          </button>
        </li>
      {/each}
    </ul>
  </div>
{/if}

{#if sheet === 'settings'}
  <div class="sheet right-sheet">
    <div class="tabs">
      <button type="button" class:active={settingsTab === 'generate'} onclick={() => (settingsTab = 'generate')}>生成</button>
      <button type="button" class:active={settingsTab === 'view'} onclick={() => (settingsTab = 'view')}>视图</button>
      <button type="button" class:active={settingsTab === 'project'} onclick={() => (settingsTab = 'project')}>项目</button>
    </div>
    <div class="sheet-body">
      {#if settingsTab === 'generate'}
        <GenDock
          bind:seedInput={ed.seedInput}
          bind:densityInput={ed.densityInput}
          bind:densityUnlocked={ed.densityUnlocked}
          generating={ed.generating}
          genProgress={ed.genProgress}
          genStep={ed.genStep}
          onGenerate={onGenerate}
          onValidate={onValidate}
          onPreset={onPreset}
        />
        {#if world}
          <GenerationProfiles
            bind:profiles={ed.profiles}
            onRegenLayer={(id) => ed.regenLayer(id)}
            onRegenAll={() => onGenerate(ed.seedInput, ed.densityInput)}
            onApplyPreset={(n) => ed.applyGenPreset(n)}
          />
        {/if}
      {:else if settingsTab === 'view'}
        <ViewDock bind:viewMode bind:reliefSmooth bind:styleId transitioning={viewAnim} onMode={onSwitchView} />
      {:else}
        {#if world}
          <ProjectPanel
            x={0}
            y={0}
            w={280}
            autosaveAt={ed.autosaveAt}
            bind:searchQ={ed.searchQ}
            searchHits={ed.searchHits}
            measuring={ed.measuring}
            onExportProject={onExportProject}
            onExportPng={onExportPng}
            onExportSvg={onExportSvg}
            onExportGeoJson={onExportGeo}
            onExportHeight={onExportHeight}
            onImportFile={onImportFile}
            onImportHeight={(f) => ed.applyHeightmap(f)}
            onClearIdb={onClearIdb}
            onSearch={onSearch}
            onHit={onHit}
            onMeasure={onMeasure}
          />
        {/if}
      {/if}
    </div>
  </div>
{/if}

{#if sheet === 'workspace'}
  <div class="sheet right-sheet lower">
    {#if !world || ed.focusLayer === 'height'}
      <div class="head">🛠️ 工作区</div>
      <p class="dim">请先在左侧选择一个图层。</p>
    {:else}
      <div class="head">🛠️ 工作区 · {LAYER_META[ed.focusLayer]?.name}</div>
      <ToolsPanel
        focusLayer={ed.focusLayer}
        meta={LAYER_META}
        continents={world.regions.filter((r) => r.layerId === 'landsea' && r.attributes?.kind === 'continent').length}
        rivers={world.rivers.size}
        drawActive={ed.draw.active}
        brushRadius={ed.draw.radiusDeg}
        annexPick={ed.annexPick}
        onRadius={onRadius}
        onDrawMode={onDrawMode}
        onAnnexMode={onAnnexMode}
        onFlood={onFlood}
        onCenter={onCenter}
        onUndo={onUndo}
      />
      <ElementList
        {world}
        focusLayer={ed.focusLayer}
        bind:selectedRegionId={ed.selectedRegionId}
        bind:expandedId={listExpandedId}
        annexPick={ed.annexPick}
        onSelect={(id) => (ed.selectedRegionId = id)}
        onInfo={onInfo}
        onDelete={onDelete}
        onDraw={onDraw}
        onAnnex={onAnnex}
      />
    {/if}
  </div>
{/if}

<style>
  .sheet {
    position: fixed;
    top: 52px;
    bottom: 52px;
    z-index: 38;
    width: min(360px, calc(100vw - 72px));
    overflow: auto;
    padding: 12px;
    background: rgba(18, 20, 26, 0.92);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    backdrop-filter: blur(12px);
  }
  .left-sheet {
    left: 48px;
  }
  .right-sheet {
    right: 48px;
  }
  .right-sheet.lower {
    top: auto;
    height: min(420px, 50vh);
    bottom: 52px;
  }
  .head {
    font-weight: 600;
    margin-bottom: 10px;
  }
  .tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 10px;
  }
  .tabs button {
    flex: 1;
    padding: 6px;
    border-radius: 8px;
    font-size: 12px;
  }
  .tabs button.active {
    background: rgba(107, 124, 147, 0.4);
  }
  .sheet-body {
    min-height: 80px;
  }
  .layer-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .layer-row {
    width: 100%;
    text-align: left;
    margin-bottom: 4px;
    padding: 10px;
  }
  .layer-row.active {
    background: rgba(107, 124, 147, 0.35);
  }
  .dim {
    color: var(--text-dim);
  }
</style>
