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
  /* 2026-10-01：去虚线框——子级创建行不再套框，只留内距对齐 */
  .ebox {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 26px;
  }
  .create-pad {
    width: 100%;
    padding: 2px 0;
  }
</style>
