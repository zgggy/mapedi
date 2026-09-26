<script lang="ts">
  /**
   * 参数控件：可选胶囊切换 + 滑块 + 右侧数值框（双向同步）。
   */
  let {
    label = '',
    value = 0,
    min = 0,
    max = 100,
    step = 1,
    unit = '',
    mode = null as null | { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void },
    onInput,
  }: {
    label?: string;
    value?: number;
    min?: number;
    max?: number;
    step?: number;
    unit?: string;
    mode?: {
      value: string;
      options: { value: string; label: string }[];
      onChange: (v: string) => void;
    } | null;
    onInput?: (v: number) => void;
  } = $props();

  let text = $state(String(value));
  $effect(() => {
    text = String(value);
  });

  function emit(n: number) {
    const clamped = Math.min(max, Math.max(min, n));
    onInput?.(clamped);
  }

  function onSlider(e: Event) {
    const v = Number((e.target as HTMLInputElement).value);
    text = String(v);
    emit(v);
  }

  function onText(e: Event) {
    const raw = (e.target as HTMLInputElement).value;
    text = raw;
    const n = Number(raw);
    if (!Number.isFinite(n)) return;
    emit(n);
  }

  function onTextBlur() {
    const n = Number(text);
    if (!Number.isFinite(n)) text = String(value);
    else text = String(Math.min(max, Math.max(min, n)));
  }
</script>

<div class="sf">
  <div class="sf-top">
    <span class="sf-label">{label}</span>
    {#if mode}
      <div class="pill" role="group" aria-label={label}>
        {#each mode.options as opt (opt.value)}
          <button
            type="button"
            class="seg"
            class:on={mode.value === opt.value}
            onclick={() => mode!.onChange(opt.value)}
          >
            {opt.label}
          </button>
        {/each}
      </div>
    {/if}
  </div>
  <div class="sf-row">
    <input
      class="slider"
      type="range"
      {min}
      {max}
      {step}
      value={value}
      oninput={onSlider}
    />
    <input
      class="num"
      type="number"
      {min}
      {max}
      {step}
      value={text}
      oninput={onText}
      onblur={onTextBlur}
    />
    {#if unit}
      <span class="unit">{unit}</span>
    {/if}
  </div>
</div>

<style>
  .sf {
    margin-bottom: 8px;
  }
  .sf-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    margin-bottom: 4px;
  }
  .sf-label {
    color: var(--text-dim);
    font-size: 11px;
  }
  .pill {
    display: inline-flex;
    border: 1px solid var(--panel-border);
    border-radius: 999px;
    overflow: hidden;
    background: rgba(255, 255, 255, 0.03);
  }
  .seg {
    border: none;
    background: transparent;
    color: var(--text-dim);
    font-size: 10px;
    padding: 3px 8px;
    cursor: pointer;
  }
  .seg.on {
    background: rgba(107, 124, 147, 0.45);
    color: var(--text);
  }
  .sf-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .slider {
    flex: 1;
    min-width: 0;
  }
  .num {
    width: 64px;
    font-size: 11px;
    text-align: right;
  }
  .unit {
    color: var(--text-dim);
    font-size: 10px;
    width: 2em;
  }
</style>
