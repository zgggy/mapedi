<script lang="ts">
  /**
   * DisplayStyle 面板：元素两通道（边界 / 填充）。（阴影通道已归档：docs/_archive/canvas2d-shadow/）
   * onChange 只发局部 patch，不整份覆盖。
   */
  import type { ElementStyle, ElementStylePatch } from '../../core/layer/style';
  import { defaultElementStyle, patchElementStyle } from '../../core/layer/style';
  import { isFreeLayerId } from '../../core/displayCompose';
  import type { World } from '../../core/types';
  import PanelShell from './PanelShell.svelte';
  import StateCapsule from './StateCapsule.svelte';
  import CapsuleSlider from './CapsuleSlider.svelte';

  let {
    open = false,
    layerId = '',
    layerName = '',
    world = null,
    cfg,
    onChange,
    onCollapse,
    x = 250,
    y = 56,
    embedded = false,
  }: {
    open?: boolean;
    layerId?: string;
    layerName?: string;
    /** 层身份判定（自由路径样式）需要 kind——id 三连比较已退役 */
    world?: World | null;
    cfg?: ElementStyle;
    onChange?: (patch: ElementStylePatch) => void;
    onCollapse?: () => void;
    /** 卡片锚点（右键菜单处打开，越界由调用方 clamp） */
    x?: number;
    y?: number;
    /** true = 嵌入检查模式展开区（无壳无锚点，2026-09-30 三模式重构） */
    embedded?: boolean;
  } = $props();

  const isFreeform = $derived(isFreeLayerId(world, layerId));
  const c = $derived(patchElementStyle(cfg ?? defaultElementStyle(), {}));
  /** 嵌入检查区默认折叠（2026-10-02 D1 拍板：低频参数收摘要行） */
  let styleOpen = $state(false);

  let debounceTimer = 0;
  let pending: ElementStylePatch = {};

  function debouncedChange(patch: ElementStylePatch) {
    pending = {
      border: { ...(pending.border ?? {}), ...(patch.border ?? {}) },
      fill: { ...(pending.fill ?? {}), ...(patch.fill ?? {}) },
    };
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      onChange?.(pending);
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

{#snippet inner()}
    {#if embedded && !isFreeform}
      <button type="button" class="sumrow" onclick={() => (styleOpen = !styleOpen)}>
        <span
          >边界 {fmt(c.border.width)} · 平滑 {fmt(c.border.smooth, 2)} · 填充{c.fill.enabled
            ? '开'
            : '关'}</span
        >
        <span class="caret">{styleOpen ? '▾' : '▸'}</span>
      </button>
    {/if}
    {#if !embedded || isFreeform || styleOpen}
    <div class="body" class:emb={embedded}>
      {#if isFreeform}
        <p class="dim">曲线层样式独立（线宽/颜色），不走元素样式。</p>
      {:else}
      <div class="grp">
        <div class="grp-hd"><span>边界</span><StateCapsule icon="📏" onText="开" offText="关" on={c.border.enabled}
            onchange={(v) => debouncedChange({ border: { enabled: v } })} /></div>
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
        <div class="grp-hd"><span>填充</span><StateCapsule icon="🎨" onText="开" offText="关" on={c.fill.enabled}
            onchange={(v) => debouncedChange({ fill: { enabled: v } })} /></div>
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
    {/if}
{/snippet}
{#if embedded}
  {@render inner()}
{:else}
  <PanelShell title="显示参数 · {layerName}" icon="🎨" {open} side="float" width={230} {x} {y} onCollapse={onCollapse}>
    {@render inner()}
  </PanelShell>
{/if}

<style>
  .row {
    display: flex;
    gap: var(--sp-3);
  }
  .seg {
    flex: 1;
    padding: 4px 8px;
    border: 1px solid var(--border, #3a4354);
    border-radius: var(--r-1);
    background: transparent;
    color: inherit;
    cursor: pointer;
    font-size: var(--fs-md);
  }
  .seg.on {
    background: var(--accent, #4a7ab0);
    border-color: var(--accent, #4a7ab0);
  }
  .body {
    padding: 8px 12px 12px;
  }
  /* 折叠摘要行（D1）：边界/平滑/填充一行可读，点开展开全部控件 */
  .sumrow {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--text-dim);
    font-size: var(--fs-sm);
    padding: 3px 0;
    cursor: pointer;
  }
  .sumrow:hover {
    color: var(--text);
  }
  .sumrow .caret {
    font-size: var(--fs-xs);
  }
  /* 嵌入检查展开区：去自身 padding、贴齐信息区左缘（2026-10-02 紧凑化） */
  .body.emb {
    padding: 2px 0 0;
  }
  .grp {
    margin-bottom: var(--sp-4);
  }
  .grp-hd {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: var(--fs-xs);
    color: var(--text-dim);
    margin-bottom: var(--sp-2);
    letter-spacing: 0.5px;
  }
  .r {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-2);
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
    font-size: var(--fs-sm);
  }
</style>
