<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    side,
    title,
    open,
    children,
  }: {
    side: 'left' | 'right';
    title: string;
    open: boolean;
    children?: Snippet;
  } = $props();
</script>

{#if open}
  <aside class="panel" class:left={side === 'left'} class:right={side === 'right'}>
    <div class="hd">{title}</div>
    <div class="bd">
      {#if children}{@render children()}{/if}
    </div>
  </aside>
{/if}

<style>
  .panel {
    position: fixed;
    top: 8px;
    bottom: 48px;
    z-index: 45;
    width: 248px;
    display: flex;
    flex-direction: column;
    background: rgba(14, 16, 22, 0.94);
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    overflow: hidden;
    font-size: 12px;
  }
  .panel.left {
    left: 40px;
  }
  .panel.right {
    right: 40px;
  }
  .hd {
    flex: 0 0 auto;
    padding: 6px 10px;
    font-weight: 600;
    border-bottom: 1px solid var(--panel-border);
  }
  .bd {
    flex: 1;
    overflow: auto;
    padding: 8px;
  }
</style>
