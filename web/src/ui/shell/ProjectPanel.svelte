<script lang="ts">
  let {
    x,
    y,
    w,
    autosaveAt,
    searchQ = $bindable(''),
    searchHits,
    measuring = false,
    onExportProject,
    onExportPng,
    onExportSvg,
    onExportGeoJson,
    onExportHeight,
    onImportFile,
    onClearIdb,
    onSearch,
    onHit,
    onMeasure,
  }: {
    x: number;
    y: number;
    w: number;
    autosaveAt: string;
    searchQ?: string;
    searchHits: { id: string; name: string; layerId: string; cells: number }[];
    measuring?: boolean;
    onExportProject: () => void;
    onExportPng: () => void;
    onExportSvg: () => void;
    onExportGeoJson: () => void;
    onExportHeight: () => void;
    onImportFile: (f: File) => void;
    onImportHeight: (f: File) => void;
    onClearIdb: () => void;
    onSearch: () => void;
    onHit: (id: string) => void;
    onMeasure: () => void;
  } = $props();
</script>

<div
  class="proj-overlay"
  style="left:{x}px;top:{y + 36}px;width:{Math.max(w, 220)}px;max-height:70vh"
>
  <div class="wb-head">💾 项目</div>
  <p class="dim">自动保存 {autosaveAt || '…'}</p>
  <div class="row">
    <button type="button" onclick={onExportProject}>📤 项目</button>
    <button type="button" onclick={onExportPng}>🖼️ PNG</button>
    <button type="button" onclick={onExportSvg}>🧩 SVG</button>
    <button type="button" onclick={onExportGeoJson}>🌍 GeoJSON</button>
    <button type="button" onclick={onExportHeight}>⛰️ 高程图</button>
  </div>
  <div class="row">
    <label class="file-btn">
      📥 导入
      <input
        type="file"
        accept=".json,application/json"
        onchange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) onImportFile(f);
        }}
      />
    </label>
    <label class="file-btn">
      ⛰️ 高程图
      <input
        type="file"
        accept="image/*"
        onchange={(e) => {
          const f = e.currentTarget.files?.[0];
          if (f) onImportHeight(f);
          e.currentTarget.value = '';
        }}
      />
    </label>
    <button type="button" onclick={onClearIdb}>🗑️ 清缓存</button>
  </div>
  <div class="row">
    <input placeholder="搜索名称…" bind:value={searchQ} />
    <button type="button" onclick={onSearch}>🔍</button>
  </div>
  {#each searchHits as hit (hit.id)}
    <button type="button" class="hit" onclick={() => onHit(hit.id)}>
      {hit.name} <span class="dim">{hit.layerId} · {hit.cells}c</span>
    </button>
  {/each}
  <div class="row">
    <button type="button" class:active={measuring} onclick={onMeasure}>📏 测距（点图上两点）</button>
  </div>
</div>

<style>
  .proj-overlay {
    position: fixed;
    z-index: 22;
    overflow: auto;
    padding: 10px 12px;
    background: rgba(18, 20, 26, 0.88);
    border: 1px solid var(--panel-border);
    border-radius: 0 0 12px 12px;
    font-size: 12px;
  }
  .wb-head {
    font-weight: 600;
    margin-bottom: 8px;
  }
  .dim {
    color: var(--text-dim);
  }
  .row {
    display: flex;
    gap: 6px;
    margin: 6px 0;
    flex-wrap: wrap;
  }
  .file-btn {
    cursor: pointer;
    padding: 4px 10px;
    border-radius: 8px;
    border: 1px solid var(--panel-border);
    background: rgba(255, 255, 255, 0.06);
    font-size: 12px;
  }
  .file-btn input {
    display: none;
  }
  .hit {
    display: block;
    width: 100%;
    text-align: left;
    margin-bottom: 2px;
    padding: 4px 6px;
  }
  button.active {
    outline: 1px solid rgba(240, 195, 106, 0.6);
  }
</style>
