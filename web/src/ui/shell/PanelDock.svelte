<script lang="ts">
  /**
   * 面板 Dock：屏幕左下角，图标从左往右依次排列。
   * 每个图标 = 一个面板；按钮黄框 = 面板打开，无黄框 = 收起。点击切换。
   */
  let {
    items = [],
    onToggle,
  }: {
    items: { id: string; icon: string; title: string; open: boolean }[];
    onToggle: (id: string) => void;
  } = $props();
</script>

<div class="dock" role="toolbar" aria-label="面板">
  {#each items as it (it.id)}
    <button
      type="button"
      class="dock-btn"
      class:open={it.open}
      title={`${it.title}（${it.open ? '已打开' : '已收起'}）`}
      aria-label={it.title}
      aria-pressed={it.open}
      onclick={() => onToggle(it.id)}
    >{it.icon}</button>
  {/each}
</div>

<style>
  .dock {
    position: fixed;
    left: 10px;
    bottom: 34px;
    z-index: 90;
    display: flex;
    flex-direction: row;
    gap: 6px;
  }
  .dock-btn {
    width: 34px;
    height: 34px;
    display: grid;
    place-items: center;
    font-size: 15px;
    line-height: 1;
    border: 1px solid var(--panel-border);
    border-radius: 9px;
    background: rgba(16, 19, 26, 0.92);
    color: inherit;
    cursor: pointer;
    padding: 0;
  }
  .dock-btn:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  /* 打开 = 黄色边框；关闭 = 无黄框 */
  .dock-btn.open {
    border-color: #f0c36a;
    box-shadow: 0 0 0 1px rgba(240, 195, 106, 0.35);
  }
</style>
