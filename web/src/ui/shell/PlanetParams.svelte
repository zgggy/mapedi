<script lang="ts">
  /**
   * 「星球」参数区（设计稿 §3.4 / D3，2026-09-29 拍板）：
   * 球面模式下左轨的工作区内容 —— 倾角 / 自转周期 / 自转预览 / 轴·赤道 / 黄道
   * （自原视图面板迁入，U1 时暂留 ⚙ popover，U2 迁到此处）。
   * 球面 = 纯展示，故工具带、生成、元素列表在本模式不出现。
   */
  import CapsuleSlider from './CapsuleSlider.svelte';

  let {
    globeShowAxis = true,
    globeShowEcliptic = true,
    globeSpin = false,
    globeTilt = 23.4,
    globeRotHours = 24,
    onGlobeShowAxis,
    onGlobeShowEcliptic,
    onGlobeSpin,
    onGlobeTilt,
    onGlobeRotHours,
  }: {
    globeShowAxis?: boolean;
    globeShowEcliptic?: boolean;
    globeSpin?: boolean;
    globeTilt?: number;
    globeRotHours?: number;
    onGlobeShowAxis?: (v: boolean) => void;
    onGlobeShowEcliptic?: (v: boolean) => void;
    onGlobeSpin?: (v: boolean) => void;
    onGlobeTilt?: (v: number) => void;
    onGlobeRotHours?: (v: number) => void;
  } = $props();
</script>

<div class="sec-root">
  <header class="hd">
    <span class="ico">🌐</span>
    <span class="nm">工作区 · 星球</span>
  </header>

  <div class="body">
    <section>
      <h3>姿态</h3>
      <div class="row">
        <label class="sm"><input type="checkbox" checked={globeShowAxis} onchange={(e) => onGlobeShowAxis?.(e.currentTarget.checked)} /> 轴 / 赤道</label>
        <label class="sm"><input type="checkbox" checked={globeShowEcliptic} onchange={(e) => onGlobeShowEcliptic?.(e.currentTarget.checked)} /> 黄道</label>
        <label class="sm"><input type="checkbox" checked={globeSpin} onchange={(e) => onGlobeSpin?.(e.currentTarget.checked)} /> 自转预览</label>
      </div>
      <div class="row">
        <label class="sm">倾角 <CapsuleSlider min={0} max={60} step={0.5} value={globeTilt} label="轴倾角" width={110} onInput={(v) => onGlobeTilt?.(v)} /> {globeTilt.toFixed(1)}°</label>
        <label class="sm">自转 <CapsuleSlider min={6} max={48} step={1} value={globeRotHours} label="自转周期" width={110} onInput={(v) => onGlobeRotHours?.(v)} /> {globeRotHours}h</label>
      </div>
      <p class="dim">球面为纯展示：高度随半径凸起（陆上凸、海下凹），图层叠加与平面同源；滚轮 = 缩放，拖动 = 环绕。绘制请切「平面绘制」。</p>
    </section>
  </div>
</div>

<style>
  .sec-root {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .hd {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
    padding: 4px 8px;
    border-bottom: 1px solid var(--panel-border);
    flex: 0 0 auto;
  }
  .ico {
    font-size: 12px;
    line-height: 1;
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: 12px;
    color: var(--text-dim);
  }
  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 8px;
    scrollbar-width: none;
  }
  .body::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
  section {
    margin-bottom: 8px;
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
    margin: 6px 0;
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
    margin: 6px 0 0;
    line-height: 1.5;
  }
</style>
