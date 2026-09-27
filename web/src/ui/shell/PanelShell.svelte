<script lang="ts">
  /**
   * 统一面板壳：header（最左收起按钮 + 标题居中）+ 内容区。
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
    maxHeight = '',
    children,
  }: {
    title?: string;
    /** Dock 图标（面板身份） */
    icon?: string;
    open?: boolean;
    onCollapse?: () => void;
    /** left/right = 贴边通栏；float = 悬浮卡片 */
    side?: 'left' | 'right' | 'float';
    width?: number;
    /** float 时的左上角坐标 */
    x?: number;
    y?: number;
    maxHeight?: string;
    children?: Snippet;
  } = $props();
</script>

{#if open}
  <aside
    class="ps"
    class:left={side === 'left'}
    class:right={side === 'right'}
    class:float={side === 'float'}
    style={side === 'float'
      ? `left:${x}px;top:${y}px;width:${width}px;${maxHeight ? `max-height:${maxHeight};` : ''}`
      : `width:${width}px;`}
  >
    <div class="hd">
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
    background: rgba(16, 19, 26, 0.94);
    border: 1px solid var(--panel-border);
    font-size: 12px;
    user-select: none;
    overflow: hidden;
  }
  .ps.left {
    top: 0;
    bottom: 0;
    left: 0;
    border-radius: 0 12px 12px 0;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
  .ps.right {
    top: 0;
    bottom: 0;
    right: 0;
    border-radius: 12px 0 0 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
  .ps.float {
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
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
    overflow: auto;
    display: flex;
    flex-direction: column;
  }
</style>
