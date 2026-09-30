<script lang="ts">
  /**
   * ⚙ 视图设置 popover（设计稿 §2.3）：只留**投影 + 地图风格**（StyleSet 正名）。
   * 球面参数已迁到左轨「星球」参数区（§3.4 / D3，U2 落地）——此处不再重复。
   */
  import type { ViewMode } from './shell';

  let {
    open = false,
    onClose,
    viewMode = 'view-globe',
    projection = 'robinson',
    onProjection,
    styleId = 'dark',
    onStyle,
  }: {
    open?: boolean;
    onClose: () => void;
    viewMode?: ViewMode;
    projection?: string;
    onProjection?: (p: string) => void;
    styleId?: string;
    onStyle?: (s: string) => void;
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
</script>

<svelte:document onpointerdown={onDocPointer} onkeydown={onKey} />

{#if open}
  <div class="pop" role="dialog" aria-label="视图设置">
    <section>
      <h3>视图</h3>
      <div class="row">
        <label class="sm">地图风格
          <select value={styleId} onchange={(e) => onStyle?.(e.currentTarget.value)}>
            <option value="dark">暗色</option>
            <option value="parchment">羊皮纸</option>
            <option value="neon">科幻</option>
          </select>
        </label>
        {#if viewMode === 'view-2d'}
          <label class="sm">投影
            <select value={projection} onchange={(e) => onProjection?.(e.currentTarget.value)}>
              <option value="mercator">墨卡托</option>
              <option value="robinson">罗宾森（两极内收）</option>
            </select>
          </label>
        {/if}
      </div>
      <p class="dim">「地图风格」改的是海色/陆色/描边（StyleSet），不是界面主题；球面参数在左轨「工作区 · 星球」。</p>
    </section>
  </div>
{/if}

<style>
  .pop {
    position: absolute;
    top: 32px;
    right: 0;
    z-index: 70;
    width: 288px;
    padding: 10px 12px;
    border-radius: 12px;
    border: 1px solid var(--panel-border, #2a2f3a);
    background: rgba(14, 16, 22, 0.97);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    font-size: 12px;
  }
  section {
    margin-bottom: 8px;
  }
  section:last-child {
    margin-bottom: 0;
  }
  h3 {
    margin: 0 0 6px;
    font-size: 12px;
    color: var(--text-dim);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .tmp {
    font-size: 9px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.4);
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
  select {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text, #ddd);
    border: 1px solid var(--border, #333);
    border-radius: 5px;
    font-size: 11px;
    padding: 2px 4px;
  }
  .dim {
    color: var(--text-dim);
    font-size: 10px;
    margin: 4px 0 0;
  }
</style>
