<script lang="ts">
  /**
   * ItemButton 右键菜单：具体操作（显隐 / 上移一层 / 下移一层 / 复制一个 / 删除…）。
   * 点击菜单外或 Esc 关闭；靠近屏幕边缘自动内收。
   */
  export type MenuItem = {
    id: string;
    label: string;
    danger?: boolean;
    disabled?: boolean;
    action?: () => void;
  };

  let {
    x = 0,
    y = 0,
    items = [],
    onClose,
  }: {
    x?: number;
    y?: number;
    items: MenuItem[];
    onClose: () => void;
  } = $props();

  let el: HTMLElement | undefined = $state();
  let pos = $state({ x, y });

  $effect(() => {
    // 贴边内收：挂载后按实际尺寸修正
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = Math.min(x, window.innerWidth - r.width - 8);
    const py = Math.min(y, window.innerHeight - r.height - 8);
    pos = { x: Math.max(8, px), y: Math.max(8, py) };
  });

  function onDocPointer(e: PointerEvent) {
    if (el && !el.contains(e.target as Node)) onClose();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    }
  }
</script>

<svelte:document onpointerdown={onDocPointer} onkeydown={onKey} />

<div class="menu" style="left:{pos.x}px;top:{pos.y}px" bind:this={el} role="menu">
  {#each items as it (it.id)}
    <button
      type="button"
      class="mi"
      class:danger={it.danger}
      disabled={it.disabled}
      role="menuitem"
      onclick={(e) => {
        e.stopPropagation();
        onClose();
        it.action?.();
      }}
    >{it.label}</button>
  {/each}
</div>

<style>
  .menu {
    position: fixed;
    z-index: 200;
    min-width: 128px;
    padding: 4px;
    border-radius: 10px;
    background: rgba(20, 23, 30, 0.97);
    border: 1px solid var(--panel-border);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    display: flex;
    flex-direction: column;
    gap: 1px;
    font-size: 12px;
  }
  .mi {
    text-align: left;
    padding: 6px 10px;
    border: none;
    border-radius: 7px;
    background: transparent;
    color: var(--text);
    cursor: pointer;
    font: inherit;
    white-space: nowrap;
  }
  .mi:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.1);
  }
  .mi:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .mi.danger:hover:not(:disabled) {
    background: rgba(220, 80, 70, 0.25);
  }
</style>
