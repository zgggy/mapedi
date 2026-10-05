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
  import type { CellMarker, CoreSymbol, LabelMode, LabelTier } from '../../core/types';

  /** 摘要行的符号短名（与 coreSymbol 五种一一对应） */
  const SYM_LABEL: Record<string, string> = {
    none: '无', star: '★', hollowStar: '☆', ring: '⊙', square: '■', circle: '●', diamond: '◆',
  };
  /** 分段按钮选项 [value, 文案, title]（原 <select> 改按钮组：分段控件是本项目风格，
   *  且 click 事件链在验收环境可靠——合成 change 事件不触发 Svelte handler，2026-10-04 实测） */
  const NAME_MODES: [string, string, string][] = [
    ['none', '不显示', '本层元素不画名称'],
    ['name', '元素名', '显示元素名（name）'],
    ['coreLabel', '核心', '显示核心标签（如「首都」「文化中心」）'],
  ];
  const TIER_OPTS: [string, string, string][] = [
    ['', '自动', '按层深度自动推导（父层=国家级）'],
    ['primary', '国家级', '15px · 600 · 衬线 · 疏排大写'],
    ['secondary', '行省级', '13px · 500 · 无衬线'],
    ['tertiary', '语义', '12px · 常规'],
    ['minor', '次级', '10px · 最轻'],
  ];
  const SYM_OPTS: [string, string, string][] = [
    ['none', '无', '不画核心符号'],
    ['star', '★', '实心星 = 国家首都'],
    ['hollowStar', '☆', '空心星 = 省会/其他首府'],
    ['ring', '⊙', '同心圆 = 中心/圣城'],
    ['square', '■', '方块'],
    ['circle', '●', '圆'],
    ['diamond', '◆', '菱形（与自定义地块标记同款）'],
  ];
  const MARK_OPTS: [string, string, string][] = [
    ['none', '无', '不画格级标记'],
    ['id', 'ID', '每个格画地块 ID（调试）'],
    ['height', '高度', '每个格画高度值（调试）'],
  ];
  import CapsuleSlider from './CapsuleSlider.svelte';

  let {
    open = false,
    layerId = '',
    layerName = '',
    world = null,
    cfg,
    onChange,
    onDecor,
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
    /** 注记配置写回（包5：labelMode/档位/字号/门槛/符号 → editor.setLayerDecor，一条命令可撤销） */
    onDecor?: (patch: import('../../core/types').LayerDecorPatch) => void;
    onCollapse?: () => void;
    /** 卡片锚点（右键菜单处打开，越界由调用方 clamp） */
    x?: number;
    y?: number;
    /** true = 嵌入检查模式展开区（无壳无锚点，2026-09-30 三模式重构） */
    embedded?: boolean;
  } = $props();

  const isFreeform = $derived(isFreeLayerId(world, layerId));
  const c = $derived(patchElementStyle(cfg ?? defaultElementStyle(), {}));
  // 图层当前注记配置（world 每次 touch 换引用 → derived 必重算；写入方 setLayerDecor 也换引用）
  const decor = $derived(world?.layers.find((l) => l.id === layerId) ?? null);
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
            : '关'} · 名称{decor?.labelMode && decor.labelMode !== 'none' ? '开' : '关'} · 符号
          {SYM_LABEL[decor?.coreSymbol ?? 'none']}</span
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

      <div class="grp">
        <div class="grp-hd"><span>注记</span><span class="dim">名称 · 档位 · 符号</span></div>
        <label class="r">
          <span>名称</span>
          <span class="seg-group">
            {#each NAME_MODES as [v, t, tip]}
              <button type="button" class:on={(decor?.labelMode ?? 'none') === v} title={tip}
                onclick={() => onDecor?.({ labelMode: v as LabelMode })}>{t}</button>
            {/each}
          </span>
        </label>
        <label class="r">
          <span>档位</span>
          <span class="seg-group">
            {#each TIER_OPTS as [v, t, tip]}
              <button type="button" class:on={(decor?.labelTier ?? '') === v} title={tip}
                onclick={() => onDecor?.({ labelTier: (v || undefined) as LabelTier | undefined })}>{t}</button>
            {/each}
          </span>
        </label>
        <label class="r">
          字号
          <input type="number" min="8" max="40" placeholder="档位默认"
            value={decor?.labelSize ?? ''}
            onchange={(e) => onDecor?.({ labelSize: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value) })} />
          <span class="v">px</span>
        </label>
        <label class="r">
          门槛
          <input type="number" min="10" max="600" placeholder="档位默认"
            value={decor?.labelMinScale ?? ''}
            onchange={(e) => onDecor?.({ labelMinScale: e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value) })} />
          <span class="v">scale</span>
        </label>
        <label class="r">
          <span>符号</span>
          <span class="seg-group">
            {#each SYM_OPTS as [v, t, tip]}
              <button type="button" class:on={(decor?.coreSymbol ?? 'none') === v} title={tip}
                onclick={() => onDecor?.({ coreSymbol: v as CoreSymbol })}>{t}</button>
            {/each}
          </span>
        </label>
        <label class="r">
          树点
          <StateCapsule icon="🌳" onText="开" offText="关"
            on={(decor?.cellSymbol ?? 'none') === 'tree'}
            onchange={(v) => onDecor?.({ cellSymbol: v ? 'tree' : 'none' })} />
        </label>
        <label class="r">
          <span>格标</span>
          <span class="seg-group">
            {#each MARK_OPTS as [v, t, tip]}
              <button type="button" class:on={(decor?.cellMarker ?? 'none') === v} title={tip}
                onclick={() => onDecor?.({ cellMarker: v as CellMarker })}>{t}</button>
            {/each}
          </span>
        </label>
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
  .r input[type='number'] {
    flex: 1;
    min-width: 0;
    background: transparent;
    color: var(--text);
    border: 1px solid var(--border, #3a4354);
    border-radius: var(--r-1);
    padding: 2px 6px;
    font-size: var(--fs-sm);
    font-family: inherit;
  }
  /* 分段按钮组（注记四项）：可换行避免窄面板挤压 */
  .r .v {
    min-width: 2.5em;
    font-variant-numeric: tabular-nums;
    color: var(--text);
    font-size: var(--fs-sm);
  }
</style>
