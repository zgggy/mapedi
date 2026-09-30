<script lang="ts">
  /**
   * 分段胶囊（设计稿 §2.1；2026-09-30 通用化：顶栏视图两档 / 左栏工作区三档共用）：
   * 大胶囊内若干档位，填色小胶囊停在哪档即当前模式。
   *
   * 复用 CapsuleSlider 的视觉语言，但语义是**分段开关**不是滑块——所以不直接用
   * CapsuleSlider（它两端显示数值、填充表达连续量，会让人想拖着改数字）：
   * 各档文字常驻，填色胶囊整块平移到激活档。支持点击切换 + 键盘 ←→。
   */

  let {
    value,
    onChange,
    items,
    ariaLabel = '模式',
    segMinW = 96,
    disabledWhen,
  }: {
    value: string;
    onChange: (v: string) => void;
    items: { id: string; icon?: string; label: string }[];
    ariaLabel?: string;
    /** 每档最小宽度（顶栏两档 96；左栏三档 56） */
    segMinW?: number;
    /** 返回 true = 该档禁用（球面锁检查） */
    disabledWhen?: (id: string) => boolean;
  } = $props();

  const activeIndex = $derived(Math.max(0, items.findIndex((i) => i.id === value)));

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(items[(activeIndex - 1 + items.length) % items.length].id);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(items[(activeIndex + 1) % items.length].id);
    }
  }
</script>

<div
  class="capsule"
  role="radiogroup"
  aria-label={ariaLabel}
  tabindex="0"
  onkeydown={onKey}
>
  <span
    class="knob"
    style="width:calc((100% - 4px) / {items.length});transform:translateX({activeIndex * 100}%)"
  ></span>
  {#each items as it (it.id)}
    <button
      type="button"
      role="radio"
      aria-checked={value === it.id}
      class:active={value === it.id}
      style="min-width:{segMinW}px"
      disabled={disabledWhen?.(it.id)}
      onclick={() => onChange(it.id)}
    >
      {it.icon ? it.icon + ' ' : ''}{it.label}
    </button>
  {/each}
</div>

<style>
  .capsule {
    position: relative;
    display: flex;
    align-items: center;
    height: 26px;
    padding: 2px;
    border-radius: 13px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(10, 12, 18, 0.82);
    user-select: none;
    outline: none;
  }
  .capsule:focus-visible {
    border-color: rgba(240, 195, 106, 0.7);
  }
  /* 填色小胶囊：整块平移到激活档（大套小胶囊） */
  .knob {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    /* width 由行内 style 按档数计算：calc((100% - 4px) / n) */
    border-radius: 11px;
    background: linear-gradient(180deg, rgba(240, 195, 106, 0.9), rgba(216, 164, 82, 0.9));
    transition:
      transform 0.18s cubic-bezier(0.34, 1.3, 0.64, 1),
      width 0.18s ease;
    pointer-events: none;
  }
  button {
    position: relative;
    z-index: 1;
    flex: 1;
    /* min-width 由行内 style（segMinW）给出 */
    height: 100%;
    padding: 0 10px;
    border: 0;
    background: transparent;
    color: rgba(255, 255, 255, 0.72);
    font-size: 11px;
    line-height: 1;
    white-space: nowrap;
    cursor: pointer;
    border-radius: 11px;
    transition: color 0.15s ease;
  }
  button:hover {
    color: rgba(255, 255, 255, 0.92);
  }
  button.active {
    color: #1a1408;
    font-weight: 600;
  }
  @media (prefers-reduced-motion: reduce) {
    .knob {
      transition: none;
    }
  }
</style>
