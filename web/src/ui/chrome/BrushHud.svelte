<script lang="ts">
  import type { DrawSession, DrawTool } from '../../core/draw/brush';

  let {
    draw = $bindable(),
    label = '',
    roadBreaks = 0,
    onTool,
    onFlood,
    onSetCenter,
    onEnd,
  }: {
    draw?: DrawSession;
    label?: string;
    roadBreaks?: number;
    onTool: (t: DrawTool) => void;
    onFlood: () => void;
    onSetCenter: () => void;
    onEnd: () => void;
  } = $props();
</script>

{#if draw?.active}
  <div class="brush-hud">
    <span>🖌️ {label}</span>
    <button type="button" class:active={draw.tool === 'brush'} onclick={() => onTool('brush')}>
      笔刷 B
    </button>
    <button type="button" class:active={draw.tool === 'weight'} onclick={() => onTool('weight')}>
      权重 W
    </button>
    {#if draw.tool === 'road'}
      <span class="dim">断点 {roadBreaks}</span>
    {/if}
    <label>
      半径
      <input type="range" min="0.3" max="6" step="0.1" bind:value={draw.radiusDeg} />
    </label>
    <span class="dim">{draw.radiusDeg.toFixed(1)}°</span>
    <button type="button" onclick={onFlood}>🌊 填充</button>
    <button type="button" onclick={onSetCenter}>📍 中心</button>
    <button type="button" onclick={onEnd}>完成 Esc</button>
    <span class="dim">Shift=移除 · 中键拖=平移 · 滚轮=缩放</span>
  </div>
{/if}

<style>
  .brush-hud {
    position: fixed;
    left: 50%;
    bottom: 52px;
    transform: translateX(-50%);
    z-index: 36;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    padding: 8px 12px;
    background: rgba(196, 123, 58, 0.14);
    border: 1px solid rgba(196, 123, 58, 0.35);
    border-radius: 14px;
    font-size: 12px;
    opacity: 0.75;
    max-width: min(720px, calc(100vw - 120px));
    backdrop-filter: blur(6px);
  }
  .brush-hud:hover {
    opacity: 0.95;
  }
  .brush-hud input[type='range'] {
    width: 100px;
  }
  .brush-hud button.active {
    background: rgba(196, 123, 58, 0.45);
  }
  .dim {
    color: var(--text-dim);
  }
</style>
