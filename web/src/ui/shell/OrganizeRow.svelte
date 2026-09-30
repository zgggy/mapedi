<script lang="ts">
  /**
   * 组织模式行展开内容（2026-09-30 第十轮）：上移 / 下移 / 缩进 / 提升 四操作。
   * 图层与元素列表共用（传参：同一批回调）——替代长按拖动（拖动已退役）。
   * 语义见 store indentItem/unindentItem（缩进=链尾下钻；提升=上溯最老祖先后置）。
   */
  let {
    onMove,
    onIndent,
    onUnindent,
    first = false,
    top = false,
    name = '',
  }: {
    onMove?: (dir: -1 | 1) => void;
    onIndent?: () => void;
    onUnindent?: () => void;
    /** 是视觉第一个（缩进无目标） */
    first?: boolean;
    /** 已是顶层（提升无目标） */
    top?: boolean;
    /** 当前元素名（按钮 title 提示） */
    name?: string;
  } = $props();
</script>

<div class="org">
  <button type="button" class="ob" disabled={first} title="在同级中上移一层" onclick={() => onMove?.(-1)}>↑ 上移</button>
  <button type="button" class="ob" disabled={first} title="在同级中下移一层" onclick={() => onMove?.(1)}>↓ 下移</button>
  <button type="button" class="ob" disabled={first} title="成为上一个元素的子元素（已有子则下钻链尾）" onclick={onIndent}>⇥ 缩进</button>
  <button type="button" class="ob" disabled={top} title="升到上一个元素最老祖先之后" onclick={onUnindent}>⇤ 提升</button>
  {#if name}
    <span class="hint">操作「{name}」的层级与顺序</span>
  {/if}
</div>

<style>
  .org {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    user-select: none;
  }
  .ob {
    border: 1px solid var(--panel-border);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text, #ddd);
    border-radius: 8px;
    padding: 4px 8px;
    font-size: 11px;
    line-height: 1.2;
    cursor: pointer;
  }
  .ob:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.11);
  }
  .ob:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .hint {
    flex: 1 1 100%;
    color: var(--text-dim);
    font-size: 10px;
  }
</style>
