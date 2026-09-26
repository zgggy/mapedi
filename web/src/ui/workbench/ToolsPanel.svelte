<script lang="ts">
  import type { LayerMeta } from './layerMeta';

  let {
    focusLayer,
    meta,
    continents = 0,
    rivers = 0,
    onDrawMode,
    drawActive = false,
    brushRadius = 1.5,
    onRadius,
    onFlood,
    onCenter,
    onUndo,
    onAnnexMode,
    annexPick = false,
  }: {
    focusLayer: string;
    meta: Record<string, LayerMeta>;
    continents?: number;
    rivers?: number;
    onDrawMode: () => void;
    drawActive?: boolean;
    brushRadius?: number;
    onRadius: (v: number) => void;
    onFlood: () => void;
    onCenter: () => void;
    onUndo: () => void;
    onAnnexMode: () => void;
    annexPick?: boolean;
  } = $props();

  const m = $derived(meta[focusLayer]);
  const isHeight = $derived(focusLayer === 'height');
  const isNet = $derived(focusLayer === 'road' || focusLayer === 'route');
</script>

<div class="wb-head">
  {m?.emoji} {m?.name}
  <span class="dim tag">{isHeight ? '场工具' : '元素工具'}</span>
</div>

{#if isHeight}
  <p class="dim">大陆与河网请用顶部「生成」。</p>
  <p class="dim">大陆 {continents} · 河段 {rivers}</p>
  <div class="row">
    <label>
      笔刷半径 {brushRadius.toFixed(1)}°
      <input
        type="range"
        min="0.3"
        max="8"
        step="0.1"
        value={brushRadius}
        oninput={(e) => onRadius(Number(e.currentTarget.value))}
      />
    </label>
  </div>
  <div class="row">
    <button type="button" onclick={onFlood}>🌊 填充陆地</button>
    <button type="button" onclick={onUndo}>↩️ 撤销</button>
  </div>
{:else}
  <div class="row">
    <button type="button" class:active={drawActive} onclick={onDrawMode}>
      🖌️ {drawActive ? '绘制中…' : '开始绘制'}
    </button>
    {#if !isHeight && !isNet}
      <button type="button" class:active={annexPick} onclick={onAnnexMode}>🤝 吞并</button>
    {/if}
    <button type="button" onclick={onFlood}>🌊 填充</button>
    <button type="button" onclick={onCenter}>📍 中心</button>
    <button type="button" onclick={onUndo}>↩️ 撤销</button>
  </div>
  <div class="row">
    <label>
      笔刷半径 {brushRadius.toFixed(1)}°
      <input
        type="range"
        min="0.3"
        max="8"
        step="0.1"
        value={brushRadius}
        oninput={(e) => onRadius(Number(e.currentTarget.value))}
      />
    </label>
  </div>
  <p class="dim">左键刷入 · Shift 减 · Ctrl 与他国分摊 · Esc 结束</p>
{/if}

<style>
  .wb-head {
    font-weight: 600;
    margin-bottom: 8px;
    display: flex;
    align-items: baseline;
    gap: 8px;
  }
  .tag {
    font-weight: 400;
    font-size: 11px;
  }
  .dim {
    color: var(--text-dim);
    font-size: 12px;
  }
  .row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 8px 0;
    align-items: center;
  }
  .row label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    color: var(--text-dim);
    min-width: 140px;
  }
  button.active {
    background: rgba(196, 123, 58, 0.35);
    border-color: rgba(196, 123, 58, 0.6);
  }
</style>
