<script lang="ts">
  import CapsuleSlider from './CapsuleSlider.svelte';
  import PanelShell from './PanelShell.svelte';
  import type { ViewMode } from './shell';
  import type { WorldShape } from '../../core/layer/genTypes';
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
    shape = null as WorldShape | null,
    /* 球面参数（顶栏内展示） */
    globeShowAxis = true,
    globeShowEcliptic = true,
    globeSpin = true,
    globeTilt = 23.4,
    globeRotHours = 24,
    globeFov = 45,
    onGenerate,
    onSwitchView,
    onStyle,
    onRelief,
    onExport,
    onImport,
    onClearCache,
    onShape,
    onGlobeShowAxis,
    onGlobeShowEcliptic,
    onGlobeSpin,
    onGlobeTilt,
    onGlobeRotHours,
    onGlobeFov,
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
    shape?: WorldShape | null;
    globeShowAxis?: boolean;
    globeShowEcliptic?: boolean;
    globeSpin?: boolean;
    globeTilt?: number;
    globeRotHours?: number;
    globeFov?: number;
    onGenerate: (seed: number, n: number) => void;
    onSwitchView: (m: ViewMode) => void;
    onStyle: (s: string) => void;
    onRelief: (v: number) => void;
    onExport: (kind: string) => void;
    onImport: (kind: string, file: File) => void;
    onClearCache: () => void;
    onShape?: (key: keyof WorldShape, value: number | string | boolean) => void;
    onGlobeShowAxis?: (v: boolean) => void;
    onGlobeShowEcliptic?: (v: boolean) => void;
    onGlobeSpin?: (v: boolean) => void;
    onGlobeTilt?: (v: number) => void;
    onGlobeRotHours?: (v: number) => void;
    onGlobeFov?: (v: number) => void;
  } = $props();

  /** 期望大陆占比档位（小/中/大/特大 → 陆地占比） */
  const LAND_TIERS: { label: string; v: number }[] = [
    { label: '小', v: 0.08 },
    { label: '中', v: 0.15 },
    { label: '大', v: 0.25 },
    { label: '特大', v: 0.4 },
  ];

</script>

<PanelShell title="项目 · {mapName}" icon="🗃" {open} side="float" width={320} x={420} y={56} onCollapse={() => (open = false)}>
  <div class="body">
    <p class="dim" style="margin:0 0 6px">自动保存 {autosaveAt || '…'}</p>
          <section>
            <h3>生成</h3>
            <div class="row">
              <label>种子 <input value={seedInput} oninput={(e) => (seedInput = e.currentTarget.value)} />
                <button type="button" class="dice" title="随机种子" onclick={() => (seedInput = String(Math.floor(Math.random() * 0xFFFFFFFF)))}>🎲</button>
              </label>
              <label>地块 <input type="number" min="100" max={HARD_MAX_DENSITY} value={densityInput} onchange={(e) => (densityInput = Number(e.currentTarget.value) || densityInput)} /></label>
              <button type="button" class="primary" disabled={generating} onclick={() => onGenerate(Number(seedInput) || 1, densityInput)}>🎲 生成</button>
            </div>
            {#if shape && onShape}
              <div class="row">
                <label class="sm">大陆占比
                  <span class="tiered">
                    {#each LAND_TIERS as t}
                      <button type="button" class:active={Math.abs(shape.landRatio - t.v) < 0.005} onclick={() => onShape('landRatio', t.v)}>{t.label}</button>
                    {/each}
                  </span>
                </label>
                <label class="sm">落差 <input type="number" min="20" max="127" value={shape.relief} onchange={(e) => onShape('relief', Math.max(20, Math.min(127, Number(e.currentTarget.value) || 127)))} /></label>
              </div>
              <div class="row">
                <label class="sm">平整 <CapsuleSlider min={0} max={1} step={0.05} value={shape.flatness} label="平整率（越大地面越贴海平面）" width={110} onInput={(v) => onShape('flatness', v)} /></label>
                <label class="sm">大陆数 <input type="number" min="0" max="12" value={shape.continentCount} onchange={(e) => onShape('continentCount', Math.max(0, Math.min(12, Number(e.currentTarget.value) || 0)))} /></label>
                <label class="sm"><input type="checkbox" checked={shape.polar} onchange={(e) => onShape('polar', e.currentTarget.checked)} /> 穿极大陆</label>
              </div>
              <div class="row">
                <label class="sm">崎岖 <CapsuleSlider min={0} max={1} step={0.05} value={shape.roughness} label="山脉崎岖度" width={90} onInput={(v) => onShape('roughness', v)} /></label>
                <label class="sm">海床 <CapsuleSlider min={0} max={1} step={0.05} value={shape.seaRugged} label="海底起伏" width={90} onInput={(v) => onShape('seaRugged', v)} /></label>
                <label class="sm">侵蚀 <input type="number" min="0" max="4" value={shape.erosion} onchange={(e) => onShape('erosion', Math.max(0, Math.min(4, Number(e.currentTarget.value) || 0)))} /></label>
              </div>
            {/if}
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
              <label class="sm">平滑 <CapsuleSlider min={0} max={1} step={0.05} value={reliefSmooth} label="浮雕平滑" width={110} onInput={(v) => onRelief(v)} /></label>
            </div>
            {#if viewMode === 'view-globe'}
              <div class="row globe-params">
                <label class="sm"><input type="checkbox" checked={globeShowAxis} onchange={(e) => onGlobeShowAxis?.(e.currentTarget.checked)} /> 轴/赤道</label>
                <label class="sm"><input type="checkbox" checked={globeShowEcliptic} onchange={(e) => onGlobeShowEcliptic?.(e.currentTarget.checked)} /> 黄道</label>
                <label class="sm"><input type="checkbox" checked={globeSpin} onchange={(e) => onGlobeSpin?.(e.currentTarget.checked)} /> 自转预览</label>
                <label class="sm">倾角 <CapsuleSlider min={0} max={60} step={0.5} value={globeTilt} label="轴倾角" width={110} onInput={(v) => onGlobeTilt?.(v)} /> {globeTilt.toFixed(1)}°</label>
                <label class="sm">自转 <CapsuleSlider min={6} max={48} step={1} value={globeRotHours} label="自转周期" width={110} onInput={(v) => onGlobeRotHours?.(v)} /> {globeRotHours}h</label>
                <label class="sm">视野 <CapsuleSlider min={18} max={150} step={2} value={globeFov} label="相机视野（FOV，越大看得越广）" width={110} onInput={(v) => onGlobeFov?.(v)} /> {Math.round(globeFov)}°</label>
              </div>
              <p class="dim">球面原生渲染（不经平面贴图）；Shift+滚轮 = 视野（FOV）+ 超半球压扁，滚轮 = 缩放距离。</p>
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
</PanelShell>

<style>
  .top > * {
    pointer-events: auto;
  }
  /* 触发区比显示条更大 */
  /* 显示条：更窄；底色与 panel 相同；边框与其它 panel 一致 */
  .pill-hit:hover .pill {
    background: rgba(18, 20, 26, 0.98);
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
  .tiered {
    display: inline-flex;
    gap: 2px;
    margin-left: 4px;
  }
  .tiered button {
    padding: 1px 7px;
    font-size: 11px;
    border: 1px solid var(--border, #333);
    background: transparent;
    color: var(--text, #ddd);
    border-radius: 4px;
    cursor: pointer;
  }
  .tiered button.active {
    background: var(--accent, #c9a24a);
    color: #1a1408;
    border-color: var(--accent, #c9a24a);
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
