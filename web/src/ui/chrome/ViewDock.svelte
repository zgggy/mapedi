<script lang="ts">
  import { PRESET_STYLES } from '../../core/styles';

  let {
    viewMode = $bindable('view-2d'),
    reliefSmooth = $bindable(0.35),
    styleId = $bindable('dark'),
    transitioning = false,
    onMode,
  }: {
    viewMode?: 'view-2d' | 'view-globe';
    reliefSmooth?: number;
    styleId?: string;
    transitioning?: boolean;
    onMode?: (m: 'view-2d' | 'view-globe') => void;
  } = $props();

  function setMode(m: 'view-2d' | 'view-globe') {
    if (m === viewMode) return;
    if (onMode) onMode(m);
    else viewMode = m;
  }
</script>

<div class="view-dock" class:busy={transitioning}>
  <button type="button" class:active={viewMode === 'view-2d'} onclick={() => setMode('view-2d')}>
    🗺️ 平面
  </button>
  <button type="button" class:active={viewMode === 'view-globe'} onclick={() => setMode('view-globe')}>
    🌐 球面
  </button>
  <label>
    平滑
    <input type="range" min="0" max="1" step="0.05" bind:value={reliefSmooth} />
    <span>{reliefSmooth.toFixed(2)}</span>
  </label>
  <select bind:value={styleId} title="颜色集">
    {#each PRESET_STYLES as s (s.id)}
      <option value={s.id}>{s.name}</option>
    {/each}
  </select>
</div>

<style>
  .view-dock {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    align-items: center;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 0;
    font-size: 12px;
    max-width: 100%;
  }
  .view-dock.busy {
    opacity: 0.85;
  }
  .view-dock button.active {
    background: rgba(107, 124, 147, 0.4);
  }
  .view-dock label {
    display: flex;
    align-items: center;
    gap: 4px;
    color: var(--text-dim);
  }
  .view-dock input[type='range'] {
    width: 70px;
  }
</style>
