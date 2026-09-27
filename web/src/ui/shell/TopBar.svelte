<script lang="ts">
  import type { ViewMode } from './shell';
  import { HARD_MAX_DENSITY } from '../../core/world';

  let {
    open = $bindable(false),
    mapName = '未命名世界',
    viewMode = 'view-2d',
    styleId = 'dark',
    reliefSmooth = 0.35,
    generating = false,
    genProgress = 0,
    genStep = '',
    seedInput = '1',
    densityInput = 100000,
    autosaveAt = '',
    /* 球面参数（顶栏内展示） */
    globeShowAxis = true,
    globeShowEcliptic = true,
    globeSpin = true,
    globeTilt = 23.4,
    globeRotHours = 24,
    onGenerate,
    onSwitchView,
    onStyle,
    onRelief,
    onExport,
    onImport,
    onClearCache,
    onGlobeShowAxis,
    onGlobeShowEcliptic,
    onGlobeSpin,
    onGlobeTilt,
    onGlobeRotHours,
  }: {
    open?: boolean;
    mapName?: string;
    viewMode?: ViewMode;
    styleId?: string;
    reliefSmooth?: number;
    generating?: boolean;
    genProgress?: number;
    genStep?: string;
    seedInput?: string;
    densityInput?: number;
    autosaveAt?: string;
    globeShowAxis?: boolean;
    globeShowEcliptic?: boolean;
    globeSpin?: boolean;
    globeTilt?: number;
    globeRotHours?: number;
    onGenerate: (seed: number, n: number) => void;
    onSwitchView: (m: ViewMode) => void;
    onStyle: (s: string) => void;
    onRelief: (v: number) => void;
    onExport: (kind: string) => void;
    onImport: (kind: string, file: File) => void;
    onClearCache: () => void;
    onGlobeShowAxis?: (v: boolean) => void;
    onGlobeShowEcliptic?: (v: boolean) => void;
    onGlobeSpin?: (v: boolean) => void;
    onGlobeTilt?: (v: number) => void;
    onGlobeRotHours?: (v: number) => void;
  } = $props();

  let hovered = $state(false);
  let expanded = $state(false);

  function onEnter() {
    hovered = true;
  }
  function onLeave() {
    hovered = false;
    expanded = false;
  }
  function toggleExpand() {
    expanded = !expanded;
  }

  const showBar = $derived(hovered || expanded);
</script>

<div class="top" onmouseenter={onEnter} onmouseleave={onLeave} role="presentation">
  {#if !showBar}
    <button
      type="button"
      class="pill-hit"
      aria-label="展开项目栏"
      title="展开项目栏"
      onclick={() => { hovered = true; }}
    >
      <span class="pill" aria-hidden="true"></span>
    </button>
  {:else}
    <div class="panel">
      <button type="button" class="head" onclick={toggleExpand}>
        <span class="name">{mapName}</span>
        <span class="dim">自动保存 {autosaveAt || '…'}</span>
      </button>
      {#if expanded}
        <div class="body">
          <section>
            <h3>生成</h3>
            <div class="row">
              <label>种子 <input value={seedInput} oninput={(e) => (seedInput = e.currentTarget.value)} />
                <button type="button" class="dice" title="随机种子" onclick={() => (seedInput = String(Math.floor(Math.random() * 0xFFFFFFFF)))}>🎲</button>
              </label>
              <label>地块 <input type="number" min="100" max={HARD_MAX_DENSITY} value={densityInput} onchange={(e) => (densityInput = Number(e.currentTarget.value) || densityInput)} /></label>
              <button type="button" class="primary" disabled={generating} onclick={() => onGenerate(Number(seedInput) || 1, densityInput)}>🎲 生成</button>
            </div>
            {#if generating}
              <div class="prog"><div class="fill" style="width:{genProgress}%"></div><span>{genStep} {genProgress}%</span></div>
            {/if}
          </section>
          <section>
            <h3>视图</h3>
            <div class="row">
              <button type="button" class:active={viewMode === 'view-2d'} onclick={() => onSwitchView('view-2d')}>🗺️ 平面</button>
              <button type="button" class:active={viewMode === 'view-globe'} onclick={() => onSwitchView('view-globe')}>🌐 球面</button>
              <select value={styleId} onchange={(e) => onStyle(e.currentTarget.value)}>
                <option value="dark">暗色</option>
                <option value="parchment">羊皮纸</option>
                <option value="neon">科幻</option>
              </select>
              <label class="sm">平滑 <input type="range" min="0" max="1" step="0.05" value={reliefSmooth} oninput={(e) => onRelief(Number(e.currentTarget.value))} /></label>
            </div>
            {#if viewMode === 'view-globe'}
              <div class="row globe-params">
                <label class="sm"><input type="checkbox" checked={globeShowAxis} onchange={(e) => onGlobeShowAxis?.(e.currentTarget.checked)} /> 轴/赤道</label>
                <label class="sm"><input type="checkbox" checked={globeShowEcliptic} onchange={(e) => onGlobeShowEcliptic?.(e.currentTarget.checked)} /> 黄道</label>
                <label class="sm"><input type="checkbox" checked={globeSpin} onchange={(e) => onGlobeSpin?.(e.currentTarget.checked)} /> 自转预览</label>
                <label class="sm">倾角 <input type="range" min="0" max="60" step="0.5" value={globeTilt} oninput={(e) => onGlobeTilt?.(Number(e.currentTarget.value))} /> {globeTilt.toFixed(1)}°</label>
                <label class="sm">自转 <input type="range" min="6" max="48" step="1" value={globeRotHours} oninput={(e) => onGlobeRotHours?.(Number(e.currentTarget.value))} /> {globeRotHours}h</label>
              </div>
              <p class="dim">球面贴图 = 平面 2D 管线先渲染再映射，内容与平面一致。</p>
            {/if}
          </section>
          <section>
            <h3>项目</h3>
            <div class="row">
              <button type="button" onclick={() => onExport('json')}>导出</button>
              <button type="button" onclick={() => onExport('png')}>PNG</button>
              <button type="button" onclick={() => onExport('svg')}>SVG</button>
              <label class="file">导入<input type="file" accept=".json,.gz,.mapedi.json.gz" onchange={(e) => { const f = e.currentTarget.files?.[0]; if (f) onImport('json', f); }} /></label>
              <button type="button" onclick={onClearCache}>清自动存档</button>
            </div>
          </section>
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .top {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 60;
    display: flex;
    justify-content: center;
    pointer-events: none;
  }
  .top > * {
    pointer-events: auto;
  }
  /* 触发区比显示条更大 */
  .pill-hit {
    position: relative;
    width: 56px;
    height: 28px;
    margin-top: 0;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    display: flex;
    align-items: flex-start;
    justify-content: center;
  }
  /* 显示条：更窄；底色与 panel 相同；边框与其它 panel 一致 */
  .pill {
    display: block;
    width: 28px;
    height: 8px;
    margin-top: 8px;
    border-radius: 4px;
    background: rgba(12, 14, 20, 0.94);
    border: 1px solid var(--panel-border);
    box-shadow: none;
    pointer-events: none;
  }
  .pill-hit:hover .pill {
    background: rgba(18, 20, 26, 0.98);
  }
  .panel {
    width: min(460px, calc(100vw - 32px));
    background: rgba(12, 14, 20, 0.94);
    border: 1px solid var(--panel-border);
    border-top: none;
    border-radius: 0 0 12px 12px;
    overflow: hidden;
    font-size: 12px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.35);
  }
  .head {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    width: 100%;
    padding: 8px 12px;
    background: transparent;
    border: none;
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
  }
  .head .name {
    font-weight: 600;
  }
  .head .dim {
    color: var(--text-dim);
    font-size: 11px;
  }
  .body .dim {
    color: var(--text-dim);
    font-size: 10px;
    margin: 4px 0 0;
  }
  .globe-params {
    align-items: center;
  }
  .body {
    padding: 0 12px 10px;
    border-top: 1px solid var(--panel-border);
    max-height: 40vh;
    overflow: auto;
  }
  section {
    margin-top: 8px;
  }
  h3 {
    margin: 0 0 4px;
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    text-align: center;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    justify-content: center;
  }
  .row label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 12px;
  }
  .row input[type='number'],
  .row input:not([type]) {
    width: 72px;
  }
  .row .sm input[type='range'] {
    width: 80px;
  }
  .primary {
    background: rgba(196, 123, 58, 0.4);
  }
  .prog {
    display: flex;
    gap: 8px;
    align-items: center;
    margin-top: 4px;
    font-size: 11px;
    color: var(--text-dim);
    justify-content: center;
  }
  .prog .fill {
    height: 4px;
    background: #3d9a6a;
    flex: 1;
  }
  .file {
    cursor: pointer;
    padding: 4px 8px;
    border: 1px dashed var(--panel-border);
    font-size: 12px;
  }
  .file input {
    display: none;
  }
</style>
