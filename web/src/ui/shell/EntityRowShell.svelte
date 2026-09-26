<script lang="ts">
  /**
   * 列表行（纯展示 + 视觉状态）。
   * 拖放由父级指针事件驱动；本组件不接 HTML5 drag。
   */
  import EntityBox from './EntityBox.svelte';
  import type { Snippet } from 'svelte';

  let {
    depth = 0,
    name = '',
    emoji = '',
    color = '',
    badge = '',
    selected = false,
    showActions = false,
    expandable = false,
    expanded = false,
    childTint = false,
    hint = null as null | { kind: 'gap-top' | 'gap-bottom' | 'nest'; targetId: string; parentId: string | null },
    parentHighlight = false,
    nestHighlight = false,
    dragging = false,
    visible = true,
    box,
    onSelect,
    onToggle,
    onInfo,
    onStyle,
    onDraw,
    onDelete,
  }: {
    depth?: number;
    name?: string;
    emoji?: string;
    color?: string;
    badge?: string;
    selected?: boolean;
    showActions?: boolean;
    expandable?: boolean;
    expanded?: boolean;
    childTint?: boolean;
    hint?: null | { kind: 'gap-top' | 'gap-bottom' | 'nest'; targetId: string; parentId: string | null };
    parentHighlight?: boolean;
    nestHighlight?: boolean;
    dragging?: boolean;
    visible?: boolean;
    box?: Snippet;
    onSelect?: (e?: MouseEvent) => void;
    onToggle?: () => void;
    onInfo?: () => void;
    onStyle?: () => void;
    onDraw?: () => void;
    onDelete?: () => void;
  } = $props();
</script>

<div
  class="erow"
  class:hint-nest={hint?.kind === 'nest' || nestHighlight}
  class:hint-gap-top={hint?.kind === 'gap-top'}
  class:hint-gap-bottom={hint?.kind === 'gap-bottom'}
  class:parent-hl={parentHighlight}
  class:dragging
  role="listitem"
>
  {#if hint?.kind === 'gap-top' || hint?.kind === 'gap-bottom'}
    <span
      class="drop-line"
      class:top={hint.kind === 'gap-top'}
      class:bottom={hint.kind === 'gap-bottom'}
      aria-hidden="true"
    ></span>
  {/if}
  <div class="row-main">
    <div class="guides" aria-hidden="true">
      {#each { length: depth } as _, i (i)}
        <span class="gslot"><span class="gbar"></span></span>
      {/each}
    </div>
    <div class="box-slot" class:child-tint={childTint}>
      {#if box}
        {@render box()}
      {:else}
        <EntityBox
          {name}
          {emoji}
          {color}
          {badge}
          {selected}
          {showActions}
          {expandable}
          {expanded}
          {visible}
          {onSelect}
          {onToggle}
          {onInfo}
          {onStyle}
          {onDraw}
          {onDelete}
        />
      {/if}
    </div>
  </div>
</div>

<style>
  .erow {
    position: relative;
    cursor: grab;
    touch-action: none;
  }
  .erow.dragging {
    opacity: 0.55;
  }
  .row-main {
    display: flex;
    align-items: center;
  }
  .guides {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
  }
  .gslot {
    width: 14px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding-right: 5px;
  }
  .gbar {
    width: 3px;
    height: 14px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.18);
  }
  .box-slot {
    flex: 1;
    min-width: 0;
  }
  .box-slot.child-tint :global(.ebox) {
    background: rgba(255, 255, 255, 0.03);
  }
  .hint-nest .box-slot :global(.ebox) {
    outline: 1.5px solid rgba(240, 195, 106, 0.9);
    outline-offset: -1px;
  }
  .parent-hl .box-slot :global(.ebox) {
    background: rgba(240, 195, 106, 0.12);
  }
  .drop-line {
    position: absolute;
    left: 2px;
    right: 2px;
    height: 2px;
    border-radius: 1px;
    background: rgba(240, 195, 106, 0.95);
    z-index: 3;
    pointer-events: none;
  }
  .drop-line.top {
    top: calc(var(--gap, 4px) / -2 - 1px);
  }
  .drop-line.bottom {
    bottom: calc(var(--gap, 4px) / -2 - 1px);
  }
</style>
