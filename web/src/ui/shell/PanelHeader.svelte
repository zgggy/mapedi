<script lang="ts">
  import CreateRow from './CreateRow.svelte';

  /** 图层面板 / 工作区共用大标题：图标 + 名称 + 共用添加组件 */
  let {
    icon = '📚',
    title = '',
    placeholder = '名称',
    newName = '',
    showCreate = true,
    onNewName,
    onRandom,
    onCreate,
  }: {
    icon?: string;
    title?: string;
    placeholder?: string;
    newName?: string;
    showCreate?: boolean;
    onNewName?: (v: string) => void;
    onRandom?: () => void;
    onCreate?: () => void;
  } = $props();
</script>

<div class="ph">
  <span class="ph-icon">{icon}</span>
  <span class="ph-name">{title}</span>
  {#if showCreate}
    <span class="ph-create">
      <CreateRow {placeholder} {newName} {onNewName} {onRandom} {onCreate} />
    </span>
  {/if}
</div>

<style>
  .ph {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 8px 8px;
    border-bottom: 1px solid var(--panel-border);
    flex-shrink: 0;
  }
  .ph-icon {
    font-size: 14px;
    line-height: 1;
  }
  .ph-name {
    flex: 0 0 auto;
    font-weight: 600;
    font-size: 13px;
  }
  .ph-create {
    margin-left: auto;
  }
</style>
