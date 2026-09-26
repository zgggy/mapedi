<script lang="ts">
  /**
   * 居中信息弹窗（图层 / 工作区元素共用）。
   * 基本色与主元素一致；子元素不可改基本色。专属色 = 边框内阴影。
   * 外交（附庸/敌对/同盟）仅同层主元素可编辑，改动即时回调。
   */
  let {
    open = false,
    title = '信息',
    name = '',
    basicColor = '',
    exclusiveColor = '',
    basicEditable = true,
    cellCount = 0,
    description = '',
    neighbors = [] as { id: string; name: string; color: string }[],
    extra = [] as { label: string; value: string }[],
    readonlyCount = true,
    showDiplomacy = false,
    suzerainId = null as string | null,
    peers = [] as { id: string; name: string; color: string }[],
    enemyIds = [] as string[],
    allyIds = [] as string[],
    onClose,
    onSave,
    onSetSuzerain,
    onToggleEnemy,
    onToggleAlly,
  }: {
    open?: boolean;
    title?: string;
    name?: string;
    basicColor?: string;
    exclusiveColor?: string;
    basicEditable?: boolean;
    cellCount?: number;
    description?: string;
    neighbors?: { id: string; name: string; color: string }[];
    extra?: { label: string; value: string }[];
    readonlyCount?: boolean;
    showDiplomacy?: boolean;
    suzerainId?: string | null;
    peers?: { id: string; name: string; color: string }[];
    enemyIds?: string[];
    allyIds?: string[];
    onClose?: () => void;
    onSave?: (patch: {
      name?: string;
      color?: string;
      exclusiveColor?: string;
      description?: string;
    }) => void;
    onSetSuzerain?: (id: string | null) => void;
    onToggleEnemy?: (id: string) => void;
    onToggleAlly?: (id: string) => void;
  } = $props();

  let editName = $state('');
  let editBasic = $state('');
  let editExcl = $state('');
  let editDesc = $state('');
  let editSuz = $state('');

  $effect(() => {
    if (open) {
      editName = name;
      editBasic = basicColor;
      editExcl = exclusiveColor;
      editDesc = description;
      editSuz = suzerainId ?? '';
    }
  });

  function peerById(id: string) {
    return peers.find((p) => p.id === id);
  }
</script>

{#if open}
  <div class="backdrop" role="presentation" onclick={() => onClose?.()}>
    <div
      class="modal"
      role="dialog"
      aria-label={title}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === 'Escape' && onClose?.()}
    >
      <div class="hd">
        <span>{title}</span>
        <button type="button" class="ghost" title="关闭" onclick={() => onClose?.()}>✕</button>
      </div>

      <label class="field">
        <span>名称</span>
        <input value={editName} oninput={(e) => (editName = e.currentTarget.value)} />
      </label>

      <div class="field-row">
        <label class="field">
          <span>基本颜色</span>
          <input
            type="color"
            value={editBasic || '#888888'}
            disabled={!basicEditable}
            title={basicEditable ? '与主元素一致' : '子元素不可单独修改基本色'}
            oninput={(e) => (editBasic = e.currentTarget.value)}
          />
        </label>
        <label class="field">
          <span>专属颜色</span>
          <input
            type="color"
            value={editExcl || '#000000'}
            oninput={(e) => (editExcl = e.currentTarget.value)}
          />
        </label>
      </div>
      <p class="hint">专属色用于边框内阴影，仅作用于本元素。</p>
      {#if !basicEditable}
        <p class="hint">基本色跟随主元素，请在主元素上修改。</p>
      {/if}

      <label class="field">
        <span>占据地块</span>
        <input type="number" value={cellCount} readonly={readonlyCount} />
      </label>

      <label class="field">
        <span>描述</span>
        <textarea rows="3" value={editDesc} oninput={(e) => (editDesc = e.currentTarget.value)}></textarea>
      </label>

      {#if showDiplomacy && peers.length}
        <div class="diplo">
          <label class="field">
            <span>宗主国（附庸于）</span>
            <select
              value={editSuz}
              onchange={(e) => {
                const v = e.currentTarget.value || null;
                editSuz = v ?? '';
                onSetSuzerain?.(v);
              }}
            >
              <option value="">— 独立 —</option>
              {#each peers as p (p.id)}
                <option value={p.id}>{p.name}</option>
              {/each}
            </select>
          </label>
          <div class="field">
            <span>同层外交</span>
            <ul class="diplo-list">
              {#each peers as p (p.id)}
                <li>
                  <span class="dot" style="background:{p.color}"></span>
                  <span class="pn">{p.name}</span>
                  <button
                    type="button"
                    class="chip"
                    class:on={enemyIds.includes(p.id)}
                    title="敌对"
                    onclick={() => onToggleEnemy?.(p.id)}
                  >敌对</button>
                  <button
                    type="button"
                    class="chip"
                    class:on={allyIds.includes(p.id)}
                    title="同盟"
                    onclick={() => onToggleAlly?.(p.id)}
                  >同盟</button>
                </li>
              {/each}
            </ul>
            {#if suzerainId && peerById(suzerainId)}
              <p class="hint">当前附庸于「{peerById(suzerainId)?.name}」</p>
            {/if}
          </div>
        </div>
      {/if}

      {#if extra.length}
        <div class="extra">
          {#each extra as row (row.label)}
            <div class="ex-row"><span class="lb">{row.label}</span><span>{row.value}</span></div>
          {/each}
        </div>
      {/if}

      {#if neighbors.length}
        <div class="field">
          <span>相邻元素</span>
          <ul class="nbr">
            {#each neighbors as n (n.id)}
              <li>
                <span class="dot" style="background:{n.color}"></span>
                <span>{n.name}</span>
              </li>
            {/each}
          </ul>
        </div>
      {:else}
        <div class="field"><span>相邻元素</span><div class="hint">无</div></div>
      {/if}

      <button
        type="button"
        class="primary"
        onclick={() =>
          onSave?.({
            name: editName,
            color: basicEditable ? editBasic : undefined,
            exclusiveColor: editExcl,
            description: editDesc,
          })}
      >
        保存
      </button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 80;
    background: rgba(0, 0, 0, 0.45);
    display: grid;
    place-items: center;
  }
  .modal {
    width: min(360px, calc(100vw - 40px));
    max-height: min(80vh, 640px);
    overflow: auto;
    background: rgba(18, 20, 26, 0.96);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    padding: 14px;
    font-size: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  }
  .hd {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 10px;
    font-weight: 600;
    font-size: 13px;
  }
  .ghost {
    background: transparent;
    border: none;
    color: var(--text-dim);
    cursor: pointer;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
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
  .field-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .hint {
    margin: 0 0 8px;
    font-size: 10px;
    color: var(--text-dim);
  }
  .extra {
    margin-bottom: 8px;
  }
  .ex-row {
    display: flex;
    gap: 8px;
    font-size: 11px;
    margin-bottom: 2px;
  }
  .ex-row .lb {
    color: var(--text-dim);
    min-width: 4em;
  }
  .nbr {
    list-style: none;
    margin: 0;
    padding: 0;
    max-height: 120px;
    overflow: auto;
  }
  .nbr li {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 22px;
  }
  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .primary {
    width: 100%;
    margin-top: 4px;
    background: rgba(196, 123, 58, 0.4);
  }
  .diplo {
    margin-bottom: 8px;
    padding-top: 4px;
    border-top: 1px solid var(--panel-border);
  }
  .diplo select {
    color: var(--text);
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid var(--panel-border);
    border-radius: 6px;
    padding: 4px 6px;
  }
  .diplo-list {
    list-style: none;
    margin: 4px 0 0;
    padding: 0;
    max-height: 140px;
    overflow: auto;
  }
  .diplo-list li {
    display: flex;
    align-items: center;
    gap: 6px;
    min-height: 26px;
  }
  .diplo-list .pn {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip {
    border: 1px solid var(--panel-border);
    background: transparent;
    color: var(--text-dim);
    border-radius: 999px;
    padding: 2px 8px;
    font-size: 10px;
    cursor: pointer;
  }
  .chip.on {
    color: var(--text);
    border-color: rgba(240, 195, 106, 0.7);
    background: rgba(240, 195, 106, 0.15);
  }
</style>
