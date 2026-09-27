<script lang="ts">
  let {
    name,
    emoji = '',
    color = '',
    badge = '',
    selected = false,
    showActions = false,
    expandable = false,
    expanded = false,
    visible = true,
    onSelect,
    onToggle,
    onInfo,
    onStyle,
    onDraw,
    onDelete,
  }: {
    name: string;
    emoji?: string;
    color?: string;
    badge?: string;
    selected?: boolean;
    showActions?: boolean;
    expandable?: boolean;
    expanded?: boolean;
    /** 显示中：彩色边框；隐藏：灰边 */
    visible?: boolean;
    /** 单击：选中 */
    onSelect?: (e?: MouseEvent) => void;
    /** 眼睛图标点击：显隐切换（睁眼=显示，闭眼=隐藏） */
    onToggle?: () => void;
    onInfo?: () => void;
    onStyle?: () => void;
    onDraw?: () => void;
    onDelete?: () => void;
  } = $props();
</script>

<div class="ebox" class:sel={selected} class:vis={visible} class:hidden={!visible}>
  {#if onToggle}
    <!-- 眼睛图标（按钮左侧）：睁眼=显示该图层，闭眼=隐藏；点击即切换 -->
    <button
      type="button"
      class="eye"
      class:closed={!visible}
      title={visible ? '隐藏图层' : '显示图层'}
      aria-label={visible ? '隐藏图层' : '显示图层'}
      onclick={(e) => { e.stopPropagation(); onToggle(); }}
    ><span class="eyeglyph" aria-hidden="true">👁</span></button>
  {/if}
  <button
    type="button"
    class="main"
    onclick={(e) => onSelect?.(e)}
    ondblclick={(e) => {
      e.preventDefault();
      // 双击 = 弹出图层显示面板（原显隐切换移到眼睛图标）
      if (onStyle) onStyle();
    }}
  >
    {#if color}
      <span class="icon dot" style="background:{color}"></span>
    {:else if emoji}
      <span class="icon em">{emoji}</span>
    {/if}
    <span class="nm">{name}</span>
    {#if badge}
      <span class="badge" title={badge}>{badge}</span>
    {/if}
    {#if expandable}
      <span class="chev">{expanded ? '▾' : '▸'}</span>
    {/if}
  </button>
  {#if showActions}
    <span class="acts">
      {#if onInfo}
        <button type="button" title="信息" onclick={(e) => { e.stopPropagation(); onInfo(); }}>ℹ</button>
      {/if}
      {#if onDelete}
        <button type="button" title="删除" onclick={(e) => { e.stopPropagation(); onDelete(); }}>🗑</button>
      {/if}
    </span>
  {/if}
</div>

<style>
  .ebox {
    position: relative;
    display: flex;
    align-items: center;
    min-height: 28px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid var(--panel-border);
    margin: 0;
  }
  .ebox.vis {
    border-color: rgba(240, 195, 106, 0.75);
  }
  .ebox.hidden {
    border-color: var(--panel-border);
    opacity: 0.72;
  }
  .ebox.sel {
    background: rgba(107, 124, 147, 0.32);
  }
  .ebox:hover {
    background: rgba(255, 255, 255, 0.07);
  }
  .eye {
    flex: 0 0 auto;
    margin-right: 2px;
    padding: 2px 3px;
    border: none;
    background: transparent;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    opacity: 0.95;
  }
  .eye:hover {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 5px;
  }
  .eye .eyeglyph {
    display: inline-block;
    transform: scaleY(1.1);
  }
  /* 闭眼：压扁 + 划线 = 该图层隐藏 */
  .eye.closed .eyeglyph {
    transform: scaleY(0.28);
    opacity: 0.55;
  }
  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 28px;
    padding: 0 8px 0 10px;
    background: transparent;
    border: none;
    color: var(--text);
    font-size: 12px;
    text-align: left;
    cursor: pointer;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .em {
    width: 16px;
    text-align: center;
    flex-shrink: 0;
  }
  .nm {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .badge {
    flex-shrink: 0;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: 10px;
    color: var(--text-dim);
    border: 1px solid var(--panel-border);
    border-radius: 999px;
    padding: 1px 6px;
    background: var(--panel-bg);
  }
  .chev {
    color: var(--text-dim);
    font-size: 10px;
    flex-shrink: 0;
  }
  .acts {
    position: absolute;
    right: 4px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    gap: 2px;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.12s;
  }
  .ebox:hover .acts {
    opacity: 1;
    pointer-events: auto;
  }
  .acts button {
    width: 22px;
    height: 22px;
    padding: 0;
    font-size: 12px;
    display: grid;
    place-items: center;
    background: rgba(18, 20, 26, 0.85);
  }
</style>
