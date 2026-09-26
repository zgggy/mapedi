<script lang="ts">
  import type { ClimateParams, World } from '../../core/types';
  import { childrenOf } from '../../core/political';
  import { regionsOf } from '../../core/nature';
  import { unifiedGenerate } from '../../core/generate/unified';
  import { genConfigFromParams } from '../../core/layer';
  import { createRegion } from '../../core/regionOps';
  import { styleById } from '../../core/styles';
  import type { LayerMeta } from './layerMeta';
  import GenerationProfiles from './GenerationProfiles.svelte';
  import type { GenerationProfile } from '../../core/generate/profile';

  let {
    world,
    focusLayer,
    selectedRegionId = $bindable(null),
    climateDraft,
    styleId,
    meta,
    profiles = $bindable([]),
    annexPick = $bindable(false),
    newName = $bindable(''),
    onInfo,
    onPickColor,
    onStartDraw,
    onDeleteSelected,
    onAnnexPick,
    onCreateCountry,
    onCreateProvince,
    onUndo,
    onRegenNature,
    onRegenRoad,
    onRegenLayer,
    onRegenAll,
    onApplyPreset,
    onRandomName,
    onWorldChange,
  }: {
    world: World;
    focusLayer: string;
    selectedRegionId?: string | null;
    climateDraft: ClimateParams;
    styleId: string;
    meta: Record<string, LayerMeta>;
    profiles?: GenerationProfile[];
    annexPick?: boolean;
    newName?: string;
    onInfo: () => void;
    onPickColor: () => void;
    onStartDraw: (id: string) => void;
    onDeleteSelected: () => void;
    onAnnexPick: (id: string) => void;
    onCreateCountry: () => void;
    onCreateProvince: (parentId?: string) => void;
    onUndo: () => void;
    onRegenNature: () => void;
    onRegenRoad: () => void;
    onRegenLayer: (id: string) => void;
    onRegenAll: () => void;
    onApplyPreset?: (name: string) => void;
    onRandomName: (kind: string) => void;
    onWorldChange: () => void;
  } = $props();

  const countries = $derived(world.regions.filter((r) => r.layerId === 'country'));
  const unassignedProvinces = $derived(
    world.regions.filter((r) => r.layerId === 'province' && !r.parentId),
  );
</script>

{#if focusLayer === 'height'}
  <div class="wb-head">⛰️ 高度 · 场编辑</div>
  <p class="dim">顶部「重新生成」创建不规则大陆与河网。</p>
  <p class="dim">悬停读高度。大陆连通域：{world.regions.filter((r) => r.layerId === 'landsea' && r.attributes?.kind === 'continent').length}</p>
  <p class="dim">河段：{world.rivers.size}</p>
  <GenerationProfiles bind:profiles {onRegenLayer} {onRegenAll} {onApplyPreset} />
{:else if focusLayer === 'country'}
  <div class="wb-head">👑 国家 · 嵌套盒 · {countries.length}</div>
  <div class="hint dim">国家一行，行省嵌在盒内（非折叠树）。</div>
  {#each countries as country (country.id)}
    <div class="country-box" class:sel={selectedRegionId === country.id}>
      <button
        type="button"
        class="country-row"
        onclick={() => (selectedRegionId = selectedRegionId === country.id ? null : country.id)}
      >
        <span class="swatch" style="background:{country.color}"></span>
        <span class="name">{country.name}</span>
        <span class="dim">{country.cells.length}c</span>
        {#if country.centerCellId !== undefined}<span title="首都">📍</span>{/if}
      </button>
      {#if selectedRegionId === country.id}
        <div class="actions">
          <button type="button" onclick={onInfo}>ℹ️ 信息</button>
          <button type="button" onclick={onPickColor}>🎨 颜色</button>
          <button type="button" onclick={() => onStartDraw(country.id)}>🖌️ 绘制</button>
          <button type="button" onclick={onDeleteSelected}>🗑️ 删除</button>
          <button type="button" onclick={() => (annexPick = !annexPick)}>🤝 吞并</button>
        </div>
        {#if annexPick}
          <div class="annex-pick dim">点选另一国家以完成吞并…</div>
        {/if}
      {/if}
      {#if annexPick && selectedRegionId && selectedRegionId !== country.id}
        <button type="button" class="annex-target" onclick={() => onAnnexPick(country.id)}>
          吞并 → {country.name}
        </button>
      {/if}
      <div class="province-inner">
        <div class="inner-label">🏛️ 行省</div>
        {#each childrenOf(world, country.id) as prov (prov.id)}
          <div class="province-row">
            <span class="name">{prov.name}</span>
            <span class="dim">{prov.cells.length}c</span>
            <span>📍</span>
          </div>
        {/each}
        <div class="add-row">
          <button type="button" onclick={() => onCreateProvince(country.id)}>➕ 行省</button>
          <button
            type="button"
            onclick={() => {
              onRandomName('province');
              onCreateProvince(country.id);
            }}>🎲</button
          >
        </div>
      </div>
    </div>
  {/each}
  {#if unassignedProvinces.length}
    <div class="country-box unassigned">
      <div class="country-row">未分配行省</div>
      {#each unassignedProvinces as prov (prov.id)}
        <div class="province-row">{prov.name} {prov.cells.length}c</div>
      {/each}
    </div>
  {/if}
  <div class="create">
    <label>
      名称
      <input bind:value={newName} />
    </label>
    <button type="button" onclick={() => onRandomName('country')}>🎲</button>
    <div class="row">
      <button type="button" onclick={onCreateCountry}>➕ 新增</button>
      <button type="button" class="primary" onclick={onCreateCountry}>🖌️ 直接绘制</button>
    </div>
    <div class="row">
      <button type="button" onclick={onUndo}>↩️ 撤销</button>
    </div>
  </div>
{:else if focusLayer === 'province'}
  <div class="wb-head">🏛️ 行省 · 平铺列表</div>
  {#each world.regions.filter((r) => r.layerId === 'province') as prov (prov.id)}
    <div class="province-row">
      <span class="name">{prov.name}</span>
      <span class="dim">
        {world.regions.find((c) => c.id === prov.parentId)?.name ?? '未分配'}
      </span>
      <span class="dim">{prov.cells.length}c</span>
    </div>
  {/each}
{:else if focusLayer === 'environment'}
  <div class="wb-head">🌍 环境 · 群系</div>
  <div class="climate-box">
    <div class="inner-label">行星参数</div>
    <label>
      黄赤交角 {climateDraft.axialTiltDeg.toFixed(1)}°
      <input type="range" min="0" max="45" step="0.1" bind:value={climateDraft.axialTiltDeg} />
    </label>
    <label>
      自转 {climateDraft.rotationHours.toFixed(0)}h
      <input type="range" min="6" max="48" step="1" bind:value={climateDraft.rotationHours} />
    </label>
    <label class="row-inline">
      <input type="checkbox" bind:checked={climateDraft.rotationPrograde} />
      顺行自转
    </label>
    <label>
      含氧量 {climateDraft.oxygenLevel.toFixed(2)}
      <input type="range" min="0.5" max="1.5" step="0.01" bind:value={climateDraft.oxygenLevel} />
    </label>
    <label>
      基准温 {climateDraft.baseTemperatureC.toFixed(0)}℃
      <input type="range" min="-10" max="40" step="1" bind:value={climateDraft.baseTemperatureC} />
    </label>
    <button type="button" class="primary" onclick={onRegenNature}>⚙️ 按参数重算群系/生物</button>
  </div>
  <div class="inner-label">群系列表</div>
  {#each regionsOf(world, 'environment') as env (env.id)}
    <div class="province-row" class:sel={selectedRegionId === env.id}>
      <span>{(env.attributes.emoji as string) ?? '🌍'}</span>
      <button type="button" class="name" onclick={() => (selectedRegionId = env.id)}>
        {env.name}
      </button>
      <span class="dim">{env.cells.length}c</span>
    </div>
  {/each}
{:else if focusLayer === 'vegetation' || focusLayer === 'fauna' || focusLayer === 'race'}
  <div class="wb-head">
    {meta[focusLayer]?.emoji}
    {meta[focusLayer]?.name}
    · {regionsOf(world, focusLayer).length}
  </div>
  <p class="dim">由群系+气候派生；点选可高亮，可手绘增删。</p>
  {#each regionsOf(world, focusLayer) as nr (nr.id)}
    <div class="country-box" class:sel={selectedRegionId === nr.id}>
      <button type="button" class="country-row" onclick={() => (selectedRegionId = nr.id)}>
        <span class="swatch" style="background:{nr.color}"></span>
        <span class="name">{nr.name}</span>
        <span class="dim">{nr.cells.length}c</span>
        {#if nr.centerCellId !== undefined}<span>📍</span>{/if}
      </button>
      {#if selectedRegionId === nr.id}
        <div class="actions">
          <button type="button" onclick={() => onStartDraw(nr.id)}>🖌️ 绘制</button>
          <button type="button" onclick={onInfo}>ℹ️ 信息</button>
          <button type="button" onclick={onDeleteSelected}>🗑️ 删除</button>
        </div>
      {/if}
    </div>
  {/each}
{:else if focusLayer === 'culture' || focusLayer === 'religion'}
  <div class="wb-head">
    {meta[focusLayer]?.emoji}
    {meta[focusLayer]?.name}
    · {regionsOf(world, focusLayer).length}
  </div>
  <p class="dim">成本场扩张；重叠处画平行条带。</p>
  <p class="dim">颜色集：{styleById(styleId).name}</p>
  {#each regionsOf(world, focusLayer) as cr (cr.id)}
    <div class="country-box" class:sel={selectedRegionId === cr.id}>
      <button type="button" class="country-row" onclick={() => (selectedRegionId = cr.id)}>
        <span class="swatch" style="background:{cr.color}"></span>
        <span class="name">{cr.name}</span>
        <span class="dim">{cr.cells.length}c</span>
        {#if cr.centerCellId !== undefined}<span>📍</span>{/if}
      </button>
      {#if selectedRegionId === cr.id}
        <div class="actions">
          <button type="button" onclick={() => onStartDraw(cr.id)}>🖌️ 绘制</button>
          <button type="button" onclick={onInfo}>ℹ️ 信息</button>
          <button type="button" onclick={onDeleteSelected}>🗑️ 删除</button>
        </div>
      {/if}
    </div>
  {/each}
  <div class="create">
    <div class="row">
      <button
        type="button"
        onclick={() => {
          const layerId = focusLayer === 'culture' ? 'culture' : 'religion';
          unifiedGenerate(world, layerId, genConfigFromParams(layerId, world.meta.seed));
          onWorldChange();
        }}
      >
        ⚙️ 重新生成本层
      </button>
    </div>
  </div>
{:else if focusLayer === 'road' || focusLayer === 'route'}
  <div class="wb-head">{meta[focusLayer]?.emoji} {meta[focusLayer]?.name}</div>
  <p class="dim">左键加相邻地块；拖黄点端点可微调；拖出多边形则改归属。</p>
  {#each world.regions.filter((r) => r.layerId === focusLayer) as road (road.id)}
    <div class="country-box" class:sel={selectedRegionId === road.id}>
      <button type="button" class="country-row" onclick={() => (selectedRegionId = road.id)}>
        <span class="name">{road.name}</span>
        <span class="dim">{road.cells.length}c</span>
      </button>
      <div class="actions">
        <button type="button" onclick={() => onStartDraw(road.id)}>🖌️ 绘制</button>
        <button type="button" onclick={onDeleteSelected}>🗑️ 删除</button>
      </div>
    </div>
  {/each}
  <div class="create">
    <div class="row">
      <button
        type="button"
        class="primary"
        onclick={() => {
          const id = `${focusLayer}-${Date.now().toString(36)}`;
          createRegion(world, {
            id,
            layerId: focusLayer,
            name: focusLayer === 'road' ? '新道路' : '新航线',
            cells: [],
            color: '#e8c46a',
            attributes: {},
          });
          onWorldChange();
          onStartDraw(id);
        }}
      >
        ➕ 新建并绘制
      </button>
    </div>
    <div class="row">
      <button type="button" onclick={onRegenRoad}>⚙️ 重新生成路网</button>
    </div>
  </div>
{:else}
  <div class="wb-head">{meta[focusLayer]?.emoji} {meta[focusLayer]?.name}</div>
  {#if meta[focusLayer]?.pending}
    <p class="dim">该层工作台将在后续阶段接入生成与绘制。</p>
  {:else}
    <p class="dim">可观察高度底图与各语义层。</p>
  {/if}
{/if}

<style>
  .wb-head {
    font-weight: 600;
    margin-bottom: 8px;
  }
  .dim {
    color: var(--text-dim);
  }
  .hint {
    margin-bottom: 8px;
  }
  .country-box {
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    margin-bottom: 8px;
    padding: 6px;
    background: rgba(0, 0, 0, 0.25);
  }
  .country-box.sel {
    border-color: rgba(240, 195, 106, 0.55);
  }
  .country-box.unassigned {
    border-style: dashed;
  }
  .country-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    background: transparent;
    border: none;
    padding: 6px 4px;
  }
  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 3px;
  }
  .name {
    flex: 1;
    text-align: left;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 4px 8px 8px;
  }
  .province-inner {
    margin: 4px 2px 2px 14px;
    padding: 4px 6px;
    border-left: 2px solid rgba(255, 255, 255, 0.08);
  }
  .inner-label {
    font-size: 11px;
    color: var(--text-dim);
    margin-bottom: 4px;
  }
  .province-row {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 2px;
    font-size: 12px;
  }
  .province-row.sel {
    background: rgba(240, 195, 106, 0.15);
  }
  .province-row .name {
    background: transparent;
    border: none;
    cursor: pointer;
  }
  .add-row {
    padding: 4px 2px;
  }
  .create {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 1px dashed var(--panel-border);
  }
  .create label {
    display: flex;
    gap: 6px;
    align-items: center;
    margin-bottom: 6px;
  }
  .create input {
    flex: 1;
  }
  .create .row {
    display: flex;
    gap: 8px;
    margin-top: 6px;
  }
  .climate-box {
    margin-bottom: 12px;
    padding: 8px;
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    background: rgba(0, 0, 0, 0.2);
  }
  .climate-box label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .climate-box label.row-inline {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }
  .climate-box input[type='range'] {
    width: 100%;
  }
  .annex-pick,
  .annex-target {
    margin: 0 8px 6px;
    font-size: 12px;
  }
  .annex-target {
    display: block;
    width: calc(100% - 16px);
  }
</style>
