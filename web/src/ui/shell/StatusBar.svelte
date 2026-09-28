<script lang="ts">
  let {
    hover = null,
    status = '',
    fps = 0,
    zoom = 1,
  }: {
    hover?: { cellId: number; lon: number; lat: number; height: number } | null;
    status?: string;
    fps?: number;
    /** 缩放级别（相对默认视野的倍率） */
    zoom?: number;
    /** 渲染后端标识（gpu / canvas） */
  } = $props();
</script>

<div class="pill">
  {#if hover}
    <span>#{hover.cellId}</span>
    <span>{hover.lon.toFixed(1)}°,{hover.lat.toFixed(1)}°</span>
    <span class="h">高度 {hover.height.toFixed(3)}</span>
    <span class="dim">{hover.height > 0 ? '陆地' : hover.height === 0 ? '海平面' : '海洋'}</span>
  {/if}
  <span class="st">{status}</span>
  <span class="be gpu">GPU</span>
  <span class="dim">×{zoom.toFixed(2)}</span>
  <span class="fps">{fps}</span>
</div>

<style>
  .pill {
    position: fixed;
    left: 50%;
    bottom: 8px;
    transform: translateX(-50%);
    z-index: 55;
    display: flex;
    gap: 10px;
    align-items: center;
    height: 26px;
    padding: 0 14px;
    font-size: 11px;
    background: rgba(10, 12, 18, 0.85);
    border: 1px solid var(--panel-border);
    border-radius: 13px;
  }
  .st {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 40vw;
  }
  .be {
    opacity: 0.75;
    font-size: 11px;
  }
  .be.gpu {
    color: var(--accent, #7ec8ff);
  }
  .fps {
    color: var(--text-dim);
  }
</style>
