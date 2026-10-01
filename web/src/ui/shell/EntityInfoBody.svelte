<script lang="ts">
  /**
   * 信息面板内容体（图层/元素共用，2026-10-01 用户定稿）：
   * **统一、紧凑**——只保留通用项（名称/颜色/描述/相邻/保存 + 调用方 extra 行）。
   * 外交（附庸/敌对/同盟）与专属色已删（画蛇添足，元素只做统一的东西）；
   * 不放解释性文字；无内嵌框（容器由 ExpandPanel 统一）。
   */
  let {
    name = '',
    basicColor = '',
    basicEditable = true,
    cellCount = 0,
    description = '',
    neighbors = [] as { id: string; name: string; color: string }[],
    extra = [] as { label: string; value: string }[],
    onSave,
  }: {
    name?: string;
    basicColor?: string;
    basicEditable?: boolean;
    cellCount?: number;
    description?: string;
    neighbors?: { id: string; name: string; color: string }[];
    extra?: { label: string; value: string }[];
    onSave?: (patch: { name?: string; color?: string; description?: string }) => void;
  } = $props();

  let editName = $state('');
  let editBasic = $state('');
  let editDesc = $state('');
  let editKey = $state('');

  // 目标切换（选中另一个元素/图层）时重置编辑副本
  $effect(() => {
    const key = `${name}|${basicColor}|${description}`;
    if (key !== editKey) {
      editKey = key;
      editName = name;
      editBasic = basicColor;
      editDesc = description;
    }
  });
</script>

<div class="body">
  <label class="field">
    <span>名称</span>
    <input value={editName} oninput={(e) => (editName = e.currentTarget.value)} />
  </label>

  <label class="field">
    <span>颜色</span>
    <input
      type="color"
      value={editBasic || '#888888'}
      disabled={!basicEditable}
      oninput={(e) => (editBasic = e.currentTarget.value)}
    />
  </label>

  <div class="ex-row"><span class="lb">地块</span><span>{cellCount}</span></div>

  <label class="field">
    <span>描述</span>
    <textarea rows="2" value={editDesc} oninput={(e) => (editDesc = e.currentTarget.value)}></textarea>
  </label>

  {#if extra.length}
    {#each extra as row (row.label)}
      <div class="ex-row"><span class="lb">{row.label}</span><span>{row.value}</span></div>
    {/each}
  {/if}

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

  <button
    type="button"
    class="primary"
    onclick={() => onSave?.({ name: editName, color: basicEditable ? editBasic : undefined, description: editDesc })}
  >
    保存
  </button>
</div>

<style>
  .body {
    font-size: 12px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-bottom: 5px;
    color: var(--text-dim);
    font-size: 11px;
  }
  .field input,
  .field textarea {
    color: var(--text);
  }
  .field input:disabled {
    opacity: 0.45;
  }
  .ex-row {
    display: flex;
    gap: 8px;
    font-size: 11px;
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
    gap: 4px 10px;
    min-width: 0;
  }
  .nb {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    flex: 0 0 auto;
  }
  .primary {
    width: 100%;
    margin-top: 3px;
    background: rgba(196, 123, 58, 0.4);
    border: 1px solid var(--panel-border);
    border-radius: 7px;
    color: inherit;
    padding: 4px;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
  }
</style>
