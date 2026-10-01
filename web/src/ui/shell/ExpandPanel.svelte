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
    label = '',
    title = '',
    open = false,
    onToggle,
    disabled = false,
    right,
    grow = false,
    content,
    header,
    bodyMax,
    selected = false,
  }: {
    icon?: string;
    /** header 缺省时的头部文字（header 存在时可省） */
    label?: string;
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
    /** 自定义头部（完全代码复用：列表行把原按钮放这里，默认把手头不再渲染） */
    header?: Snippet;
    /** body 限高（行内场景传值防撑爆；左栏 flex 场景不传） */
    bodyMax?: string;
    /** 选中态金边（列表行经此透传到外壳） */
    selected?: boolean;
  } = $props();

  function toggle() {
    if (disabled) return;
    onToggle?.(!open);
  }
</script>

<div class="acc" class:open class:grow class:selected>
  {#if header}
    <!-- 完全复用：调用方自带头部（列表行 = 原交互按钮），开合状态仍由 open 控制 -->
    {@render header()}
  {:else}
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
  {/if}
  {#if open && content}
    <div class="body" style={bodyMax ? `max-height:${bodyMax};overflow-y:auto` : undefined}>
      {@render content()}
    </div>
  {/if}
</div>

<style>
  /* 单体容器：收起 = 仅把手行（含框）；展开 = 同一容器内长出内容（不另加面板） */
  .acc {
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    overflow-x: hidden; /* 展开内容不得把面板/轨撑宽（宽度恒定） */
    background: rgba(16, 19, 26, 0.94);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
  .acc.grow.open {
    flex: 1 1 0; /* 左栏：都展开=各占一半；一开一收=展开者占满；收起时 auto=仅把手行 */
  }
  .acc.selected {
    border-color: #f0c36a;
    box-shadow: 0 0 0 1px rgba(240, 195, 106, 0.35);
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
    padding: 6px 8px; /* 高度与列表行头精确对齐（26 = txt 14 + padding 12） */
    font-size: 11px;
    line-height: 1.2;
    cursor: pointer;
    user-select: none;
    touch-action: none;
    text-align: left;
  }
  .acc.open .handle {
    /* 第十轮：展开不加标题下横线（用户定）；上圆角随开合 */
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
    padding: 6px 8px; /* 统一内容内距（行内/左栏一致） */
    box-sizing: border-box;
  }
  /* 左栏面板（grow = LeftRail 两面板专用）：ul/button 与 panel 左右间距更小（第十一轮） */
  .acc.grow .body {
    padding-left: 4px;
    padding-right: 4px;
  }
</style>
