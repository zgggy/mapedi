<script lang="ts">
  /**
   * 状态胶囊（2026-10-02 用户定）：布尔开关 = **一个胶囊按钮**——
   * 状态靠**边框 + 背景颜色**区分（on=点亮描边+底色；off=灰描边+透明底），
   * 内容 = 图标 + 状态文字（可像 👁/🚫 随状态换图标）。
   * 取代散落的 checkbox+label（视图设置/星球参数/样式显示/检查区显隐等）。
   * 与 ModeCapsule（N 选 1 分段胶囊）成对：状态用本件、档位用 ModeCapsule。
   */
  let {
    icon = '🔘',
    onIcon = '',
    offIcon = '',
    onText,
    offText,
    on = false,
    onchange,
    size = 'sm',
    title = '',
    disabled = false,
  }: {
    /** 身份图标（缺省两侧同图标；给了 on/offIcon 则随状态换——👁/🚫 式） */
    icon?: string;
    onIcon?: string;
    offIcon?: string;
    onText: string;
    offText: string;
    on: boolean;
    /** 期望态回调（组件内部取反后上报） */
    onchange: (v: boolean) => void;
    size?: 'sm' | 'md';
    title?: string;
    disabled?: boolean;
  } = $props();
</script>

<button
  type="button"
  class="scap"
  class:on
  class:md={size === 'md'}
  {title}
  {disabled}
  onclick={() => onchange(!on)}
>
  <span class="ic">{on ? onIcon || icon : offIcon || icon}</span>
  <span class="tx">{on ? onText : offText}</span>
</button>

<style>
  .scap {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    border: 1px solid var(--panel-border);
    border-radius: var(--r-pill);
    background: transparent;
    color: var(--text-dim);
    padding: 2px 8px;
    font-size: var(--fs-sm);
    line-height: 1.3;
    cursor: pointer;
    white-space: nowrap;
  }
  /* 状态 = 边框 + 背景（用户定）：on 点亮、off 退底 */
  .scap.on {
    border-color: rgba(120, 160, 220, 0.65);
    background: rgba(120, 160, 220, 0.22);
    color: var(--text);
  }
  .scap:hover:not(:disabled) {
    border-color: rgba(120, 160, 220, 0.85);
  }
  .scap.on:hover:not(:disabled) {
    background: rgba(120, 160, 220, 0.32);
  }
  .scap:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .scap.md {
    padding: 3px 10px;
  }
  .ic {
    font-size: var(--fs-sm);
    line-height: 1;
  }
  .tx {
    font-size: var(--fs-sm);
  }
</style>
