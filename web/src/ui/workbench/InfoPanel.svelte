<script lang="ts">
  import type { Region } from '../../core/types';

  let {
    region = null,
    onClose,
    onSave,
  }: {
    region?: Region | null;
    onClose: () => void;
    onSave: (patch: { name?: string; color?: string; description?: string }) => void;
  } = $props();

  let name = $state('');
  let color = $state('#888888');
  let description = $state('');

  $effect(() => {
    if (region) {
      name = region.name;
      color = region.color;
      description = String(region.attributes.description ?? '');
    }
  });
</script>

{#if region}
  <div class="info-panel">
    <div class="head">
      <strong>ℹ️ 元素信息</strong>
      <button type="button" onclick={onClose}>✕</button>
    </div>
    <label>
      名称
      <input bind:value={name} />
    </label>
    <label>
      颜色
      <input type="color" bind:value={color} />
    </label>
    <label>
      描述
      <textarea bind:value={description} rows="3"></textarea>
    </label>
    <p class="dim">地块 {region.cells.length} · 层 {region.layerId}</p>
    <div class="row">
      <button
        type="button"
        class="primary"
        onclick={() => onSave({ name: name.trim() || region.name, color, description })}
      >
        保存
      </button>
      <button type="button" onclick={onClose}>关闭</button>
    </div>
  </div>
{/if}

<style>
  .info-panel {
    position: fixed;
    right: 16px;
    top: 96px;
    z-index: 33;
    width: min(300px, calc(100vw - 32px));
    padding: 10px 12px;
    background: rgba(18, 20, 26, 0.94);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    font-size: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    color: var(--text-dim);
  }
  .row {
    display: flex;
    gap: 8px;
  }
  .dim {
    color: var(--text-dim);
  }
</style>
