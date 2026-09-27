<script lang="ts">
  import CapsuleSlider from './CapsuleSlider.svelte';
  import type { DrawSession, DrawTool } from '../../core/draw/brush';

  let {
    draw,
    label = '',
    isHeight = false,
    onTool,
    onEnd,
    onRadius,
  }: {
    draw?: DrawSession;
    label?: string;
    isHeight?: boolean;
    onTool: (t: DrawTool) => void;
    onEnd: () => void;
    onRadius?: (v: number) => void;
  } = $props();
</script>

{#if draw?.active}
  <div class="hud">
    <span class="lab">🖌️ {label}</span>
    <button type="button" class:active={draw.tool === 'brush'} onclick={() => onTool('brush')}>
      笔刷 B
    </button>
    {#if !isHeight}
      <button type="button" class:active={draw.tool === 'weight'} onclick={() => onTool('weight')}>
        权重 W
      </button>
    {/if}
    <label class="r">
      笔刷宽度
      <CapsuleSlider
        min={0.3}
        max={8}
        step={0.1}
        value={draw.radiusDeg}
        label="笔刷宽度"
        width={130}
        onInput={(v) => onRadius?.(v)}
      />
      <span class="dim">{draw.radiusDeg.toFixed(1)}°</span>
    </label>
    {#if isHeight}
      <span class="dim">左键抬升 · Shift 降海</span>
    {/if}
    <button type="button" onclick={onEnd}>完成 Esc</button>
  </div>
{/if}

<style>
  .hud {
    position: fixed;
    left: 50%;
    bottom: 48px;
    transform: translateX(-50%);
    z-index: 46;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: rgba(18, 20, 26, 0.55);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    font-size: 12px;
    opacity: 0.8;
    backdrop-filter: blur(8px);
  }
  .hud:hover {
    opacity: 1;
  }
  .hud .r {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .hud input[type='range'] {
    width: 90px;
  }
  .hud button.active {
    background: rgba(196, 123, 58, 0.4);
  }
  .dim {
    color: var(--text-dim);
  }
</style>
