<script lang="ts">
  /**
   * 检查模式展开区（2026-09-30 三模式重构）：图层/元素的详情 + 显示参数，
   * 取代原 ElementInfoPanel / LayerInfoPanel / DisplayStylePanel 三个右键 popover
   * （重复入口已删，展开区 = 唯一驻留信息入口）。
   *
   * 数据直取 editor（Viewport/GlobeView 同款先例）；样式为**层级**属性（元素展开显示其所属层样式）。
   */
  import type { World } from '../../core/types';
  import { LAYER_META } from '../workbench/layerMeta';
  import { diplomacyBadge, enemiesOf, alliesOf, suzerainOf, setSuzerain, toggleEnemy, toggleAlly } from '../../core/diplomacy';
  import EntityInfoBody from './EntityInfoBody.svelte';
  import DisplayStylePanel from './DisplayStylePanel.svelte';
  import { editor } from '../../app/store.svelte';

  let {
    world,
    kind,
    id,
  }: {
    world: World | null;
    kind: 'layer' | 'element';
    /** layerId（kind=layer）或 regionId（kind=element）；null/空 = 不渲染 */
    id: string | null;
  } = $props();

  const region = $derived(
    kind === 'element' && id && world ? (world.regions.find((r) => r.id === id) ?? null) : null,
  );
  const layer = $derived(
    kind === 'layer' && id && world ? (world.layers.find((l) => l.id === id) ?? null) : null,
  );
  const styleLayerId = $derived(kind === 'element' ? (region?.layerId ?? '') : (id ?? ''));
  const layerMeta = $derived(
    kind === 'layer'
      ? ((LAYER_META[id ?? ''] ?? {
          emoji: '📄',
          name: layer?.name ?? id ?? '',
          kind: layer?.kind ?? '',
          category: 'custom',
        }) as { emoji: string; name: string; kind: string; category: string })
      : null,
  );

  // —— 元素组装（原 ElementInfoPanel 逻辑搬运）——
  const basicColor = $derived(() => {
    if (!region || !world) return '#888888';
    if (!region.parentId) return region.color;
    return world.regions.find((r) => r.id === region.parentId)?.color ?? region.color;
  });
  const basicEditable = $derived(region ? !region.parentId : true);
  const showDiplo = $derived(!!region && !region.parentId && region.layerId === 'country');
  const diploPeers = $derived(
    world && region
      ? world.regions
          .filter((r) => r.layerId === region.layerId && r.id !== region.id && !r.parentId)
          .map((r) => ({ id: r.id, name: r.name, color: r.color }))
      : [],
  );

  function neighborsOf(reg: NonNullable<typeof region>): { id: string; name: string; color: string }[] {
    if (!world?.sharedEdges) return [];
    const own = new Set(reg.cells);
    const ownerOfCell = new Map<number, string>();
    for (const r of world.regions) {
      for (const c of r.cells) if (!ownerOfCell.has(c)) ownerOfCell.set(c, r.id);
    }
    const hit = new Set<string>();
    for (const [key] of world.sharedEdges) {
      const [i, j] = key.split('-').map(Number);
      const aIn = own.has(i);
      const bIn = own.has(j);
      if (aIn === bIn) continue;
      const otherId = ownerOfCell.get(aIn ? j : i);
      if (otherId && otherId !== reg.id) hit.add(otherId);
    }
    return [...hit].slice(0, 20).map((id) => {
      const r = world!.regions.find((x) => x.id === id)!;
      return { id, name: r?.name ?? id, color: r?.color ?? '#666' };
    });
  }

  function saveElement(patch: {
    name?: string;
    color?: string;
    exclusiveColor?: string;
    description?: string;
  }) {
    if (!region) return;
    if (patch.name) region.name = patch.name;
    if (patch.color && !region.parentId) region.color = patch.color;
    if (patch.exclusiveColor !== undefined) region.exclusiveColor = patch.exclusiveColor || undefined;
    if (patch.description !== undefined)
      region.attributes = { ...region.attributes, description: patch.description };
    editor.touchRegions();
    editor.status = '已保存';
  }

  function catLabel(c: string) {
    return c === 'cell' ? '依赖地块' : c === 'free' ? '不依赖地块' : '自定义';
  }
</script>

<div class="ins">
  {#if kind === 'element' && region}
    <EntityInfoBody
      name={region.name}
      basicColor={basicColor()}
      exclusiveColor={region.exclusiveColor ?? ''}
      basicEditable={basicEditable}
      cellCount={region.cells.length}
      description={(region.attributes?.description as string) ?? ''}
      neighbors={neighborsOf(region)}
      extra={[
        { label: 'ID', value: region.id },
        { label: '子元素', value: String(world ? world.regions.filter((r) => r.parentId === region.id).length : 0) },
        ...(showDiplo
          ? [
              { label: '附庸', value: String(world ? world.regions.filter((r) => suzerainOf(r) === region.id).length : 0) },
              { label: '外交', value: diplomacyBadge(world!, region) ?? '—' },
            ]
          : []),
      ]}
      showDiplomacy={showDiplo}
      suzerainId={suzerainOf(region)}
      peers={diploPeers}
      enemyIds={enemiesOf(region)}
      allyIds={alliesOf(region)}
      onSetSuzerain={(sid) => {
        if (!world) return;
        if (!setSuzerain(world, region.id, sid)) {
          editor.status = '无法建立附庸（同层 / 禁止成环）';
          return;
        }
        editor.touchRegions();
        editor.status = sid ? '已设附庸' : '已解除附庸';
      }}
      onToggleEnemy={(oid) => {
        if (!world) return;
        toggleEnemy(world, region.id, oid);
        editor.touchRegions();
        editor.status = '已更新敌对关系';
      }}
      onToggleAlly={(oid) => {
        if (!world) return;
        toggleAlly(world, region.id, oid);
        editor.touchRegions();
        editor.status = '已更新同盟关系';
      }}
      onSave={saveElement}
    />
  {:else if kind === 'layer' && layer && layerMeta}
    <EntityInfoBody
      name={layer.name || layerMeta.name}
      basicColor="#6b7c93"
      exclusiveColor=""
      basicEditable={false}
      cellCount={world ? world.regions.filter((r) => r.layerId === id).length : 0}
      description={`${layerMeta.emoji} ${layerMeta.kind}`}
      neighbors={[]}
      extra={[
        { label: '分类', value: catLabel(layerMeta.category) },
        { label: 'ID', value: id ?? '' },
        {
          label: '子层',
          value: String(world ? world.layers.filter((l) => l.parentLayerId === id).length : 0),
        },
      ]}
      onSave={() => {
        editor.status = '图层信息只读（图层名由数据决定）';
        editor.notify();
      }}
    />
  {:else}
    <p class="dim">{kind === 'element' ? '尚未选中元素。' : '尚未聚焦图层。'}</p>
  {/if}

  {#if styleLayerId}
    <div class="sty">
      <div class="sty-hd">显示参数</div>
      <DisplayStylePanel
        embedded
        layerId={styleLayerId}
        layerName={world?.layers.find((l) => l.id === styleLayerId)?.name ?? styleLayerId}
        cfg={editor.layerStyleConfig(styleLayerId)}
        onChange={(patch) => editor.setLayerStyle(styleLayerId, patch)}
      />
    </div>
  {/if}
</div>

<style>
  .ins {
    font-size: 12px;
    user-select: none;
  }
  .sty {
    border-top: 1px solid var(--panel-border);
    margin-top: 4px;
  }
  .sty-hd {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.5px;
    padding: 6px 8px 0;
  }
  .dim {
    margin: 0;
    padding: 8px;
    color: var(--text-dim);
    font-size: 11px;
  }
</style>
