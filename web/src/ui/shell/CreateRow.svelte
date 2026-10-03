<script lang="ts">
  /**
   * 共用创建/搜索行（第十一轮结构定稿）：文本框 = 创建名 **兼** 下方列表过滤器
   * （输入即搜索，与原「搜索元素」同能力——独立搜索行已退役），+ 🎲 + ➕ 三件整体
   * 拉满 = 与下方 button 同宽。canCreate=false（高度层/球面纯展示）只留文本框做搜索。
   */
  let {
    placeholder = '名称',
    newName = '',
    compact = false,
    canCreate = true,
    onNewName,
    onRandom,
    onCreate,
  }: {
    placeholder?: string;
    newName?: string;
    compact?: boolean;
    /** false = 随机/添加钮隐藏，文本框只做过滤 */
    canCreate?: boolean;
    onNewName?: (v: string) => void;
    onRandom?: () => void;
    onCreate?: () => void;
  } = $props();
</script>

<div class="cr" class:compact>
  <input
    {placeholder}
    value={newName}
    oninput={(e) => onNewName?.(e.currentTarget.value)}
    onkeydown={(e) => {
      if (e.key === 'Enter') onCreate?.();
    }}
  />
  {#if canCreate}
    <button
      type="button"
      title="随机名"
      onpointerdown={(e) => e.stopPropagation()}
      onclick={(e) => {
        e.stopPropagation();
        onRandom?.();
      }}
    >🎲</button>
    <button
      type="button"
      title="添加"
      onpointerdown={(e) => e.stopPropagation()}
      onclick={(e) => {
        e.stopPropagation();
        onCreate?.();
      }}
    >➕</button>
  {/if}
</div>

<style>
  .cr {
    display: flex;
    align-items: center;
    gap: 3px;
    width: 100%; /* 三件整体 = 下方 button 同宽（结构定稿） */
  }
  .cr input {
    flex: 1 1 auto;
    width: auto;
    min-width: 0;
    font-size: var(--fs-sm);
  }
  .cr button {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    padding: 0;
    font-size: var(--fs-md);
    display: grid;
    place-items: center;
  }
  .cr.compact input {
    height: 22px;
    font-size: var(--fs-xs);
  }
  .cr.compact button {
    width: 22px;
    height: 22px;
    font-size: var(--fs-sm);
  }
</style>
