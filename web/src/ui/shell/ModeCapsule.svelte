<script lang="ts">
  import { onMount } from 'svelte';
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

  /** 无匹配档 = -1（自定义值不冒充任何档）；滑钮隐藏 */
  const activeIndex = $derived(items.findIndex((i) => i.id === value));

  /**
   * 金钮滑动动画 + **卡死看门狗**（2026-10-04 用户拍板：动画必须有，
   * 发现 bug 就修根因不许撤动画——2026-10-01 的旧 bug = 后台页 CSS 过渡
   * 时间线冻结：style 已是终值、computed 停在旧档 → 金钮不动）。
   * 修法：过渡照常跑（正常时 0.18s 内到位，看门狗无害通过）；定时核对
   * 滑钮矩形与激活档——未到位即判定冻结 → 关过渡+强制重排 → 瞬时落终档
   * （inline transform 本就是终值，重排即正确）；回前台/聚焦再立即核对一次
   * （后台定时器被节流，回来看见之前先归位）。位置正确是底线，动画是加分。
   */
  let knobEl: HTMLSpanElement | undefined = $state();
  let verifyTimer: ReturnType<typeof setTimeout> | undefined;

  function verifyKnob(): void {
    const g = (globalThis.__knobV ??= { n: 0, snap: 0, last: '' });
    g.n++;
    const k = knobEl;
    if (!k) { g.last = 'no-knob'; return; }
    const active = k.parentElement?.querySelector('button[aria-checked="true"]');
    if (!active) { g.last = 'no-active'; return; }
    const kr = k.getBoundingClientRect();
    const ar = active.getBoundingClientRect();
    const d = Math.abs(kr.left - ar.left);
    // 到位判定：左缘与宽度都贴合（±2.5px 容渲染取整）
    if (d <= 2.5 && Math.abs(kr.width - ar.width) <= 2.5) { g.last = 'ok'; return; }
    g.snap++;
    g.last = 'snap@' + Math.round(d);
    k.style.transition = 'none';
    void k.offsetHeight; // 强制重排 → computed 落到 inline 终值
    k.style.transition = ''; // 恢复：后续切换照常有动画
  }

  $effect(() => {
    const g = (globalThis.__knobV ??= { n: 0, snap: 0, last: '' });
    g.eff = (g.eff ?? 0) + 1;
    activeIndex; // 订阅档位变化
    if (verifyTimer) clearTimeout(verifyTimer);
    verifyTimer = setTimeout(verifyKnob, 320); // 过渡 0.18s + 余量
    return () => {
      if (verifyTimer) clearTimeout(verifyTimer);
    };
  });

  onMount(() => {
    const resume = () => {
      if (verifyTimer) clearTimeout(verifyTimer);
      verifyTimer = setTimeout(verifyKnob, 40);
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('focus', resume);
    return () => {
      document.removeEventListener('visibilitychange', resume);
      window.removeEventListener('focus', resume);
      if (verifyTimer) clearTimeout(verifyTimer);
    };
  });

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
    bind:this={knobEl}
    class="knob"
    class:off={activeIndex < 0}
    style="width:calc((100% - 4px) / {items.length});transform:translateX({Math.max(activeIndex, 0) * 100}%)"
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
    padding: var(--sp-1);
    border-radius: 13px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(10, 12, 18, 0.82);
    user-select: none;
    outline: none;
  }
  .capsule:focus-visible {
    border-color: rgba(240, 195, 106, 0.7);
  }
  /* 填色小胶囊：整块平移到激活档（大套小胶囊）。
   * 历史：2026-10-01 用户报障「只切换、金钮不动」（IAB/后台页 CSS 过渡时间线冻结，
   * style 已是终值、computed 停在旧档）→ 当时**撤动画改瞬移**（绕症状）。
   * 2026-10-04 用户驳回：动画必不可少、发现 bug 就修根因 → **过渡加回 +
   * 卡死看门狗**（script：定时核对矩形，冻结即关过渡重排瞬时归位；
   * 回前台/聚焦立即核对）。动画是加分，位置正确仍是底线。 */
  .knob {
    /* 金钮滑动（2026-10-04 拍板加回；冻结自归位看门狗见 script） */
    transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .knob.off {
    visibility: hidden;
  }
  .knob {
    position: absolute;
    top: 2px;
    bottom: 2px;
    left: 2px;
    /* width 由行内 style 按档数计算：calc((100% - 4px) / n) */
    border-radius: 11px;
    background: linear-gradient(180deg, rgba(240, 195, 106, 0.9), rgba(216, 164, 82, 0.9));
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
    font-size: var(--fs-sm);
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
</style>
