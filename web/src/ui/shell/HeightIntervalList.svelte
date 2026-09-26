<script lang="ts">
  /**
   * 高度工作区间：固定 12 档。选中 ≡ 绘制目标。
   * 取代 HeightColorRuler 色卡。
   */
  import type { HeightInterval } from '../../core/layer/heightIntervals';

  let {
    intervals,
    activeId = 'h6',
    onSelect,
  }: {
    intervals: HeightInterval[];
    activeId?: string;
    onSelect?: (id: string) => void;
  } = $props();
</script>

<div class="hiv" role="listbox" aria-label="高度工作区间">
  <div class="hd">工作区间 · 12 档</div>
  <div class="list">
    {#each intervals as iv (iv.id)}
      <button
        type="button"
        class="row"
        class:sel={iv.id === activeId}
        role="option"
        aria-selected={iv.id === activeId}
        onclick={() => onSelect?.(iv.id)}
      >
        <span class="swatch" style="background:{iv.color}"></span>
        <span class="name">{iv.name}</span>
        <span class="rng">{iv.lo}~{iv.hi}</span>
        <span class="min">赋{iv.min}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .hiv {
    padding: 8px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }
  .hd {
    font-size: 11px;
    color: var(--text-dim, #888);
    margin-bottom: 6px;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    max-height: 280px;
    overflow-y: auto;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 4px 6px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    font-size: 12px;
    text-align: left;
  }
  .row:hover {
    background: rgba(255, 255, 255, 0.06);
  }
  .row.sel {
    border-color: rgba(255, 200, 100, 0.55);
    background: rgba(255, 200, 100, 0.12);
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
    border: 1px solid rgba(255, 255, 255, 0.2);
    flex-shrink: 0;
  }
  .name {
    flex: 1;
  }
  .rng,
  .min {
    font-size: 10px;
    color: var(--text-dim, #888);
    font-variant-numeric: tabular-nums;
  }
</style>
