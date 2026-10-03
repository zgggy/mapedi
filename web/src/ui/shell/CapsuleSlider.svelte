<script lang="ts">
  /**
   * 胶囊滑块：大胶囊内套小胶囊（左端对齐，右端随拖动变化 = 值）。
   * 大胶囊内部两端 = min / max；小胶囊右端显示当前值（占比 >50% 在内部，否则在外部）。
   * 拖动时小胶囊右端上方出现小气泡显示取值，松手消失。
   * step 为整数 → 取值/长度离散变化；否则连续。
   */
  let {
    min = 0,
    max = 1,
    step = 0.1,
    value = min,
    onInput,
    label = '',
    width = 0,
    disabled = false,
  }: {
    min?: number;
    max?: number;
    step?: number;
    value?: number;
    onInput?: (v: number) => void;
    label?: string;
    /** 0 = 自适应宽度 */
    width?: number;
    disabled?: boolean;
  } = $props();

  const discrete = $derived(Number.isInteger(step) && step >= 1);
  const span = $derived(Math.max(1e-9, max - min));
  const frac = $derived(Math.max(0, Math.min(1, (value - min) / span)));
  const inside = $derived(frac > 0.5);

  let track: HTMLElement | undefined = $state();
  let dragging = $state(false);

  function snap(raw: number): number {
    const v = min + Math.max(0, Math.min(1, raw)) * span;
    if (discrete) return Math.round(v);
    const q = min + Math.round((v - min) / step) * step;
    return Math.max(min, Math.min(max, Math.round(q * 1e6) / 1e6));
  }

  function valueFromX(clientX: number): number {
    const r = track!.getBoundingClientRect();
    return snap((clientX - r.left) / Math.max(1, r.width));
  }

  // window 监听（不用 setPointerCapture：合成指针会抛错炸穿 handler）
  function onDown(e: PointerEvent) {
    if (disabled || e.button !== 0) return;
    dragging = true;
    const v = valueFromX(e.clientX);
    if (v !== value) onInput?.(v);
    e.stopPropagation();
    window.addEventListener('pointermove', onWinMove);
    window.addEventListener('pointerup', onWinUp);
    window.addEventListener('pointercancel', onWinUp);
  }
  function onWinMove(e: PointerEvent) {
    if (!dragging) return;
    const v = valueFromX(e.clientX);
    if (v !== value) onInput?.(v);
  }
  function onWinUp() {
    if (!dragging) return;
    dragging = false;
    window.removeEventListener('pointermove', onWinMove);
    window.removeEventListener('pointerup', onWinUp);
    window.removeEventListener('pointercancel', onWinUp);
  }

  function onKey(e: KeyboardEvent) {
    if (disabled) return;
    const d = discrete ? step : step;
    let v: number | null = null;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') v = value - d;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') v = value + d;
    else if (e.key === 'Home') v = min;
    else if (e.key === 'End') v = max;
    if (v === null) return;
    e.preventDefault();
    onInput?.(snap((Math.max(min, Math.min(max, v)) - min) / span));
  }

  function fmt(v: number): string {
    return discrete ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
  }
</script>

<div
  class="cap"
  class:disabled
  class:dragging
  class:in={inside}
  style={width ? `width:${width}px` : ''}
  role="slider"
  tabindex={disabled ? -1 : 0}
  aria-label={label}
  aria-valuemin={min}
  aria-valuemax={max}
  aria-valuenow={value}
  bind:this={track}
  onpointerdown={onDown}
  onkeydown={onKey}
>
  <span class="fill" style="width:{frac * 100}%">
    {#if inside}
      <span class="val">{fmt(value)}</span>
    {/if}
  </span>
  {#if !inside}
    <span class="val out" style="left:calc({frac * 100}% + 6px)">{fmt(value)}</span>
  {/if}
  <span class="edge lo">{fmt(min)}</span>
  <span class="edge hi">{fmt(max)}</span>
  {#if dragging}
    <span class="bub" style="left:{frac * 100}%">{fmt(value)}</span>
  {/if}
</div>

<style>
  .cap {
    position: relative;
    /* flex-basis:auto 而非 0：basis 0 不计入列向容器的固有高度
     * （包3 tgrid 中间行全滑块 → 行高塌到标签、滑块被压成 2px 横线）；
     * 行向容器里仍靠 flex-grow 填满，视觉不变。 */
    flex: 1 1 auto;
    min-width: 64px;
    height: 22px;
    border-radius: 11px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(255, 255, 255, 0.06);
    cursor: pointer;
    touch-action: none;
    user-select: none;
    outline: none;
  }
  .cap:focus-visible {
    border-color: rgba(240, 195, 106, 0.7);
  }
  .cap.disabled {
    opacity: 0.45;
    pointer-events: none;
  }
  .fill {
    position: absolute;
    left: 0;
    top: 2px;
    bottom: 2px;
    border-radius: 9px;
    background: linear-gradient(180deg, rgba(240, 195, 106, 0.85), rgba(216, 164, 82, 0.85));
    min-width: 2px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    overflow: visible;
  }
  .val {
    font-size: var(--fs-xs);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: #1a1408;
    font-weight: 600;
    padding-right: 7px;
    white-space: nowrap;
    pointer-events: none;
  }
  .val.out {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    color: var(--text);
    padding-right: 0;
  }
  .edge {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    font-size: 9px;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.55);
    pointer-events: none;
  }
  .edge.lo {
    left: 7px;
  }
  .edge.hi {
    right: 7px;
  }
  .bub {
    position: absolute;
    bottom: calc(100% + 6px);
    transform: translateX(-50%);
    padding: 3px 7px;
    border-radius: var(--r-2);
    background: rgba(20, 22, 28, 0.95);
    border: 1px solid rgba(240, 195, 106, 0.6);
    color: var(--text);
    font-size: var(--fs-xs);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    pointer-events: none;
  }
</style>
