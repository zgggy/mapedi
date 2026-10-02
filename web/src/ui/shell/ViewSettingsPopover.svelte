<script lang="ts">
  /**
   * ⚙ 视图设置 popover（2026-09-30 重排：视图按钮移到模式胶囊右侧，内容按模式互斥）：
   * - 平面绘制（2d）= 地图风格 + 投影
   * - 球面展示（3d）= 星球参数（轴/黄道/自转/倾角/周期）——自左轨「工作区·星球」迁回
   *   （用户原话：3d 时显示 3d 相关，2d 时显示 2d 相关，和设计的一样）
   */
  import CapsuleSlider from './CapsuleSlider.svelte';
  import ModeCapsule from './ModeCapsule.svelte';
  import StateCapsule from './StateCapsule.svelte';
  import type { ViewMode } from './shell';

  let {
    open = false,
    onClose,
    viewMode = 'view-globe',
    projection = 'robinson',
    onProjection,
    styleId = 'dark',
    onStyle,
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
    open?: boolean;
    onClose: () => void;
    viewMode?: ViewMode;
    projection?: string;
    onProjection?: (p: string) => void;
    styleId?: string;
    onStyle?: (s: string) => void;
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

  function onDocPointer(e: PointerEvent) {
    if (!open) return;
    const t = e.target as Node | null;
    if (t && (t.closest?.('.pop') || t.closest?.('.gear'))) return;
    onClose();
  }
  function onKey(e: KeyboardEvent) {
    if (open && e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  }

  /** N 选 1 胶囊档位（图标配文字——2026-10-02 用户定） */
  const STYLE_ITEMS = [
    { id: 'dark', icon: '🌑', label: '暗色' },
    { id: 'parchment', icon: '📜', label: '羊皮纸' },
    { id: 'neon', icon: '👾', label: '科幻' },
  ];
  const PROJ_ITEMS = [
    { id: 'mercator', icon: '▭', label: '墨卡托' },
    { id: 'robinson', icon: '⬭', label: '罗宾森' },
  ];
</script>
<svelte:document onpointerdown={onDocPointer} onkeydown={onKey} />

{#if open}
  <div class="pop" role="dialog" aria-label="视图设置">
    {#if viewMode === 'view-globe'}
      <section>
        <h3>星球</h3>
        <div class="row">
          <StateCapsule icon="🧭" onText="开" offText="关" on={globeShowAxis} onchange={() => onGlobeShowAxis?.(!globeShowAxis)} title="轴与赤道线" />
          <StateCapsule icon="🟡" onText="开" offText="关" on={globeShowEcliptic} onchange={() => onGlobeShowEcliptic?.(!globeShowEcliptic)} title="黄道基准环（恒水平）" />
          <StateCapsule icon="🔄" onText="开" offText="关" on={globeSpin} onchange={() => onGlobeSpin?.(!globeSpin)} title="星球自转预览" />
        </div>
        <div class="row">
          <label class="sm">倾角 <CapsuleSlider min={0} max={60} step={0.5} value={globeTilt} label="轴倾角" width={110} onInput={(v) => onGlobeTilt?.(v)} /> {globeTilt.toFixed(1)}°</label>
          <label class="sm">自转 <CapsuleSlider min={6} max={48} step={1} value={globeRotHours} label="自转周期" width={110} onInput={(v) => onGlobeRotHours?.(v)} /> {globeRotHours}h</label>
        </div>
        <p class="dim">球面为纯展示：高度随半径凸起（陆上凸、海下凹），图层叠加与平面同源；滚轮 = 缩放，拖动 = 环绕。绘制请切「平面绘制」。</p>
      </section>
    {:else}
      <section>
        <h3>视图</h3>
        <div class="row">
          <span class="k">风格</span>
          <ModeCapsule
            value={styleId}
            onChange={(v) => onStyle?.(v)}
            items={STYLE_ITEMS}
            ariaLabel="地图风格"
            segMinW={76}
          />
        </div>
        <div class="row">
          <span class="k">投影</span>
          <ModeCapsule
            value={projection}
            onChange={(v) => onProjection?.(v)}
            items={PROJ_ITEMS}
            ariaLabel="投影"
            segMinW={112}
          />
        </div>
        <p class="dim">「地图风格」改的是海色/陆色/描边（StyleSet），不是界面主题。</p>
      </section>
    {/if}
  </div>
{/if}

<style>
  .pop {
    position: absolute;
    top: 32px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 70;
    width: 300px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--panel-border, #2a2f3a);
    background: rgba(14, 16, 22, 0.97);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    font-size: 12px;
  }
  section {
    margin-bottom: 0;
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
  .sm {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .k {
    font-size: 11px;
    color: var(--text-dim);
    min-width: 3em;
    flex: 0 0 auto;
  }
  .dim {
    color: var(--text-dim);
    font-size: 10px;
    margin: 4px 0 0;
    line-height: 1.5;
  }
</style>
