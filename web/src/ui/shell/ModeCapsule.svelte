<script lang="ts">
  /**
   * 模式胶囊（设计稿 §2.1）：大胶囊内两个档位，填色小胶囊停在哪侧即当前模式。
   *
   * 复用 CapsuleSlider 的视觉语言，但语义是**分段开关**不是滑块——所以不直接用
   * CapsuleSlider（它两端显示数值、填充表达连续量，会让人想拖着改数字）：
   * 两侧文字常驻，填色胶囊整块平移到激活侧。支持点击对侧切换 + 键盘 ←→。
   */
  import type { ViewMode } from './shell';

  let {
    value,
    onChange,
  }: {
    value: ViewMode;
    onChange: (m: ViewMode) => void;
  } = $props();

  const ITEMS = [
    { id: 'view-globe' as const, icon: '🌐', label: '球面展示' },
    { id: 'view-2d' as const, icon: '✏️', label: '平面编辑' },
  ];
  const activeIndex = $derived(value === 'view-2d' ? 1 : 0);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange('view-globe');
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange('view-2d');
    }
  }
</script>

<div
  class="capsule"
  role="radiogroup"
  aria-label="视图模式（球面 / 平面）"
  tabindex="0"
  onkeydown={onKey}
>
  <span class="knob" style="transform:translateX({activeIndex * 100}%)"></span>
  {#each ITEMS as it, i (it.id)}
    <button
      type="button"
      role="radio"
      aria-checked={value === it.id}
      class:active={value === it.id}
      onclick={() => onChange(it.id)}
    >
      {it.icon} {it.label}
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
    width: calc(50% - 2px);
    border-radius: 11px;
    background: linear-gradient(180deg, rgba(240, 195, 106, 0.9), rgba(216, 164, 82, 0.9));
    transition: transform 0.18s cubic-bezier(0.34, 1.3, 0.64, 1);
    pointer-events: none;
  }
  button {
    position: relative;
    z-index: 1;
    flex: 1;
    min-width: 96px;
    height: 100%;
    padding: 0 12px;
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
