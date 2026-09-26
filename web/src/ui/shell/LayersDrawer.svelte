<script lang="ts">
  import { LAYER_META } from '../workbench/layerMeta';

  let {
    focusLayer = $bindable('cells'),
    onSelect,
  }: {
    focusLayer?: string;
    onSelect?: (id: string) => void;
  } = $props();
</script>

<ul class="layers">
  {#each Object.entries(LAYER_META) as [id, meta] (id)}
    <li>
      <button
        type="button"
        class="layer"
        class:active={focusLayer === id}
        onclick={() => {
          focusLayer = id;
          onSelect?.(id);
        }}
      >
        <span class="emoji">{meta.emoji}</span>
        <span class="name">{meta.name}</span>
        <span class="kind">{meta.kind}</span>
      </button>
    </li>
  {/each}
</ul>

<style>
  .layers {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .layer {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    text-align: left;
  }
  .layer.active {
    background: rgba(107, 124, 147, 0.35);
  }
  .emoji {
    width: 22px;
  }
  .name {
    flex: 1;
  }
  .kind {
    font-size: 11px;
    color: var(--text-dim);
  }
</style>
