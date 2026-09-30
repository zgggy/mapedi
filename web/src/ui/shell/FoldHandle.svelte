<script lang="ts">
  /**
   * 统一把手（左栏四子面板的开合控件，2026-09-30 需求）：单击 = 展开/收起；
   * 可选长按 = 进度填满直接触发（D5 语义，仅生成把手使用）——进度未满松手 = 单击开合。
   * 样式单源：GenerateSection / WorkspaceDrawer 绘制把手 / LayersPanel 图层把手共用。
   */
  import type { Snippet } from 'svelte';

  let {
    icon = '',
    label,
    title = '',
    open = false,
    onToggle,
    disabled = false,
    holdMs = 0,
    onFire,
    right,
    grow = false,
  }: {
    icon?: string;
    label: string;
    title?: string;
    open?: boolean;
    onToggle?: (next: boolean, e: MouseEvent) => void;
    disabled?: boolean;
    /** >0 = 长按进度触发（满格 onFire；未满松手 = 开合） */
    holdMs?: number;
    onFire?: () => void;
    /** 把手右侧附加内容（如收起态的身份信息） */
    right?: Snippet;
    /** flex 容器内占满余宽（LayersPanel header 用） */
    grow?: boolean;
  } = $props();

  let filling = $state(false);
  let filled = $state(false);
  let holdTimer: ReturnType<typeof setTimeout> | null = null;

  function toggle(e?: MouseEvent) {
    if (disabled) return;
    onToggle?.(!open, e as MouseEvent);
  }
  function fire() {
    if (disabled || !onFire) return;
    onFire();
  }
  function down() {
    if (disabled || !holdMs) return;
    filling = true;
    filled = false;
    holdTimer = setTimeout(() => {
      filled = true;
    }, holdMs);
  }
  function up() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    const didFill = filled;
    filling = false;
    filled = false;
    if (didFill) fire();
    else toggle(undefined as unknown as MouseEvent);
  }
  function cancel() {
    if (holdTimer) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    filling = false;
    filled = false;
  }
</script>

<button
  type="button"
  class="handle"
  class:open
  class:filling
  class:grow
  {disabled}
  {title}
  onclick={holdMs ? undefined : (e) => toggle(e)}
  onpointerdown={holdMs ? down : undefined}
  onpointerup={holdMs ? up : undefined}
  onpointerleave={holdMs ? cancel : undefined}
  onpointercancel={holdMs ? cancel : undefined}
  oncontextmenu={(e) => e.preventDefault()}
  onkeydown={(e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (holdMs && onFire) fire();
      else toggle(undefined as unknown as MouseEvent);
    } else if (e.key === ' ') {
      e.preventDefault();
      toggle(undefined as unknown as MouseEvent);
    }
  }}
>
  {#if holdMs}
    <span class="fill" style="transition-duration:{holdMs}ms"></span>
  {/if}
  <span class="lb">{icon ? icon + ' ' : ''}{label} {open ? '▾' : '▸'}</span>
  {#if right}{@render right()}{/if}
</button>

<style>
  .handle {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    width: 100%;
    overflow: hidden;
    border: 1px solid var(--panel-border);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text, #ddd);
    border-radius: 8px;
    padding: 5px 8px;
    font-size: 11px;
    line-height: 1.2;
    cursor: pointer;
    user-select: none;
    touch-action: none;
  }
  .handle:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }
  .handle.grow {
    flex: 1;
    min-width: 0;
  }
  .handle.open {
    border-color: rgba(240, 195, 106, 0.5);
  }
  .handle:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .fill {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 0;
    background: linear-gradient(90deg, rgba(240, 195, 106, 0.75), rgba(216, 164, 82, 0.9));
    transition: width 0s linear;
    pointer-events: none;
  }
  .filling .fill {
    width: 100%;
  }
  .lb {
    position: relative;
    z-index: 1;
    text-align: left;
    flex: 1;
    min-width: 0;
  }
</style>
