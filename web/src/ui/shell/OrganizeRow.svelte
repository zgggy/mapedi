<script lang="ts">
  /**
   * 组织模式行展开内容（2026-09-30 第十轮，第十一轮修订）：上移 / 下移 常驻；
   * 缩进 / 提升 **只在图层列表传入时渲染**（元素面板不提供这两钮，用户定）。
   * 语义（第十一轮定稿）：缩进 = 成为上一个同级图层的子图层；提升 = 升一级（父的同级）。
   * 禁用按**同级**判定：first = 无上一个同级（禁上移/缩进）；last = 无下一个同级（禁下移）；
   * top = 顶层（禁提升）。
   */
  let {
    onMove,
    onIndent,
    onUnindent,
    first = false,
    last = false,
    top = false,
    indentable = true,
    name = '',
    chain = '',
  }: {
    onMove?: (dir: -1 | 1) => void;
    /** 缺省 = 该列表不提供缩进（元素面板） */
    onIndent?: () => void;
    /** 缺省 = 该列表不提供提升（元素面板） */
    onUnindent?: () => void;
    /** 无上一个同级（上移无目标） */
    first?: boolean;
    /** 无下一个同级（下移无目标） */
    last?: boolean;
    /** 已是顶层（提升无目标） */
    top?: boolean;
    /** 有视觉上一行且非当前父（缩进有目标，2026-10-01 语义 v2） */
    indentable?: boolean;
    /** 当前元素名（按钮 title 提示） */
    name?: string;
    /** 层级面包屑（图层：'根 › 父'，顶层为空——2026-10-02 方案 §5.4） */
    chain?: string;
  } = $props();

  /** 禁用原因行内化（2026-10-02 方案 §5.8：不再只有悬停 title 可见） */
  const reasons = $derived(
    [
      first ? '已在最上' : '',
      last ? '已在最下' : '',
      top ? '已提升至顶层' : '',
      onIndent && !indentable ? '缩进无目标' : '',
    ].filter(Boolean),
  );
</script>

<div class="org">
  <button type="button" class="ob" disabled={first} title="在同级中上移一层" onclick={() => onMove?.(-1)}>↑ 上移</button>
  <button type="button" class="ob" disabled={last} title="在同级中下移一层" onclick={() => onMove?.(1)}>↓ 下移</button>
  {#if onIndent}
    <button type="button" class="ob" disabled={!indentable} title="缩进到视觉上一图层之下（它有子则下钻至其子链尾）" onclick={onIndent}>⇥ 缩进</button>
  {/if}
  {#if onUnindent}
    <button type="button" class="ob" disabled={top} title="提升至顶层（还有父就继续上溯，一次到位）" onclick={onUnindent}>⇤ 提升</button>
  {/if}
  {#if reasons.length}
    <span class="hint dim-hint">{reasons.join(' · ')}</span>
  {:else if chain}
    <span class="hint">{chain}</span>
  {:else if name}
    <span class="hint">操作「{name}」的层级与顺序</span>
  {/if}
</div>

<style>
  .org {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--sp-3);
    font-size: var(--fs-sm);
    user-select: none;
  }
  .ob {
    border: 1px solid var(--panel-border);
    background: rgba(255, 255, 255, 0.05);
    color: var(--text, #ddd);
    border-radius: var(--r-3);
    padding: 4px 8px;
    font-size: var(--fs-sm);
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
  .dim-hint {
    color: var(--text-dim);
    opacity: 0.85;
  }
  .hint {
    flex: 1 1 100%;
    color: var(--text-dim);
    font-size: var(--fs-xs);
  }
</style>
