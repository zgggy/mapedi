<script lang="ts">
  import { LAYER_META } from '../workbench/layerMeta';

  let {
    x,
    y,
    w,
    h,
    focusLayer = $bindable('cells'),
    onSelect,
  }: {
    x: number;
    y: number;
    w: number;
    h: number;
    focusLayer?: string;
    onSelect?: (id: string) => void;
  } = $props();
</script>

<div
  class="layer-overlay"
  style="left:{x}px;top:{y + 36}px;width:{w}px;max-height:{h - 40}px"
>
  <ul>
    {#each Object.entries(LAYER_META) as [id, meta] (id)}
      <li>
        <button
          type="button"
          class="layer-row"
          class:active={focusLayer === id}
          onclick={() => {
            focusLayer = id;
            onSelect?.(id);
          }}
        >
          {meta.emoji} {meta.name}
        </button>
      </li>
    {/each}
  </ul>
</div>

<style>
  .layer-overlay {
    position: fixed;
    z-index: 22;
    overflow: auto;
    padding: 8px 10px;
    background: rgba(18, 20, 26, 0.72);
    border-radius: 0 0 10px 10px;
  }
  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .layer-row {
    width: 100%;
    text-align: left;
    margin-bottom: 4px;
    padding: 8px 10px;
  }
  .layer-row.active {
    background: rgba(107, 124, 147, 0.35);
  }
</style>
