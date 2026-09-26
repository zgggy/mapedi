<script lang="ts">
  let {
    open = $bindable(false),
    width = $bindable(320),
    title = '',
    children,
  }: {
    open?: boolean;
    width?: number;
    title?: string;
    children?: import('svelte').Snippet;
  } = $props();

  let resizing = false;
  let startX = 0;
  let startW = 0;

  function onPointerDown(e: PointerEvent) {
    resizing = true;
    startX = e.clientX;
    startW = width;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!resizing) return;
    width = Math.max(220, Math.min(560, startW + (startX - e.clientX)));
  }
  function onPointerUp(e: PointerEvent) {
    resizing = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }
</script>

{#if open}
  <aside class="wp" style="width:{width}px">
    {#if title}
      <div class="hd">{title}</div>
    {/if}
    <div class="bd">
      {#if children}{@render children()}{/if}
    </div>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="rz"
      role="separator"
      onpointerdown={onPointerDown}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
    ></div>
  </aside>
{/if}

<style>
  .wp {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    background: rgba(12, 14, 20, 0.94);
    border-left: 1px solid var(--panel-border);
  }
  .hd {
    flex: 0 0 28px;
    display: flex;
    align-items: center;
    padding: 0 10px;
    font-size: 12px;
    font-weight: 600;
    border-bottom: 1px solid var(--panel-border);
  }
  .bd {
    flex: 1;
    overflow: auto;
    /* 与图层面板一致：内容自带 padding，外壳不再夹一层 */
    padding: 0;
    font-size: 12px;
  }
  .rz {
    position: absolute;
    top: 0;
    left: -3px;
    bottom: 0;
    width: 6px;
    cursor: col-resize;
    background: transparent;
  }
  .rz:hover {
    background: rgba(240, 195, 106, 0.25);
  }
</style>
