<script lang="ts">
  /** 共用添加组件：名称框 + 随机 + ➕（panel 头 / 元素展开子级首行） */
  let {
    placeholder = '名称',
    newName = '',
    compact = false,
    onNewName,
    onRandom,
    onCreate,
  }: {
    placeholder?: string;
    newName?: string;
    compact?: boolean;
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
</div>

<style>
  .cr {
    display: flex;
    align-items: center;
    gap: 3px;
  }
  .cr input {
    width: 72px;
    font-size: 11px;
  }
  .cr button {
    width: 24px;
    height: 24px;
    padding: 0;
    font-size: 12px;
    display: grid;
    place-items: center;
  }
  .cr.compact input {
    width: 64px;
    height: 22px;
    font-size: 10px;
  }
  .cr.compact button {
    width: 22px;
    height: 22px;
    font-size: 11px;
  }
</style>
