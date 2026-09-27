<script lang="ts">
  /**
   * 元素信息面板：跟随工作区选中元素，PanelShell 壳（Dock 可收起/展开）。
   * 外交（附庸/敌对/同盟）仅同层顶层元素可编辑。
   */
  import type { Region, World } from '../../core/types';
  import { LAYER_META } from '../workbench/layerMeta';
  import { diplomacyBadge, enemiesOf, alliesOf, suzerainOf } from '../../core/diplomacy';
  import PanelShell from './PanelShell.svelte';
  import EntityInfoBody from './EntityInfoBody.svelte';

  let {
    world,
    regionId = null,
    open = true,
    onCollapse,
    x = 250,
    y = 56,
    onSaveInfo,
    onSetSuzerain,
    onToggleEnemy,
    onToggleAlly,
  }: {
    world: World | null;
    regionId?: string | null;
    open?: boolean;
    onCollapse?: () => void;
    x?: number;
    y?: number;
    onSaveInfo?: (id: string, patch: {
      name?: string;
      color?: string;
      exclusiveColor?: string;
      description?: string;
    }) => void;
    onSetSuzerain?: (vassalId: string, suzerainId: string | null) => void;
    onToggleEnemy?: (aId: string, bId: string) => void;
    onToggleAlly?: (aId: string, bId: string) => void;
  } = $props();

  const region = $derived(
    regionId && world ? (world.regions.find((r) => r.id === regionId) ?? null) : null,
  );
  const meta = $derived(region ? LAYER_META[region.layerId] : null);
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

  function neighborsOf(reg: Region): { id: string; name: string; color: string }[] {
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
  const infoNeighbors = $derived(region ? neighborsOf(region) : []);
  const title = $derived(
    region ? `${meta?.emoji ?? ''} ${meta?.name ?? ''} · 元素` : '元素信息',
  );
</script>

<PanelShell {title} icon="📝" {open} side="float" width={280} {x} {y} maxHeight="calc(100vh - 120px)" onCollapse={onCollapse}>
  {#if !region}
    <p class="dim">尚未选中元素。在工作区点选一个元素查看信息。</p>
  {:else}
    <EntityInfoBody
      name={region.name}
      basicColor={basicColor()}
      exclusiveColor={region.exclusiveColor ?? ''}
      basicEditable={basicEditable}
      cellCount={region.cells.length}
      description={(region.attributes?.description as string) ?? ''}
      neighbors={infoNeighbors}
      extra={[
        { label: 'ID', value: region.id },
        {
          label: '子元素',
          value: String(world ? world.regions.filter((r) => r.parentId === region.id).length : 0),
        },
        ...(showDiplo
          ? [
              {
                label: '附庸',
                value: String(
                  world ? world.regions.filter((r) => suzerainOf(r) === region.id).length : 0,
                ),
              },
              {
                label: '外交',
                value: diplomacyBadge(world!, region) ?? '—',
              },
            ]
          : []),
      ]}
      showDiplomacy={showDiplo}
      suzerainId={suzerainOf(region)}
      peers={diploPeers}
      enemyIds={enemiesOf(region)}
      allyIds={alliesOf(region)}
      onSetSuzerain={(sid) => onSetSuzerain?.(region.id, sid)}
      onToggleEnemy={(oid) => onToggleEnemy?.(region.id, oid)}
      onToggleAlly={(oid) => onToggleAlly?.(region.id, oid)}
      onSave={(patch) => onSaveInfo?.(region.id, patch)}
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
