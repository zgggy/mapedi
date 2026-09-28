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
                <label class="sm">大陆尺度 <CapsuleSlider min={0} max={1} step={0.05} value={shape.continentScale} label="大陆尺度（越大大陆越少越大）" width={90} onInput={(v) => onShape('continentScale', v)} /></label>
                <label class="sm">海岸破碎 <CapsuleSlider min={0} max={1} step={0.05} value={shape.coastBreak} label="海岸破碎度（域扭曲）" width={90} onInput={(v) => onShape('coastBreak', v)} /></label>
                <label class="sm">山脉 <CapsuleSlider min={0} max={1} step={0.05} value={shape.mountain} label="山脉强度" width={90} onInput={(v) => onShape('mountain', v)} /></label>
              </div>
              <div class="row">
                <label class="sm">细节 <CapsuleSlider min={0} max={1} step={0.05} value={shape.detail} label="细节量" width={90} onInput={(v) => onShape('detail', v)} /></label>
                <label class="sm">海床 <CapsuleSlider min={0} max={1} step={0.05} value={shape.seaRugged} label="海底起伏" width={90} onInput={(v) => onShape('seaRugged', v)} /></label>
                <label class="sm">平整 <CapsuleSlider min={0} max={1} step={0.05} value={shape.flatness} label="平整率（越大地面越贴海平面）" width={90} onInput={(v) => onShape('flatness', v)} /></label>
              </div>
              <div class="row">
                <label class="sm"><input type="checkbox" checked={shape.polar} onchange={(e) => onShape('polar', e.currentTarget.checked)} /> 穿极大陆</label>
                <label class="sm">侵蚀 <input type="number" min="0" max="6" value={shape.erosion} onchange={(e) => onShape('erosion', Math.max(0, Math.min(6, Number(e.currentTarget.value) || 0)))} /></label>
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
