<script lang="ts">
  /**
   * DisplayStyle 面板：元素三通道（边界 / 内阴影 / 填充）。
   * onChange 只发局部 patch，不整份覆盖。
   */
  import type { ElementStyle, ElementStylePatch } from '../../core/layer/style';
  import { defaultElementStyle, patchElementStyle } from '../../core/layer/style';
  import { markDirtyCells } from '../../render/staticLayerCache';
  import PanelShell from './PanelShell.svelte';
  import CapsuleSlider from './CapsuleSlider.svelte';

  let {
    open = false,
    layerId = '',
    layerName = '',
    cfg,
    onChange,
    onCollapse,
    renderBackend = 'canvas',
    onRenderBackend,
  }: {
    open?: boolean;
    layerId?: string;
    layerName?: string;
    cfg?: ElementStyle;
    onChange?: (patch: ElementStylePatch) => void;
    onCollapse?: () => void;
    /** 渲染后端（全局）：canvas / gpu */
    renderBackend?: 'canvas' | 'gpu';
    onRenderBackend?: (b: 'canvas' | 'gpu') => void;
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

<PanelShell title="显示参数 · {layerName}" icon="🎨" {open} side="float" width={230} x={250} y={56} onCollapse={onCollapse}>
    <div class="body">
      <div class="grp">
        <div class="grp-hd">渲染后端（全局）</div>
        <div class="row">
          <button type="button" class="seg" class:on={renderBackend === 'canvas'}
            onclick={() => onRenderBackend?.('canvas')}>Canvas2D</button>
          <button type="button" class="seg" class:on={renderBackend === 'gpu'}
            onclick={() => onRenderBackend?.('gpu')}>GPU（实验）</button>
        </div>
        <p class="dim">GPU = GL 直绘（相机 uniform 逐帧，无烘焙）；显示异常可切回 Canvas2D。</p>
      </div>
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
            <CapsuleSlider min={0} max={12} step={0.1} value={c.border.width} label="边界宽度" onInput={(v) => debouncedChange({ border: { width: num(v, 0, 12) } })} />
            <span class="v">{fmt(c.border.width)}</span>
          </label>
          <label class="r">
            平滑
            <CapsuleSlider min={0} max={1} step={0.05} value={c.border.smooth} label="边界平滑" onInput={(v) => debouncedChange({ border: { smooth: num(v, 0, 1) } })} />
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
            <CapsuleSlider min={0} max={48} step={0.5} value={c.shadow.width} label="阴影宽度" onInput={(v) => debouncedChange({ shadow: { width: num(v, 0, 48) } })} />
            <span class="v">{fmt(c.shadow.width)}</span>
          </label>
          <label class="r">
            浓度
            <CapsuleSlider min={0} max={1} step={0.05} value={c.shadow.alpha} label="阴影浓度" onInput={(v) => debouncedChange({ shadow: { alpha: num(v, 0, 1) } })} />
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
            <CapsuleSlider min={0} max={1} step={0.05} value={c.fill.alpha} label="填充透明" onInput={(v) => debouncedChange({ fill: { alpha: num(v, 0, 1) } })} />
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
</PanelShell>

<style>
  .row {
    display: flex;
    gap: 6px;
  }
  .seg {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--border, #3a4354);
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: 12px;
  }
  .seg.on {
    background: var(--accent, #4a7ab0);
    border-color: var(--accent, #4a7ab0);
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
