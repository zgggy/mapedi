<script lang="ts">
  /**
   * 统一面板壳：header（最左收起按钮 + 标题居中，可拖动面板）+ 内容区。
   * 高度随内容增长，最大 0.8 屏高；内容区可滚动且滚动条不显示。
   * 收起 = 整个面板消失（屏幕左下角 Dock 图标可再打开；打开时图标带黄框）。
   */
  import type { Snippet } from 'svelte';

  let {
    title = '',
    icon = '',
    open = true,
    onCollapse,
    side = 'float',
    width = 240,
    x = 240,
    y = 56,
    children,
  }: {
    title?: string;
    /** Dock 图标（面板身份） */
    icon?: string;
    open?: boolean;
    onCollapse?: () => void;
    /** left/right = 初始贴边；float = 悬浮卡片 */
    side?: 'left' | 'right' | 'float';
    width?: number;
    /** 初始左上角坐标 */
    x?: number;
    y?: number;
    children?: Snippet;
  } = $props();

  // —— 面板拖动（header 拖；收起按钮不触发）——
  let pos = $state<{ x: number; y: number } | null>(null);
  let dragging = false;
  let offX = 0;
  let offY = 0;

  function onHeaderDown(e: PointerEvent) {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest?.('button,input,select,textarea')) return;
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // 首次拖动：把贴边定位物化成自由坐标
    pos ??= { x: r.left, y: r.top };
    dragging = true;
    offX = e.clientX - pos.x;
    offY = e.clientY - pos.y;
    window.addEventListener('pointermove', onHeaderMove);
    window.addEventListener('pointerup', onHeaderUp);
    window.addEventListener('pointercancel', onHeaderUp);
  }
  function onHeaderMove(e: PointerEvent) {
    if (!dragging || !pos) return;
    pos = {
      x: Math.max(0, Math.min(window.innerWidth - 80, e.clientX - offX)),
      y: Math.max(0, Math.min(window.innerHeight - 40, e.clientY - offY)),
    };
  }
  function onHeaderUp() {
    dragging = false;
    window.removeEventListener('pointermove', onHeaderMove);
    window.removeEventListener('pointerup', onHeaderUp);
    window.removeEventListener('pointercancel', onHeaderUp);
  }

  const style = $derived(
    pos
      ? `left:${pos.x}px;top:${pos.y}px;width:${width}px;`
      : side === 'right'
        ? `right:8px;top:48px;width:${width}px;`
        : side === 'left'
          ? `left:8px;top:48px;width:${width}px;`
          : `left:${x}px;top:${y}px;width:${width}px;`,
  );
</script>

{#if open}
  <aside class="ps" class:float={!!pos || side === 'float'} {style}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="hd" role="banner" onpointerdown={onHeaderDown}>
      <button type="button" class="collapse" title="收起面板" aria-label="收起面板" onclick={() => onCollapse?.()}>⊟</button>
      <span class="ttl">{#if icon}<span class="ticon">{icon}</span>{/if}{title}</span>
    </div>
    <div class="bd">
      {#if children}{@render children()}{/if}
    </div>
  </aside>
{/if}

<style>
  .ps {
    position: fixed;
    z-index: 50;
    display: flex;
    flex-direction: column;
    /* 高度随内容增长，最大 0.8 屏高 */
    max-height: 80vh;
    background: rgba(16, 19, 26, 0.94);
    border: 1px solid var(--panel-border);
    font-size: 12px;
    user-select: none;
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    overflow: hidden;
    backdrop-filter: blur(8px);
  }
  .hd {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 32px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--panel-border);
    flex: 0 0 auto;
    cursor: grab;
    touch-action: none;
  }
  .hd:active {
    cursor: grabbing;
  }
  .collapse {
    position: relative;
    z-index: 1;
    flex: 0 0 auto;
    border: 1px solid var(--panel-border);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    border-radius: 7px;
    padding: 3px 7px;
    cursor: pointer;
    font-size: 12px;
    line-height: 1;
  }
  .collapse:hover {
    background: rgba(255, 255, 255, 0.12);
  }
  .ttl {
    position: absolute;
    left: 0;
    right: 0;
    text-align: center;
    pointer-events: none;
    font-weight: 600;
    font-size: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
  }
  .ticon {
    font-size: 12px;
    line-height: 1;
  }
  .bd {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    /* 内滚不显条 */
    scrollbar-width: none;
  }
  .bd::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
  }
</style>
