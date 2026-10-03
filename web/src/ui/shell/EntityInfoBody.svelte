<script lang="ts">
  /**
   * 信息面板内容体（图层/元素共用，2026-10-02 重构方案 §5 落地）：
   * 「身份 → 短 KV 流 → 描述 → 相邻 → 详情▸ → 动作条」纵向五段——
   * 高频高重要在上（名称/颜色/计数），低频低重要进「详情」（ID/分类），
   * 空描述收起为「＋ 添加描述」，保存固定为右对齐动作条（sticky 底）。
   * 不放解释性文字；无内嵌框（容器由 ExpandPanel 统一）。
   */
  let {
    name = '',
    basicColor = '',
    basicEditable = true,
    cellCount = 0,
    countLabel = '地块',
    description = '',
    neighbors = [] as { id: string; name: string; color: string }[],
    extra = [] as { label: string; value: string; detail?: boolean }[],
    showAdjacent = true,
    onSave,
  }: {
    name?: string;
    basicColor?: string;
    basicEditable?: boolean;
    cellCount?: number;
    /** 计数行标签：元素=地块（cell 数）、图层=元素（region 数） */
    countLabel?: string;
    description?: string;
    neighbors?: { id: string; name: string; color: string }[];
    /** 结构 KV；detail=true 折进「详情 ▸」（ID/分类类低频元数据） */
    extra?: { label: string; value: string; detail?: boolean }[];
    /** 图层无「相邻」概念（恒空=死信息，2026-10-02 D7 拍板：不渲染） */
    showAdjacent?: boolean;
    onSave?: (patch: { name?: string; color?: string; description?: string }) => void;
  } = $props();

  let editName = $state('');
  let editBasic = $state('');
  let editDesc = $state('');
  let editKey = $state('');
  /** 描述空态收起（P1）；有值常开。详情默认折叠（P2/L3）。 */
  let descOpen = $state(false);
  let showDetail = $state(false);

  // 目标切换（选中另一个元素/图层）时重置编辑副本与折叠态
  $effect(() => {
    const key = `${name}|${basicColor}|${description}`;
    if (key !== editKey) {
      editKey = key;
      editName = name;
      editBasic = basicColor;
      editDesc = description;
      descOpen = !!description;
      showDetail = false;
    }
  });

  const mainExtra = $derived(extra.filter((e) => !e.detail));
  const detailExtra = $derived(extra.filter((e) => e.detail));
</script>

<div class="body">
  <!-- 身份行（2026-10-02 方案）：名称 + 颜色 同行 -->
  <div class="field inline">
    <span class="lb1">名称</span>
    <input class="nm" value={editName} oninput={(e) => (editName = e.currentTarget.value)} />
    <span class="lb1">颜色</span>
    <input
      class="cl"
      type="color"
      value={editBasic || '#888888'}
      disabled={!basicEditable}
      oninput={(e) => (editBasic = e.currentTarget.value)}
    />
  </div>

  <!-- 短 KV 流：计数 + 结构类并排，放不下才换行 -->
  <div class="flow">
    <span class="ex"><span class="lb">{countLabel}</span>{cellCount}</span>
    {#each mainExtra as row (row.label)}
      <span class="ex"><span class="lb">{row.label}</span>{row.value}</span>
    {/each}
  </div>

  <!-- 描述：空态 = 一行按钮（P1 空态收起） -->
  {#if !descOpen}
    <button type="button" class="ghostbtn" onclick={() => (descOpen = true)}>＋ 添加描述</button>
  {:else}
    <label class="field">
      <span class="lb1">描述</span>
      <textarea rows="2" value={editDesc} oninput={(e) => (editDesc = e.currentTarget.value)}></textarea>
    </label>
  {/if}

  {#if showAdjacent}
    {#if neighbors.length}
      <div class="ex-row nbr-row">
        <span class="lb">相邻</span>
        <span class="nbr">
          {#each neighbors as n (n.id)}
            <span class="nb"><span class="dot" style="background:{n.color}"></span>{n.name}</span>
          {/each}
        </span>
      </div>
    {:else}
      <div class="ex-row"><span class="lb">相邻</span><span>—</span></div>
    {/if}
  {/if}

  <!-- 详情 ▸：ID/分类等低频元数据（L3 折叠） -->
  {#if detailExtra.length}
    <button type="button" class="ghostbtn dt" onclick={() => (showDetail = !showDetail)}>
      {showDetail ? '详情 ▾' : '详情 ▸'}
    </button>
    {#if showDetail}
      <div class="flow">
        {#each detailExtra as row (row.label)}
          <span class="ex"><span class="lb">{row.label}</span>{row.value}</span>
        {/each}
      </div>
    {/if}
  {/if}

  <!-- 动作条（sticky 底，右对齐——P8 动作与信息分层） -->
  <div class="actions">
    <button
      type="button"
      class="primary"
      onclick={() => onSave?.({ name: editName, color: basicEditable ? editBasic : undefined, description: editDesc })}
    >
      保存
    </button>
  </div>
</div>

<style>
  .body {
    font-size: var(--fs-md);
    display: flex;
    flex-direction: column;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    margin-bottom: var(--sp-2);
    color: var(--text-dim);
    font-size: var(--fs-sm);
  }
  .field.inline {
    flex-direction: row;
    align-items: center;
    gap: var(--sp-3);
  }
  .field .lb1 {
    flex: 0 0 auto;
    min-width: 2.5em;
  }
  .field.inline .nm {
    flex: 1 1 auto;
    min-width: 0;
  }
  .field.inline .cl {
    flex: 0 0 auto;
    width: 30px;
    height: 20px;
    padding: 1px;
    border: 1px solid var(--panel-border);
    border-radius: 5px;
    background: transparent;
    cursor: pointer;
  }
  .field input,
  .field textarea {
    color: var(--text);
  }
  .field input:disabled {
    opacity: 0.45;
  }
  /* 短 KV 流：并排铺、放不下自动换行（信息不减） */
  .flow {
    display: flex;
    flex-wrap: wrap;
    gap: 1px 14px;
    margin-bottom: 3px;
    font-size: var(--fs-sm);
    line-height: 1.5;
  }
  .ex {
    display: inline-flex;
    gap: 5px;
    align-items: baseline;
    min-width: 0;
  }
  .ex .lb {
    color: var(--text-dim);
  }
  .ex-row {
    display: flex;
    gap: var(--sp-4);
    font-size: var(--fs-sm);
    margin-bottom: 3px;
    line-height: 1.5;
  }
  .ex-row .lb {
    color: var(--text-dim);
    min-width: 3em;
    flex: 0 0 auto;
  }
  .nbr-row .nbr {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 10px;
    min-width: 0;
  }
  .nb {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  /* 幽灵行按钮：空态描述 / 详情开关（11px dim，无框） */
  .ghostbtn {
    align-self: flex-start;
    border: 0;
    background: transparent;
    color: var(--text-dim);
    font-size: var(--fs-sm);
    padding: 2px 0;
    margin-bottom: 3px;
    cursor: pointer;
  }
  .ghostbtn:hover {
    color: var(--text);
  }
  /* 动作条：sticky 底 + 右对齐（ExpandPanel body 可滚时始终可达） */
  .actions {
    position: sticky;
    bottom: 0;
    display: flex;
    justify-content: flex-end;
    background: rgba(16, 19, 26, 0.94);
    padding: 4px 0 1px;
    margin-top: 2px;
  }
  .primary {
    background: rgba(196, 123, 58, 0.4);
    border: 1px solid var(--panel-border);
    border-radius: var(--r-2);
    color: inherit;
    padding: 3px 14px;
    cursor: pointer;
    font: inherit;
    font-size: var(--fs-sm);
  }
  .primary:hover {
    background: rgba(196, 123, 58, 0.55);
  }
</style>
