<script lang="ts">
  /**
   * 图层信息面板：跟随焦点图层，PanelShell 壳（Dock 可收起/展开）。
   * 图层信息目前只读（图层名/分类由元数据决定）。
   */
  import type { World } from '../../core/types';
  import { LAYER_META } from '../workbench/layerMeta';
  import PanelShell from './PanelShell.svelte';
  import EntityInfoBody from './EntityInfoBody.svelte';

  let {
    world,
    layerId = null,
    open = true,
    onCollapse,
    x = 250,
    y = 56,
    onNotice,
  }: {
    world: World | null;
    layerId?: string | null;
    open?: boolean;
    onCollapse?: () => void;
    x?: number;
    y?: number;
    onNotice?: (msg: string) => void;
  } = $props();

  type Meta = { emoji: string; name: string; kind: string; category: string };

  const layer = $derived(
    layerId && world ? (world.layers.find((l) => l.id === layerId) ?? null) : null,
  );
  const meta = $derived(
    layerId
      ? ((LAYER_META[layerId] ?? {
          emoji: '📄',
          name: layer?.name ?? layerId,
          kind: layer?.kind ?? '',
          category: 'custom',
        }) as Meta)
      : null,
  );

  function catLabel(c: string) {
    return c === 'cell' ? '依赖地块' : c === 'free' ? '不依赖地块' : '自定义';
  }
</script>

<PanelShell title="图层信息" icon="ℹ" {open} side="float" width={280} {x} {y} maxHeight="calc(100vh - 120px)" onCollapse={onCollapse}>
  {#if !layer || !meta}
    <p class="dim">尚未选中图层。在图层面板点选一个图层查看信息。</p>
  {:else}
    <EntityInfoBody
      name={layer.name || meta.name}
      basicColor="#6b7c93"
      exclusiveColor=""
      basicEditable={false}
      cellCount={world ? world.regions.filter((r) => r.layerId === layerId).length : 0}
      description={`${meta.emoji} ${meta.kind}`}
      neighbors={[]}
      extra={[
        { label: '分类', value: catLabel(meta.category) },
        { label: 'ID', value: layerId ?? '' },
        {
          label: '子层',
          value: String(world ? world.layers.filter((l) => l.parentLayerId === layerId).length : 0),
        },
      ]}
      onSave={() => onNotice?.('图层信息只读（图层名由数据决定）')}
    />
  {/if}
</PanelShell>

<style>
  .dim {
    margin: 0;
    padding: 12px;
    color: var(--text-dim);
    font-size: 11px;
  }
</style>
