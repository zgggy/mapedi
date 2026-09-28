<script lang="ts">
  /**
   * 视图面板（独立）：视图模式 / 样式 / 浮雕平滑 / 球面参数（轴·黄道·自转·倾角·视野）。
   * 项目面板只留「生成」与「项目」。
   */
  import CapsuleSlider from './CapsuleSlider.svelte';
  import PanelShell from './PanelShell.svelte';
  import type { ViewMode } from './shell';

  let {
    open = $bindable(false),
    viewMode = 'view-2d',
    styleId = 'dark',
    reliefSmooth = 0.35,
    globeShowAxis = true,
    globeShowEcliptic = true,
    globeSpin = true,
    globeTilt = 23.4,
    globeRotHours = 24,
    onSwitchView,
    onStyle,
    onRelief,
    onGlobeShowAxis,
    onGlobeShowEcliptic,
    onGlobeSpin,
    onGlobeTilt,
    onGlobeRotHours,
  }: {
    open?: boolean;
    viewMode?: ViewMode;
    styleId?: string;
    reliefSmooth?: number;
    globeShowAxis?: boolean;
    globeShowEcliptic?: boolean;
    globeSpin?: boolean;
    globeTilt?: number;
    globeRotHours?: number;
    onSwitchView: (m: ViewMode) => void;
    onStyle: (s: string) => void;
    onRelief: (v: number) => void;
    onGlobeShowAxis?: (v: boolean) => void;
    onGlobeShowEcliptic?: (v: boolean) => void;
    onGlobeSpin?: (v: boolean) => void;
    onGlobeTilt?: (v: number) => void;
    onGlobeRotHours?: (v: number) => void;
  } = $props();
</script>

<PanelShell title="视图" icon="🎛️" {open} side="float" width={320} x={420} y={56} onCollapse={() => (open = false)}>
  <div class="body">
    <section>
      <h3>视图</h3>
      <div class="row">
        <button type="button" class:active={viewMode === 'view-2d'} onclick={() => onSwitchView('view-2d')}>🗺️ 平面</button>
        <button type="button" class:active={viewMode === 'view-globe'} onclick={() => onSwitchView('view-globe')}>🌐 球面</button>
        <select value={styleId} onchange={(e) => onStyle(e.currentTarget.value)}>
          <option value="dark">暗色</option>
          <option value="parchment">羊皮纸</option>
          <option value="neon">科幻</option>
        </select>
      </div>
      <div class="row">
        <label class="sm">平滑 <CapsuleSlider min={0} max={1} step={0.05} value={reliefSmooth} label="浮雕平滑" width={130} onInput={(v) => onRelief(v)} /></label>
      </div>
    </section>
    {#if viewMode === 'view-globe'}
      <section>
        <h3>球面</h3>
        <div class="row">
          <label class="sm"><input type="checkbox" checked={globeShowAxis} onchange={(e) => onGlobeShowAxis?.(e.currentTarget.checked)} /> 轴/赤道</label>
          <label class="sm"><input type="checkbox" checked={globeShowEcliptic} onchange={(e) => onGlobeShowEcliptic?.(e.currentTarget.checked)} /> 黄道</label>
          <label class="sm"><input type="checkbox" checked={globeSpin} onchange={(e) => onGlobeSpin?.(e.currentTarget.checked)} /> 自转预览</label>
        </div>
        <div class="row">
          <label class="sm">倾角 <CapsuleSlider min={0} max={60} step={0.5} value={globeTilt} label="轴倾角" width={110} onInput={(v) => onGlobeTilt?.(v)} /> {globeTilt.toFixed(1)}°</label>
          <label class="sm">自转 <CapsuleSlider min={6} max={48} step={1} value={globeRotHours} label="自转周期" width={110} onInput={(v) => onGlobeRotHours?.(v)} /> {globeRotHours}h</label>
        </div>
        <p class="dim">球面为纯展示：高度随半径凸起（陆上凸、海下凹），图层叠加与平面同源；滚轮 = 缩放，拖动 = 环绕。</p>
      </section>
    {/if}
  </div>
</PanelShell>

<style>
  .body section {
    margin-bottom: 10px;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 4px 0;
  }
  .row button {
    padding: 3px 10px;
    border: 1px solid var(--border, #333);
    background: transparent;
    color: var(--text, #ddd);
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
  }
  .row button.active {
    background: var(--accent, #c9a24a);
    color: #1a1408;
    border-color: var(--accent, #c9a24a);
  }
  .sm {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .dim {
    color: var(--text-dim);
    font-size: 10px;
    margin: 4px 0 0;
  }
</style>
