<script lang="ts">
  import type { GenerationProfile } from '../../core/generate/profile';
  import { CASCADE_LABELS } from '../../core/generate/registry';

  let {
    profiles = $bindable([]),
    onRegenLayer,
    onRegenAll,
    onApplyPreset,
  }: {
    profiles?: GenerationProfile[];
    onRegenLayer: (id: string) => void;
    onRegenAll: () => void;
    onApplyPreset?: (name: string) => void;
  } = $props();

  const PRESETS = ['默认大陆', '群岛', '海国世界', '高原世界'] as const;
  let showAdvanced = $state(false);
</script>

<div class="profiles">
  <div class="head">
    ⚙️ 生成参数
    <button type="button" onclick={onRegenAll}>级联重生成</button>
  </div>
  <div class="presets">
    {#each PRESETS as name (name)}
      <button type="button" class="mini" onclick={() => onApplyPreset?.(name)}>{name}</button>
    {/each}
    <button type="button" class="mini" onclick={() => (showAdvanced = !showAdvanced)}>
      {showAdvanced ? '精简' : '全部参数'}
    </button>
  </div>
  {#each profiles as p (p.layerId)}    <details>
      <summary>
        <label class="chk">
          <input
            type="checkbox"
            checked={p.enabled}
            onchange={() => {
              p.enabled = !p.enabled;
              profiles = [...profiles];
            }}
          />
          {CASCADE_LABELS[p.layerId] ?? p.layerId}
        </label>
        <button
          type="button"
          class="mini"
          onclick={(e) => {
            e.preventDefault();
            onRegenLayer(p.layerId);
          }}
        >
          重生成
        </button>
      </summary>
      {#if Object.keys(p.params).length}
        <div class="params">
          {#each Object.entries(p.params) as [k, v] (k)}
            {#if typeof v === 'number'}
              <label>
                {k}
                <input
                  type="number"
                  value={v}
                  step="any"
                  onchange={(e) => {
                    p.params = { ...p.params, [k]: Number(e.currentTarget.value) };
                    profiles = [...profiles];
                  }}
                />
              </label>
            {:else if typeof v === 'boolean'}
              <label class="chk">
                <input
                  type="checkbox"
                  checked={v}
                  onchange={(e) => {
                    p.params = { ...p.params, [k]: e.currentTarget.checked };
                    profiles = [...profiles];
                  }}
                />
                {k === 'allowOcean' ? '允许海国/海上元素' : k}
              </label>
            {:else}
              <label>
                {k}
                <input
                  type="text"
                  value={String(v)}
                  onchange={(e) => {
                    p.params = { ...p.params, [k]: e.currentTarget.value };
                    profiles = [...profiles];
                  }}
                />
              </label>
            {/if}
          {/each}
        </div>
      {:else}
        <p class="dim">无参数</p>
      {/if}
    </details>
  {/each}
</div>

<style>
  .profiles {
    margin-top: 12px;
    padding-top: 8px;
    border-top: 1px dashed var(--panel-border);
    font-size: 12px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-weight: 600;
    margin-bottom: 6px;
  }
  summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    padding: 4px 0;
  }
  .params {
    display: grid;
    gap: 6px;
    padding: 4px 0 8px 8px;
  }
  .params label {
    display: flex;
    justify-content: space-between;
    gap: 8px;
    color: var(--text-dim);
  }
  .params input {
    width: 90px;
  }
  .chk {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .mini {
    font-size: 11px;
    padding: 2px 6px;
  }
  .dim {
    color: var(--text-dim);
  }
</style>
