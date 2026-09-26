<script lang="ts">
  /**
   * 展开后的添加行：与 EntityBox 同一套灰框 box。
   */
  import CreateRow from './CreateRow.svelte';

  let {
    placeholder = '子元素',
    newName = '',
    onNewName,
    onRandom,
    onCreate,
  }: {
    placeholder?: string;
    newName?: string;
    onNewName?: (v: string) => void;
    onRandom?: () => void;
    onCreate?: () => void;
  } = $props();
</script>

<div class="ebox create-box">
  <div class="create-pad">
    <CreateRow compact {placeholder} {newName} {onNewName} {onRandom} {onCreate} />
  </div>
</div>

<style>
  .ebox {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 28px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed var(--panel-border);
  }
  .create-pad {
    width: 100%;
    padding: 3px 6px 3px 10px;
  }
</style>
