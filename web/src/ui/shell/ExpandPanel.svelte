<script lang="ts">
  /**
   * 可展开面板（2026-09-30 第七轮：**把手与内容是一个单体**——收起 = 一行 button，
   * 展开 = button 自己长出内容，不在下面另加面板）。
   * 全项目四处可展开物复用本组件、只换传参：左栏图层面板、左栏元素面板（原工作区）、
   * 图层树聚焦行展开区、元素树选中行展开区——同样式、同开合逻辑、只内容不同。
   */
  import type { Snippet } from 'svelte';

  let {
    icon = '',
    label,
    title = '',
    open = false,
    onToggle,
    disabled = false,
    right,
    grow = false,
    content,
  }: {
    icon?: string;
    label: string;
    title?: string;
    open?: boolean;
    onToggle?: (next: boolean) => void;
    disabled?: boolean;
    /** 头部右侧附加内容（如元数据徽标） */
    right?: Snippet;
    /** flex 容器内占满余宽 */
    grow?: boolean;
    /** 展开时渲染的内容（滚动由本组件 body 负责） */
    content?: Snippet;
  } = $props();

  function toggle() {
    if (disabled) return;
    onToggle?.(!open);
  }
</script>

<div class="acc" class:open class:grow>
  <button
    type="button"
    class="handle"
    {disabled}
    {title}
    aria-expanded={content ? open : undefined}
    onclick={toggle}
    oncontextmenu={(e) => e.preventDefault()}
    onkeydown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle();
      }
    }}
  >
    <span class="lb">{icon ? icon + ' ' : ''}{label}{content ? (open ? ' ▾' : ' ▸') : ''}</span>
    {#if right}{@render right()}{/if}
  </button>
  {#if open && content}
    <div class="body">{@render content()}</div>
  {/if}
</div>

<style>
  /* 单体容器：收起 = 仅把手行（含框）；展开 = 同一容器内长出内容（不另加面板） */
  .acc {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background: rgba(16, 19, 26, 0.94);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
  .acc.grow.open {
    flex: 1 1 0; /* 左栏：都展开=各占一半；一开一收=展开者占满；收起时 auto=仅把手行 */
  }
  .handle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    overflow: hidden;
    border: 0;
    background: transparent;
    color: var(--text, #ddd);
    border-radius: 12px;
    padding: 5px 8px;
    font-size: 11px;
    line-height: 1.2;
    cursor: pointer;
    user-select: none;
    touch-action: none;
    text-align: left;
  }
  .acc.open .handle {
    border-bottom: 1px solid var(--panel-border);
    border-radius: 12px 12px 0 0;
  }
  .handle:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.07);
  }
  .handle:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .lb {
    flex: 1;
    min-width: 0;
  }
  /* 内容区：滚动只发生在这里（不溢出头部/框） */
  .body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
</style>
