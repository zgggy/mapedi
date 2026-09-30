<script lang="ts">
  /**
   * 行按钮（2026-09-30 第九轮：**完全代码复用**）——外壳/开合/body/限高滚动全部 =
   * ExpandPanel（header 槽放原交互按钮），本组件只管头部交互（单击/双击/右键/长按拖动）
   * 与头部内容；眼睛在检查模式展开区（InspectSection）。等高按头部 .txt 测量。
   */
  import type { Snippet } from 'svelte';
  import ExpandPanel from './ExpandPanel.svelte';

  let {
    logo = '',
    logoColor = '',
    name = '',
    desc = '',
    badge = '',
    selected = false,
    dragging = false,
    lift = false,
    holdMs = 600,
    open = false,
    content,
    onClick,
    onDblclick,
    onMenu,
    onHold,
    onDragMove,
    onDragEnd,
    control,
  }: {
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
    /** 本行展开态（选中/聚焦驱动；open 时原地长出 content） */
    open?: boolean;
    /** 展开内容（检查/生成/绘制模式区；缺省 = 纯行不可展开） */
    content?: Snippet;
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

<ExpandPanel
  open={open && !!content}
  {content}
  {selected}
  {dragging}
  {lift}
  bodyMax="42vh"
>
  {#snippet header()}
    <button
      type="button"
      class="ibtn"
      class:open={open && !!content}
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
      {#if content}
        <span class="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      {/if}
    </button>
  {/snippet}
</ExpandPanel>

<style>
  /* 头部内芯（外壳/开合/body = ExpandPanel，样式单源回归其组件） */
  .ibtn {
    position: relative;
    width: 100%;
    min-width: 0;
    /* 等高：由列表统一测量设定（按头部 .txt，展开内容不参与） */
    height: var(--ibtn-h, 26px);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px; /* 把手同款内边距 */
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font-size: 11px;
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }
  .ibtn.open {
    border-bottom: 1px solid var(--panel-border);
    border-radius: 12px 12px 0 0;
  }
  .ibtn:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  /* 展开箭头（把手语言） */
  .caret {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--text-dim);
    padding-left: 2px;
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
