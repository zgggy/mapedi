<script lang="ts">
  /**
   * 段4 低频折叠区（设计稿 §3.3 / C8）：`[生成 ▾]` + `[层设置 ▾]` 两条把手。
   *
   * **生成把手 = 长按进度（D5，2026-09-29 拍板）**：
   * - **单击** = 展开/收起参数子面板（轨内嵌，非浮窗）
   * - **按住** = 进度从左到右填满 → 满格**直接触发生成**（当前参数）；松手未满 = 取消
   * - 无确认对话框；键盘 Enter = 触发生成（a11y 等价路径）
   *
   * 内容自原项目面板「生成」节整体迁入（U2 分期修订：生成入口不许有空窗）。
   */
  import CapsuleSlider from './CapsuleSlider.svelte';
  import type { WorldShape } from '../../core/layer/genTypes';
  import { HARD_MAX_DENSITY } from '../../core/world';

  let {
    generating = false,
    genProgress = 0,
    genStep = '',
    seedInput = '1',
    densityInput = 100000,
    shape = null as WorldShape | null,
    onGenerate,
    onShape,
    onOpenStyle,
  }: {
    generating?: boolean;
    genProgress?: number;
    genStep?: string;
    seedInput?: string;
    densityInput?: number;
    shape?: WorldShape | null;
    onGenerate: (seed: number, n: number) => void;
    onShape?: (key: keyof WorldShape, value: number | string | boolean) => void;
    /** 层设置把手 → 与行右键菜单「显示参数…」同一个卡片（§4 单源） */
    onOpenStyle?: (x: number, y: number) => void;
  } = $props();

  const HOLD_MS = 900;

  const LAND_TIERS: { label: string; v: number }[] = [
    { label: '小', v: 0.08 },
    { label: '中', v: 0.15 },
    { label: '大', v: 0.25 },
    { label: '特大', v: 0.4 },
  ];

  let genOpen = $state(false);
  let filling = $state(false);
  let filled = $state(false);
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  function fire() {
    if (generating) return;
    onGenerate(Number(seedInput) || 1, densityInput);
  }
  function genDown() {
    if (generating) return;
    filling = true;
    filled = false;
    holdTimer = setTimeout(() => {
      filled = true;
    }, HOLD_MS);
  }
  function genUp() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    const didFill = filled;
    filling = false;
    filled = false;
    if (didFill) fire();
    else genOpen = !genOpen;
  }
  function genCancel() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    filling = false;
    filled = false;
  }
</script>

<div class="wrap">
  <div class="handles">
    <button
      type="button"
      class="handle"
      class:open={genOpen}
      class:filling
      title="单击展开参数 · 长按直接生成"
      onpointerdown={genDown}
      onpointerup={genUp}
      onpointerleave={genCancel}
      onpointercancel={genCancel}
      oncontextmenu={(e) => e.preventDefault()}
      onkeydown={(e) => {
        // 键盘可达（a11y 等价路径）：Enter = 触发生成；空格 = 展开/收起参数
        if (e.key === 'Enter') {
          e.preventDefault();
          fire();
        } else if (e.key === ' ') {
          e.preventDefault();
          genOpen = !genOpen;
        }
      }}
    >
      <span class="fill" style="transition-duration:{HOLD_MS}ms"></span>
      <span class="lb">🎲 生成 {genOpen ? '▾' : '▸'}</span>
    </button>
    <button
      type="button"
      class="handle"
      title="该层显示参数（与行右键菜单同一卡片）"
      onclick={(e) => onOpenStyle?.(e.clientX, e.clientY)}
    >🎨 层设置 ▸</button>
  </div>

  {#if genOpen}
    <div class="panel">
      <div class="row">
        <label>种子 <input value={seedInput} oninput={(e) => (seedInput = e.currentTarget.value)} />
          <button type="button" class="dice" title="随机种子" onclick={() => (seedInput = String(Math.floor(Math.random() * 0xFFFFFFFF)))}>🎲</button>
        </label>
        <label>地块 <input type="number" min="100" max={HARD_MAX_DENSITY} value={densityInput} onchange={(e) => (densityInput = Number(e.currentTarget.value) || densityInput)} /></label>
        <button type="button" class="primary" disabled={generating} onclick={fire}>🎲 生成</button>
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
        <div class="prog"><div class="pfill" style="width:{genProgress}%"></div><span>{genStep} {genProgress}%</span></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap {
    flex: 0 0 auto;
    border-top: 1px solid var(--panel-border);
  }
  .handles {
    display: flex;
    gap: 6px;
    padding: 6px 8px;
  }
  .handle {
    position: relative;
    flex: 1;
    overflow: hidden;
    border: 1px solid var(--panel-border);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text, #ddd);
    border-radius: 8px;
    padding: 5px 8px;
    font-size: 11px;
    line-height: 1.2;
    cursor: pointer;
    user-select: none;
    touch-action: none;
  }
  .handle:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .handle.open {
    border-color: rgba(240, 195, 106, 0.5);
  }
  /* 长按进度（D5）：满格 = 触发生成 */
  .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 0;
    background: linear-gradient(90deg, rgba(240, 195, 106, 0.75), rgba(216, 164, 82, 0.9));
    /* 时长由行内 style 给（HOLD_MS）；非 filling 时回到 0 */
    transition: width 0s linear;
    pointer-events: none;
  }
  .filling .fill {
    width: 100%;
  }
  .lb {
    position: relative;
    z-index: 1;
  }
  .panel {
    padding: 2px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 4px 0;
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
  .prog {
    position: relative;
    height: 16px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
    margin-top: 4px;
  }
  .pfill {
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
