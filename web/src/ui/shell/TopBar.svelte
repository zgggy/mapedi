<script lang="ts">
  import CapsuleSlider from './CapsuleSlider.svelte';
  import PanelShell from './PanelShell.svelte';
  import type { WorldShape } from '../../core/layer/genTypes';
  import { HARD_MAX_DENSITY } from '../../core/world';

  let {
    open = $bindable(false),
    mapName = '未命名世界',
    generating = false,
    genProgress = 0,
    genStep = '',
    seedInput = '1',
    densityInput = 100000,
    autosaveAt = '',
    shape = null as WorldShape | null,
    onGenerate,
    onExport,
    onImport,
    onClearCache,
    onShape,
    onPreset,
  }: {
    open?: boolean;
    mapName?: string;
    generating?: boolean;
    genProgress?: number;
    genStep?: string;
    seedInput?: string;
    densityInput?: number;
    autosaveAt?: string;
    shape?: WorldShape | null;
    onGenerate: (seed: number, n: number) => void;
    onExport: (kind: string) => void;
    onImport: (kind: string, file: File) => void;
    onClearCache: () => void;
    onShape?: (key: keyof WorldShape, value: number | string | boolean) => void;
    onPreset?: (name: string) => void;
  } = $props();

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
                <span class="sm">预设
                  <span class="tiered">
                    <button type="button" onclick={() => onPreset?.('群岛')}>群岛</button>
                    <button type="button" onclick={() => onPreset?.('巨型山脉大陆')}>巨型山脉大陆</button>
                    <button type="button" onclick={() => onPreset?.('关闭域扭曲')}>关闭域扭曲</button>
                  </span>
                </span>
              </div>
              <div class="row">
                <label class="sm">海平面 <input type="number" min="-63" max="64" value={shape.seaLevel} onchange={(e) => onShape('seaLevel', Math.max(-63, Math.min(64, Number(e.currentTarget.value) || 0)))} /></label>
                <label class="sm">尺度 <CapsuleSlider min={4} max={64} step={1} value={shape.scale} label="噪声尺度（越大大陆越多越小）" width={80} onInput={(v) => onShape('scale', v)} /></label>
                <label class="sm">层数 <input type="number" min="1" max="10" value={shape.octaves} onchange={(e) => onShape('octaves', Math.max(1, Math.min(10, Number(e.currentTarget.value) || 1)))} /></label>
              </div>
              <div class="row">
                <label class="sm">频比 <CapsuleSlider min={1.2} max={3.2} step={0.1} value={shape.lacunarity} label="lacunarity" width={80} onInput={(v) => onShape('lacunarity', v)} /></label>
                <label class="sm">持续 <CapsuleSlider min={0.2} max={0.8} step={0.01} value={shape.persistence} label="persistence" width={80} onInput={(v) => onShape('persistence', v)} /></label>
                <label class="sm">多分形 <CapsuleSlider min={0.6} max={1.6} step={0.05} value={shape.hmfGain} label="hmf_gain（高地细节增益）" width={80} onInput={(v) => onShape('hmfGain', v)} /></label>
              </div>
              <div class="row">
                <label class="sm">扭曲 <CapsuleSlider min={0} max={5} step={0.1} value={shape.warpStrength} label="warp_strength（域扭曲）" width={80} onInput={(v) => onShape('warpStrength', v)} /></label>
                <label class="sm">扭曲尺度 <CapsuleSlider min={4} max={80} step={1} value={shape.warpScale} label="warp_scale" width={80} onInput={(v) => onShape('warpScale', v)} /></label>
                <label class="sm">偏移 <CapsuleSlider min={-0.3} max={0.3} step={0.01} value={shape.hmfOffset} label="hmf_offset" width={80} onInput={(v) => onShape('hmfOffset', v)} /></label>
              </div>
            {/if}
            {#if generating}
              <div class="prog"><div class="fill" style="width:{genProgress}%"></div><span>{genStep} {genProgress}%</span></div>
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
