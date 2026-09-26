<script lang="ts">
  import type { HoverInfo } from '../../render/map2d';

  let {
    hover = null,
    status = '',
    fps = 0,
  }: {
    hover?: HoverInfo | null;
    status?: string;
    fps?: number;
  } = $props();
</script>

<div class="status-strip">
  {#if hover}
    <span>地块 #{hover.cellId}</span>
    <span>{hover.lon.toFixed(1)}° {hover.lat.toFixed(1)}°</span>
    <span>h {hover.height.toFixed(2)}</span>
  {/if}
  <span>{status}</span>
  <span class="dim">{fps} FPS · H 隐藏面板 · Ctrl+Z 撤销</span>
</div>

<style>
  .status-strip {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 8px 12px;
    align-items: center;
    min-height: 28px;
    font-size: 12px;
    white-space: normal;
    max-width: 100%;
  }
  .dim {
    color: var(--text-dim);
  }
</style>
