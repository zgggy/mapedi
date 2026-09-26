<script lang="ts">
  import type { ValidateIssue } from '../../core/validate';

  let {
    show = false,
    issues,
    onJump,
    onFix,
    onRerun,
    onClose,
  }: {
    show?: boolean;
    issues: ValidateIssue[];
    onJump: (iss: ValidateIssue) => void;
    onFix: (iss: ValidateIssue) => void;
    onRerun: () => void;
    onClose: () => void;
  } = $props();
</script>

{#if show}
  <div class="validator-panel">
    <div class="wb-head">
      ✅ 校验 · {issues.length}
      <button type="button" onclick={onClose}>关闭</button>
      <button type="button" onclick={onRerun}>重跑</button>
    </div>
    {#if !issues.length}
      <p class="dim">未发现问题。</p>
    {/if}
    {#each issues as iss, i (i)}
      <div class="issue" class:error={iss.severity === 'error'}>
        <button type="button" class="msg" onclick={() => onJump(iss)}>
          {iss.message}
        </button>
        {#if iss.kind === 'orphan_province' || iss.kind === 'center_missing' || iss.kind === 'zero_weight' || iss.kind === 'empty_region'}
          <button type="button" onclick={() => onFix(iss)}>修复</button>
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  .validator-panel {
    position: fixed;
    right: 16px;
    bottom: 48px;
    z-index: 31;
    width: min(360px, calc(100vw - 32px));
    max-height: 40vh;
    overflow: auto;
    padding: 10px 12px;
    background: rgba(18, 20, 26, 0.92);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    font-size: 12px;
  }
  .wb-head {
    font-weight: 600;
    margin-bottom: 8px;
  }
  .dim {
    color: var(--text-dim);
  }
  .issue {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 4px;
  }
  .issue.error .msg {
    color: #f0a0a0;
  }
  .issue .msg {
    flex: 1;
    text-align: left;
    background: transparent;
    border: none;
    cursor: pointer;
    padding: 2px 0;
  }
</style>
