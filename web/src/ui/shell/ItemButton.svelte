<script lang="ts">
  /**
   * 统一行按钮：眼睛（显隐指示/切换）+ logo（图层 emoji / 元素色块）+ 名称 + 可选简介 + 可选控件。
   * 所有 ItemButton 等高（40px），单列网格排布；名称换行不省略。
   * 不可直接拖动：长按 → 背景进度条从左到右填满 → 解锁拖动（onHold / onDragMove / onDragEnd）；
   * 右键 → onMenu 弹出具体操作。
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
    lift = false,
    holdMs = 600,
    onClick,
    onDblclick,
    onMenu,
    onHold,
    onDragMove,
    onDragEnd,
    control,
  }: {
    /** 显隐状态：睁眼 = 显示，闭眼 = 隐藏 */
    visible?: boolean;
    /** 提供则眼睛可点击切换；缺省仅指示 */
    onEye?: () => void;
    /** 图层 logo（emoji） */
    logo?: string;
    /** 元素 logo（颜色块） */
    logoColor?: string;
    name: string;
    /** 可选简介 */
    desc?: string;
    badge?: string;
    /** 选中：黄色外框 */
    selected?: boolean;
    /** 拖动来源行（变淡） */
    dragging?: boolean;
    /** 抬起中的浮动件（整个按钮跟指针） */
    lift?: boolean;
    holdMs?: number;
    onClick?: (e: MouseEvent) => void;
    onDblclick?: () => void;
    /** 右键菜单（坐标 + 目标） */
    onMenu?: (e: MouseEvent) => void;
    /** 进度条满 → 拖动解锁 */
    onHold?: (start: { x: number; y: number; e: PointerEvent }) => void;
    onDragMove?: (e: PointerEvent) => void;
    onDragEnd?: (e: PointerEvent) => void;
    /** 可选控件（高度元素 = 胶囊滑块） */
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
    if (wasUnlocked && moved) onDragEnd?.(e);
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
</script>

<button
  type="button"
  class="ibtn"
  class:sel={selected}
  class:dragging
  class:lift
  class:hold={holding}
  style="--hold-ms:{holdMs}ms"
  onclick={handleClick}
  ondblclick={(e) => {
    e.preventDefault();
    if (!moved && !unlocked) onDblclick?.();
  }}
  oncontextmenu={(e) => {
    e.preventDefault();
    if (!unlocked) onMenu?.(e);
  }}
  onpointerdown={onPointerDown}
  onpointercancel={() => {
    clearHold();
    unlocked = false;
  }}
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
      oncontextmenu={(e) => e.stopPropagation()}
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
  <span class="txt">
    <span class="nm">{name}</span>
    {#if desc}
      <span class="desc">{desc}</span>
    {/if}
    {#if badge}
      <span class="badge" title={badge}>{badge}</span>
    {/if}
  </span>
  {#if control}
    <span
      class="ctl no-drag"
      onpointerdown={(e) => e.stopPropagation()}
      onclick={(e) => e.stopPropagation()}
      ondblclick={(e) => e.stopPropagation()}
      oncontextmenu={(e) => e.stopPropagation()}
    >
      {@render control()}
    </span>
  {/if}
</button>

<style>
  .ibtn {
    position: relative;
    width: 100%;
    min-width: 0;
    /* 等高：由列表统一测量设定（容纳最长名称换行） */
    height: var(--ibtn-h, 40px);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 6px;
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
  /* 被拿起来：原位留空槽（整钮由浮动件表示） */
  .ibtn.dragging {
    visibility: hidden;
  }
  /* 抬起中的浮动件：整钮跟指针 */
  .ibtn.lift {
    position: fixed;
    z-index: 200;
    width: var(--lift-w, 240px);
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.5);
    border-color: rgba(240, 195, 106, 0.7);
    opacity: 0.95;
    pointer-events: none;
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
  /* 名称区：换行显示，不做省略截断 */
  .txt {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    line-height: 1.25;
    max-height: 100%;
    overflow-y: auto;
    scrollbar-width: none;
  }
  .txt::-webkit-scrollbar {
    width: 0;
    display: none;
  }
  .nm {
    white-space: normal;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .desc {
    font-size: 10px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
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
  .ctl {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
