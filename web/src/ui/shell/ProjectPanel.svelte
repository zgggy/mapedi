<script lang="ts">
  /**
   * 生成面板（原 TopBar/项目面板拆出的「生成」节，设计稿 §6 + §8 分期修订）。
   *
   * 文件/导入导出/世界名已迁顶栏世界名菜单（§2.2），本面板只留生成与地形参数，
   * **暂留到 U2**——生成入口迁入左轨工作区的生成子面板后，本面板随 Dock 一并退役。
   * （全库用户可达的生成入口只有这一条，U1 不许把它切断。）
   */
  import CapsuleSlider from './CapsuleSlider.svelte';
  import PanelShell from './PanelShell.svelte';
  import type { WorldShape } from '../../core/layer/genTypes';
  import { HARD_MAX_DENSITY } from '../../core/world';

  let {
    open = $bindable(false),
    generating = false,
    genProgress = 0,
    genStep = '',
    seedInput = '1',
    densityInput = 100000,
    shape = null as WorldShape | null,
    onGenerate,
    onShape,
  }: {
    open?: boolean;
    generating?: boolean;
    genProgress?: number;
    genStep?: string;
    seedInput?: string;
    densityInput?: number;
    shape?: WorldShape | null;
    onGenerate: (seed: number, n: number) => void;
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

<PanelShell title="生成" icon="🎲" {open} side="float" width={320} x={420} y={56} onCollapse={() => (open = false)}>
  <div class="body">
    <section>
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
          <label class="sm">低纬倾向 <CapsuleSlider min={0} max={1} step={0.05} value={shape.latBias} label="中低纬大陆倾向" width={90} onInput={(v) => onShape('latBias', v)} /></label>
          <label class="sm">侵蚀 <input type="number" min="0" max="6" value={shape.erosion} onchange={(e) => onShape('erosion', Math.max(0, Math.min(6, Number(e.currentTarget.value) || 0)))} /></label>
        </div>
      {/if}
      {#if generating}
        <div class="prog"><div class="fill" style="width:{genProgress}%"></div><span>{genStep} {genProgress}%</span></div>
      {/if}
    </section>
  </div>
</PanelShell>

<style>
  .body section {
    margin-bottom: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 6px 0;
  }
  .row label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .row input[type='number'] {
    width: 74px;
  }
  .row input:not([type]) {
    width: 92px;
  }
  .row input {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text, #ddd);
    border: 1px solid var(--border, #333);
    border-radius: 5px;
    font-size: 11px;
    padding: 3px 5px;
  }
  .row button {
    padding: 3px 10px;
    border: 1px solid var(--border, #333);
    background: transparent;
    color: var(--text, #ddd);
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
  }
  .row button.primary {
    background: var(--accent, #c9a24a);
    color: #1a1408;
    border-color: var(--accent, #c9a24a);
    font-weight: 600;
  }
  .row button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .row button.dice {
    padding: 3px 6px;
  }
  .tiered {
    display: inline-flex;
    border: 1px solid var(--border, #333);
    border-radius: 5px;
    overflow: hidden;
  }
  .tiered button {
    border: 0;
    border-radius: 0;
    border-right: 1px solid var(--border, #333);
    font-size: 11px;
    padding: 3px 8px;
  }
  .tiered button:last-child {
    border-right: 0;
  }
  .tiered button.active {
    background: var(--accent, #c9a24a);
    color: #1a1408;
  }
  .sm {
    font-size: 11px;
    color: var(--text-dim);
  }
  .prog {
    position: relative;
    height: 16px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
    margin-top: 6px;
  }
  .prog .fill {
    height: 100%;
    background: linear-gradient(90deg, rgba(240, 195, 106, 0.85), rgba(216, 164, 82, 0.85));
    transition: width 0.2s ease;
  }
  .prog span {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 10px;
    color: var(--text, #ddd);
    font-variant-numeric: tabular-nums;
  }
</style>
