<script lang="ts">
  import type { Region, World } from '../../core/types';

  let {
    world,
    focusLayer,
    selectedRegionId = $bindable(null),
    expandedId = $bindable(null),
    onSelect,
    onInfo,
    onDelete,
    onDraw,
    onAnnex,
    annexPick = false,
  }: {
    world: World;
    focusLayer: string;
    selectedRegionId?: string | null;
    expandedId?: string | null;
    onSelect: (id: string) => void;
    onInfo: (id: string) => void;
    onDelete: (id: string) => void;
    onDraw: (id: string) => void;
    onAnnex: (id: string) => void;
    annexPick?: boolean;
  } = $props();

  const items = $derived(world.regions.filter((r) => r.layerId === focusLayer));
  const childLayerOf = $derived(
    world.layers.find((l) => l.parentLayerId === focusLayer)?.id ?? null,
  );

  function childrenOf(id: string): Region[] {
    return world.regions.filter((r) => r.parentId === id);
  }
</script>

{#if !items.length}
  <p class="dim empty">此层暂无元素 · 用顶部生成或下方新增</p>
{:else}
  <div class="list">
    {#each items as r (r.id)}
      <div class="box" class:sel={selectedRegionId === r.id}>
        <div class="row">
          <span class="swatch" style="background:{r.color}"></span>
          <button type="button" class="name" onclick={() => onSelect(r.id)}>
            {r.name}
          </button>
          <span class="dim">{r.cells.length}c</span>
          {#if r.centerCellId !== undefined}<span title="中心">📍</span>{/if}
          <span class="btns">
            <button type="button" title="信息" onclick={() => onInfo(r.id)}>ℹ️</button>
            <button type="button" title="绘制" onclick={() => onDraw(r.id)}>🖌️</button>
            {#if annexPick && selectedRegionId && selectedRegionId !== r.id}
              <button type="button" title="吞并到此" onclick={() => onAnnex(r.id)}>🤝</button>
            {/if}
            <button type="button" title="删除（保留子元素）" onclick={() => onDelete(r.id)}>🗑️</button>
            {#if childLayerOf}
              <button
                type="button"
                title="展开子元素"
                onclick={() => (expandedId = expandedId === r.id ? null : r.id)}
              >
                {expandedId === r.id ? '▾' : '▸'}
              </button>
            {/if}
          </span>
        </div>
        {#if childLayerOf && expandedId === r.id}
          <div class="children">
            {#each childrenOf(r.id) as ch (ch.id)}
              <div class="box child" class:sel={selectedRegionId === ch.id}>
                <div class="row">
                  <span class="swatch" style="background:{ch.color}"></span>
                  <button type="button" class="name" onclick={() => onSelect(ch.id)}>
                    {ch.name}
                  </button>
                  <span class="dim">{ch.cells.length}c</span>
                  <span class="btns">
                    <button type="button" onclick={() => onInfo(ch.id)}>ℹ️</button>
                    <button type="button" onclick={() => onDraw(ch.id)}>🖌️</button>
                    <button type="button" onclick={() => onDelete(ch.id)}>🗑️</button>
                  </span>
                </div>
              </div>
            {/each}
            {#if !childrenOf(r.id).length}
              <p class="dim pad">（无子元素）</p>
            {/if}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .box {
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    background: rgba(0, 0, 0, 0.28);
    padding: 4px 6px;
  }
  .box.sel {
    border-color: rgba(240, 195, 106, 0.55);
  }
  .box.child {
    margin-top: 4px;
    background: rgba(0, 0, 0, 0.18);
  }
  .children {
    margin: 4px 0 4px 10px;
    padding-left: 6px;
    border-left: 2px solid rgba(255, 255, 255, 0.08);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 28px;
  }
  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .name {
    flex: 1;
    text-align: left;
    background: transparent;
    border: none;
    padding: 2px 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .btns {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }
  .btns button {
    padding: 2px 4px;
    min-width: 26px;
    font-size: 12px;
  }
  .dim {
    color: var(--text-dim);
    font-size: 11px;
    flex-shrink: 0;
  }
  .empty,
  .pad {
    padding: 8px 4px;
  }
</style>
