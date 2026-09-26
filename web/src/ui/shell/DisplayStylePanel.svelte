<script lang="ts">
  /**
   * DisplayStyle 面板：元素三通道（边界 / 内阴影 / 填充）。
   * onChange 只发局部 patch，不整份覆盖。
   */
  import type { ElementStyle, ElementStylePatch } from '../../core/layer/style';
  import { defaultElementStyle, patchElementStyle } from '../../core/layer/style';
  import { markDirtyCells } from '../../render/staticLayerCache';

  let {
    open = false,
    layerId = '',
    layerName = '',
    cfg,
    onChange,
    onClose,
  }: {
    open?: boolean;
    layerId?: string;
    layerName?: string;
    cfg?: ElementStyle;
    onChange?: (patch: ElementStylePatch) => void;
    onClose?: () => void;
  } = $props();

  const isFreeform = $derived(layerId === 'road' || layerId === 'route' || layerId === 'river');
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

  function num(v: string | number, lo: number, hi: number) {
    return Math.max(lo, Math.min(hi, Number(v) || 0));
  }
  function fmt(v: number, digits = 1) {
    return Number(v).toFixed(digits);
  }
</script>

{#if open}
  <div class="dsp" role="dialog" aria-label="显示样式">
    <div class="hd">
      <span class="lab">DisplayStyle · {layerName}</span>
      {#if onClose}
        <button type="button" class="x" title="关闭" onclick={onClose}>×</button>
      {/if}
    </div>

    <div class="body">
      {#if isFreeform}
        <p class="dim">曲线层样式独立（线宽/颜色），不走元素三通道。</p>
      {:else}
      <div class="grp">
        <div class="grp-hd">边界</div>
        <label class="r chk">
          <input type="checkbox" checked={c.border.enabled}
            onchange={(e) => debouncedChange({ border: { enabled: e.currentTarget.checked } })} />
          显示
        </label>
        {#if c.border.enabled}
          <label class="r">
            宽度
            <input type="range" min="0" max="12" step="0.1" value={c.border.width}
              oninput={(e) => debouncedChange({ border: { width: num(e.currentTarget.value, 0, 12) } })} />
            <span class="v">{fmt(c.border.width)}</span>
          </label>
          <label class="r">
            平滑
            <input type="range" min="0" max="1" step="0.05" value={c.border.smooth}
              oninput={(e) => debouncedChange({ border: { smooth: num(e.currentTarget.value, 0, 1) } })} />
            <span class="v">{fmt(c.border.smooth, 2)}</span>
          </label>
          <label class="r">
            颜色
            <input type="color" value={c.border.color}
              oninput={(e) => debouncedChange({ border: { color: e.currentTarget.value } })} />
          </label>
        {/if}
      </div>

      <div class="grp">
        <div class="grp-hd">内阴影</div>
        <label class="r chk">
          <input type="checkbox" checked={c.shadow.enabled}
            onchange={(e) => debouncedChange({ shadow: { enabled: e.currentTarget.checked } })} />
          显示
        </label>
        {#if c.shadow.enabled}
          <label class="r">
            宽度
            <input type="range" min="0" max="48" step="0.5" value={c.shadow.width}
              oninput={(e) => debouncedChange({ shadow: { width: num(e.currentTarget.value, 0, 48) } })} />
            <span class="v">{fmt(c.shadow.width)}</span>
          </label>
          <label class="r">
            浓度
            <input type="range" min="0" max="1" step="0.05" value={c.shadow.alpha}
              oninput={(e) => debouncedChange({ shadow: { alpha: num(e.currentTarget.value, 0, 1) } })} />
            <span class="v">{fmt(c.shadow.alpha, 2)}</span>
          </label>
          <label class="r">
            颜色
            <input type="color" value={c.shadow.color}
              oninput={(e) => debouncedChange({ shadow: { color: e.currentTarget.value } })} />
          </label>
        {/if}
      </div>

      <div class="grp">
        <div class="grp-hd">填充</div>
        <label class="r chk">
          <input type="checkbox" checked={c.fill.enabled}
            onchange={(e) => debouncedChange({ fill: { enabled: e.currentTarget.checked } })} />
          显示
        </label>
        {#if c.fill.enabled}
          <label class="r">
            透明
            <input type="range" min="0" max="1" step="0.05" value={c.fill.alpha}
              oninput={(e) => debouncedChange({ fill: { alpha: num(e.currentTarget.value, 0, 1) } })} />
            <span class="v">{fmt(c.fill.alpha, 2)}</span>
          </label>
          <label class="r">
            颜色
            <input type="color" value={c.fill.color}
              oninput={(e) => debouncedChange({ fill: { color: e.currentTarget.value } })} />
          </label>
        {/if}
      </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .dsp {
    position: fixed;
    left: 210px;
    top: 50px;
    z-index: 55;
    width: 220px;
    max-height: calc(100vh - 100px);
    overflow-y: auto;
    background: rgba(18, 20, 26, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 12px;
    font-size: 12px;
    color: var(--text);
    backdrop-filter: blur(8px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  }
  .hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .lab {
    color: var(--text-dim);
    font-size: 11px;
  }
  .x {
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
    font-size: 14px;
  }
  .body {
    padding: 8px 12px 12px;
  }
  .grp {
    margin-bottom: 12px;
  }
  .grp-hd {
    font-size: 10px;
    color: var(--text-dim);
    margin-bottom: 6px;
    letter-spacing: 0.5px;
  }
  .r {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 6px;
    color: var(--text-dim);
  }
  .r input[type='range'] {
    flex: 1;
  }
  .r input[type='color'] {
    width: 32px;
    height: 22px;
    border: none;
    border-radius: 4px;
    cursor: pointer;
  }
  .r .v {
    min-width: 2.5em;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    font-size: 11px;
  }
  .r.chk {
    cursor: pointer;
  }
</style>
