<script lang="ts">
  /**
   * 底部样式条：元素三通道精简控件（与 DisplayStylePanel 同一数据）。
   */
  import type { ElementStyle, ElementStylePatch } from '../../core/layer/style';
  import { defaultElementStyle, patchElementStyle } from '../../core/layer/style';
  import { markDirtyCells } from '../../render/staticLayerCache';

  let {
    open = false,
    layerName = '',
    cfg,
    onChange,
    onClose,
  }: {
    open?: boolean;
    layerName?: string;
    cfg?: ElementStyle;
    onChange?: (patch: ElementStylePatch) => void;
    onClose?: () => void;
  } = $props();

  const c = $derived(patchElementStyle(cfg ?? defaultElementStyle(), {}));

  let debounceTimer = 0;
  let pending: ElementStylePatch = {};

  function debouncedChange(patch: ElementStylePatch) {
    pending = {
      border: { ...(pending.border ?? {}), ...(patch.border ?? {}) },
      shadow: { ...(pending.shadow ?? {}), ...(patch.shadow ?? {}) },
      fill: { ...(pending.fill ?? {}), ...(patch.fill ?? {}) },
    };
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onChange?.(pending);
      markDirtyCells('all');
      pending = {};
    }, 150);
  }

  function num(v: number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, Number(v) || 0));
  }
  function fmt(v: number, digits = 1) {
    return Number(v).toFixed(digits);
  }
</script>

{#if open}
  <div class="style-bar" role="toolbar" aria-label="图层显示样式">
    <span class="lab">DisplayStyle · {layerName}</span>
    <label class="r">
      边界
      <input
        type="range"
        min="0"
        max="12"
        step="0.1"
        value={c.border.width}
        oninput={(e) => debouncedChange({ border: { width: num(e.currentTarget.value, 0, 12) } })}
      />
      <span class="v">{fmt(c.border.width)}</span>
    </label>
    <label class="r chk">
      <input
        type="checkbox"
        checked={c.shadow.enabled}
        onchange={(e) => debouncedChange({ shadow: { enabled: e.currentTarget.checked } })}
      />
      阴影
    </label>
    {#if c.shadow.enabled}
      <label class="r">
        阴影宽
        <input
          type="range"
          min="0"
          max="48"
          step="0.5"
          value={c.shadow.width}
          oninput={(e) => debouncedChange({ shadow: { width: num(e.currentTarget.value, 0, 48) } })}
        />
        <span class="v">{fmt(c.shadow.width)}</span>
      </label>
    {/if}
    <label class="r">
      平滑
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={c.border.smooth}
        oninput={(e) => debouncedChange({ border: { smooth: num(e.currentTarget.value, 0, 1) } })}
      />
      <span class="v">{fmt(c.border.smooth, 2)}</span>
    </label>
    <label class="r chk">
      <input
        type="checkbox"
        checked={c.fill.enabled}
        onchange={(e) => debouncedChange({ fill: { enabled: e.currentTarget.checked } })}
      />
      填充
    </label>
    {#if c.fill.enabled}
      <label class="r">
        透明
        <input
          type="range"
          min="0"
          max="1"
          step="0.05"
          value={c.fill.alpha}
          oninput={(e) => debouncedChange({ fill: { alpha: num(e.currentTarget.value, 0, 1) } })}
        />
        <span class="v">{fmt(c.fill.alpha, 2)}</span>
      </label>
    {/if}
    {#if onClose}
      <button type="button" class="x" title="收起" onclick={onClose}>×</button>
    {/if}
  </div>
{/if}

<style>
  .style-bar {
    position: fixed;
    left: 50%;
    bottom: 52px;
    transform: translateX(-50%);
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: rgba(18, 20, 26, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    font-size: 12px;
    color: var(--text);
    backdrop-filter: blur(8px);
  }
  .lab {
    color: var(--text-dim);
    font-size: 11px;
    white-space: nowrap;
  }
  .r {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
    white-space: nowrap;
  }
  .r input[type='range'] {
    width: 72px;
  }
  .r .v {
    min-width: 2em;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    font-size: 11px;
  }
  .r.chk {
    cursor: pointer;
  }
  .x {
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
  }
</style>
