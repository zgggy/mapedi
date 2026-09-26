<script lang="ts">
  let {
    side,
    items,
    activeId,
    onPick,
  }: {
    side: 'left' | 'right';
    items: { id: string; emoji: string; title: string }[];
    activeId: string | null;
    onPick: (id: string) => void;
  } = $props();
</script>

<nav class="rail" class:left={side === 'left'} class:right={side === 'right'}>
  {#each items as item (item.id)}
    <button
      type="button"
      class="btn"
      class:active={activeId === item.id}
      title={item.title}
      onclick={() => onPick(item.id)}
    >
      {item.emoji}
    </button>
  {/each}
</nav>

<style>
  .rail {
    position: fixed;
    top: 0;
    bottom: 0;
    width: 36px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 6px 0;
    background: rgba(8, 10, 14, 0.72);
  }
  .rail.left {
    left: 0;
  }
  .rail.right {
    right: 0;
  }
  .btn {
    width: 28px;
    height: 32px;
    padding: 0;
    border-radius: 6px;
    display: grid;
    place-items: center;
    font-size: 13px;
    background: rgba(28, 32, 40, 0.9);
    border: 1px solid var(--panel-border);
  }
  .btn.active {
    background: rgba(107, 124, 147, 0.45);
  }
</style>
