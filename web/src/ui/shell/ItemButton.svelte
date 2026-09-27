<script lang="ts">
  /**
   * 统一行按钮：眼睛（显隐）+ logo（图层 emoji / 元素色块）+ 名称 + 可选简介 + 可选控件。
   * 不可直接拖动：长按 → 背景进度条从左到右填满 → 解锁拖动（onHold/onDragMove/onDragEnd）；
   * 进度未满松手 = 单击；进度未满位移 = 取消长按（不算点击）。
   */
  import type { Snippet } from 'svelte';

  let {
    visible = true,
    onEye = undefined,
    logo = '',
    logoColor = '',
    name = '',
    desc = '',
    badge = '',
    selected = false,
    dragging = false,
    holdMs = 600,
    onClick,
    onDblclick,
    onHold,
    onDragMove,
    onDragEnd,
    control,
  }: {
    /** 显隐状态：睁眼 = 显示，闭眼 = 隐藏 */
    visible?: boolean;
    /** 提供则眼睛可点击切换；缺省仅指示（元素显隐由所属图层决定） */
    onEye?: () => void;
    /** 图层 logo（emoji） */
    logo?: string;
    /** 元素 logo（颜色块） */
    logoColor?: string;
    name: string;
    /** 可选简介（如高度区间） */
    desc?: string;
    badge?: string;
    /** 选中：黄色外框 */
    selected?: boolean;
    dragging?: boolean;
    /** 长按解锁拖动所需时长（ms） */
    holdMs?: number;
    onClick?: (e: MouseEvent) => void;
    onDblclick?: () => void;
    /** 进度条满 → 拖动解锁（携带按下事件与起始坐标） */
    onHold?: (start: { x: number; y: number; e: PointerEvent }) => void;
    onDragMove?: (e: PointerEvent) => void;
    onDragEnd?: (e: PointerEvent) => void;
    /** 可选控件（高度元素 = 滑块 + 当前值） */
    control?: Snippet;
  } = $props();

  const CLICK_SLOP = 8;

  let holding = $state(false);
  let unlocked = false;
  let holdTimer: ReturnType<typeof setTimeout> | null = null;
  let start = { x: 0, y: 0 };
  let moved = false;

  function clearHold() {
    if (holdTimer) clearTimeout(holdTimer);
    holdTimer = null;
    holding = false;
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    // 眼睛 / 控件（滑块）不参与长按拖动
    if ((e.target as HTMLElement).closest?.('.no-drag')) return;
    start = { x: e.clientX, y: e.clientY };
    moved = false;
    unlocked = false;
    holding = true;
    holdTimer = setTimeout(() => {
      holding = false;
      unlocked = true;
      onHold?.({ ...start, e });
    }, holdMs);
    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinUp);
  }

  function onWinMove(e: PointerEvent) {
    const dist = Math.hypot(e.clientX - start.x, e.clientY - start.y);
    if (dist > CLICK_SLOP) moved = true;
    if (!unlocked) {
      if (moved) clearHold();
      return;
    }
    onDragMove?.(e);
  }

  function onWinUp(e: PointerEvent) {
    window.removeEventListener('pointermove', onWinMove);
    window.removeEventListener('pointerup', onWinUp);
    window.removeEventListener('pointercancel', onWinUp);
    const wasUnlocked = unlocked;
    clearHold();
    unlocked = false;
    if (wasUnlocked) {
      if (moved) onDragEnd?.(e);
      // 解锁后未位移：仍按单击处理（由 click 事件走 onClick）
      return;
    }
  }

  function handleClick(e: MouseEvent) {
    // 拖动收尾 / 位移后的松手不触发单击
    if (moved || unlocked) {
      moved = false;
      e.preventDefault();
      return;
    }
    onClick?.(e);
  }

  function onPointerCancel() {
    clearHold();
    unlocked = false;
  }
</script>

<button
  type="button"
  class="ibtn"
  class:sel={selected}
  class:dragging
  class:hold={holding}
  style="--hold-ms:{holdMs}ms"
  onclick={handleClick}
  ondblclick={(e) => {
    e.preventDefault();
    if (!moved && !unlocked) onDblclick?.();
  }}
  onpointerdown={onPointerDown}
  onpointercancel={onPointerCancel}
>
  <span class="hold-fill" aria-hidden="true"></span>
  {#if onEye}
    <span
      class="eye no-drag"
      class:closed={!visible}
      role="button"
      tabindex="-1"
      title={visible ? '隐藏' : '显示'}
      onclick={(e) => {
        e.stopPropagation();
        onEye();
      }}
      onpointerdown={(e) => e.stopPropagation()}
      ondblclick={(e) => e.stopPropagation()}
    ><span class="eyeglyph">👁</span></span>
  {:else}
    <span class="eye no-drag" class:closed={!visible} title={visible ? '显示中' : '已隐藏'}>
      <span class="eyeglyph">👁</span>
    </span>
  {/if}
  {#if logoColor}
    <span class="logo swatch" style="background:{logoColor}"></span>
  {:else if logo}
    <span class="logo em">{logo}</span>
  {/if}
  <span class="nm">{name}</span>
  {#if badge}
    <span class="badge" title={badge}>{badge}</span>
  {/if}
  {#if desc}
    <span class="desc">{desc}</span>
  {/if}
  {#if control}
    <span class="ctl no-drag" onpointerdown={(e) => e.stopPropagation()} onclick={(e) => e.stopPropagation()} ondblclick={(e) => e.stopPropagation()}>
      {@render control()}
    </span>
  {/if}
</button>

<style>
  .ibtn {
    position: relative;
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 5px 8px;
    border: 1px solid transparent;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    color: inherit;
    cursor: pointer;
    text-align: left;
    font: inherit;
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }
  .ibtn:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  .ibtn.sel {
    border-color: #f0c36a;
    box-shadow: 0 0 0 1px rgba(240, 195, 106, 0.35);
  }
  .ibtn.dragging {
    opacity: 0.55;
  }
  .hold-fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: 0;
    background: rgba(240, 195, 106, 0.26);
    pointer-events: none;
    border-radius: inherit;
  }
  .ibtn.hold .hold-fill {
    width: 100%;
    transition: width var(--hold-ms) linear;
  }
  .eye {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border: none;
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
    padding: 0;
  }
  .eye:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .eyeglyph {
    font-size: 12px;
    line-height: 1;
    display: inline-block;
    transition: transform 0.15s ease;
  }
  .eye.closed .eyeglyph {
    transform: scaleY(0.28);
    opacity: 0.55;
  }
  .logo.em {
    flex: 0 0 auto;
    font-size: 13px;
    line-height: 1;
  }
  .logo.swatch {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    border-radius: 3px;
  }
  .nm {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex: 0 0 auto;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 999px;
    background: rgba(240, 195, 106, 0.15);
    border: 1px solid rgba(240, 195, 106, 0.4);
    max-width: 6em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .desc {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .ctl {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    justify-content: flex-end;
    touch-action: none;
  }
  .ctl :global(input[type='range']) {
    flex: 1;
    min-width: 56px;
  }
</style>
