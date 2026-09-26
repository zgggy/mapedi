<script lang="ts">
  import { SOFT_MAX_DENSITY } from '../../core/world';
  import { PRESET_STYLES } from '../../core/styles';
  import { CASCADE_LABELS } from '../../core/generate/registry';
  import type { GenerationProfile } from '../../core/generate/profile';
  import type { ViewMode } from './shell';
  import type { EditorStore } from '../../app/store.svelte';

  type SettingsTab = 'generate' | 'view' | 'project';

  let {
    tab = 'generate',
    viewMode = 'view-2d',
    styleId = 'dark',
    reliefSmooth = 0.35,
    editor: ed,
    onTab,
    onStyle,
    onRelief,
    onGenerate,
    onSwitchView,
  }: {
    tab?: SettingsTab;
    viewMode?: ViewMode;
    styleId?: string;
    reliefSmooth?: number;
    editor: EditorStore;
    onTab?: (t: SettingsTab) => void;
    onStyle?: (s: string) => void;
    onRelief?: (v: number) => void;
    onGenerate: (seed: number, n: number) => void;
    onSwitchView: (m: ViewMode) => void;
  } = $props();

  function checkUnlock(n: number): number {
    if (n > SOFT_MAX_DENSITY && !ed.densityUnlocked) {
      const ok = window.confirm(`提高上限对性能影响较大，确定解锁 ${n}？`);
      if (ok) ed.densityUnlocked = true;
      else return SOFT_MAX_DENSITY;
    }
    return n;
  }

  function setParam(layerId: string, key: string, value: number) {
    ed.setProfileParam(layerId, key, value);
  }
</script>

<div class="tabs" role="tablist">
  <button type="button" class:active={tab === 'generate'} onclick={() => onTab?.('generate')}>生成</button>
  <button type="button" class:active={tab === 'view'} onclick={() => onTab?.('view')}>视图</button>
  <button type="button" class:active={tab === 'project'} onclick={() => onTab?.('project')}>项目</button>
</div>

{#if tab === 'generate'}
  <section>
    <h3>世界生成</h3>
    <label class="field">
      <span>种子</span>
      <input
        value={ed.seedInput}
        oninput={(e) => {
          ed.seedInput = e.currentTarget.value;
        }}
      />
    </label>
    <label class="field">
      <span>地块数</span>
      <input
        type="number"
        min="100"
        max="200000"
        value={ed.densityInput}
        onchange={(e) => {
          ed.densityInput = checkUnlock(Number(e.currentTarget.value) || ed.densityInput);
        }}
      />
    </label>
    <button
      type="button"
      class="primary"
      disabled={ed.generating}
      onclick={() => {
        const n = checkUnlock(ed.densityInput);
        ed.densityInput = n;
        onGenerate(Number(ed.seedInput) || 1, n);
      }}
    >
      🎲 重新生成
    </button>
    {#if ed.generating}
      <div class="prog">
        <div class="bar" style="width:{ed.genProgress}%"></div>
        <span>{ed.genStep} {ed.genProgress}%</span>
      </div>
    {/if}
    <button type="button" onclick={() => ed.runValidator()}>✅ 校验</button>
  </section>

  <section>
    <h3>分层生成参数</h3>
    {#each ed.profiles as p (p.layerId)}
      <details class="prof">
        <summary>
          <label class="chk">
            <input
              type="checkbox"
              checked={p.enabled}
              onchange={() => ed.toggleProfile(p.layerId)}
            />
            {CASCADE_LABELS[p.layerId] ?? p.layerId}
          </label>
          <button
            type="button"
            class="mini"
            onclick={(e) => {
              e.preventDefault();
              ed.regenLayer(p.layerId);
            }}
          >
            重算
          </button>
        </summary>
        <div class="params">
          {#each Object.entries(p.params) as [k, v] (k)}
            {#if typeof v === 'number'}
              <label class="field inline">
                <span>{k}</span>
                <input
                  type="number"
                  value={v}
                  step="any"
                  onchange={(e) => setParam(p.layerId, k, Number(e.currentTarget.value))}
                />
              </label>
            {/if}
          {/each}
          {#if !Object.keys(p.params).length}
            <p class="dim">无参数</p>
          {/if}
        </div>
      </details>
    {/each}
  </section>
{:else if tab === 'view'}
  <section>
    <h3>显示</h3>
    <div class="row">
      <button type="button" class:active={viewMode === 'view-2d'} onclick={() => onSwitchView('view-2d')}>
        🗺️ 平面
      </button>
      <button type="button" class:active={viewMode === 'view-globe'} onclick={() => onSwitchView('view-globe')}>
        🌐 球面
      </button>
    </div>
    <label class="field">
      <span>平滑 {reliefSmooth.toFixed(2)}</span>
      <input
        type="range"
        min="0"
        max="1"
        step="0.05"
        value={reliefSmooth}
        oninput={(e) => onRelief?.(Number(e.currentTarget.value))}
      />
    </label>
    <label class="field">
      <span>颜色风格</span>
      <select
        value={styleId}
        onchange={(e) => onStyle?.(e.currentTarget.value)}
      >
        {#each PRESET_STYLES as s (s.id)}
          <option value={s.id}>{s.name}</option>
        {/each}
      </select>
    </label>
  </section>

  {#if viewMode === 'view-globe'}
    <section>
      <h3>行星 · 星系（3D）</h3>
      <p class="dim">球面视图可显示自转轴、黄道面、倾角，以及恒星与卫星轨道。</p>
      {#if ed.astro}
        {@const a = ed.astro}
        <label class="field">
          <span>黄赤交角 {ed.climateDraft.axialTiltDeg.toFixed(1)}°</span>
          <input
            type="range"
            min="0"
            max="60"
            step="0.5"
            value={ed.climateDraft.axialTiltDeg}
            oninput={(e) => {
              ed.climateDraft = { ...ed.climateDraft, axialTiltDeg: Number(e.currentTarget.value) };
              ed.applyNature();
            }}
          />
        </label>
        <label class="field">
          <span>恒星名</span>
          <input
            value={a.star.name}
            oninput={(e) => ed.setStarAstro({ name: e.currentTarget.value })}
          />
        </label>
        <label class="field">
          <span>光度 {a.star.luminosity.toFixed(2)} L☉</span>
          <input
            type="range"
            min="0.2"
            max="3"
            step="0.05"
            value={a.star.luminosity}
            oninput={(e) => ed.setStarAstro({ luminosity: Number(e.currentTarget.value) })}
          />
        </label>
        <label class="field">
          <span>恒星温度 {a.star.temperatureK} K</span>
          <input
            type="range"
            min="3000"
            max="8000"
            step="50"
            value={a.star.temperatureK}
            oninput={(e) => ed.setStarAstro({ temperatureK: Number(e.currentTarget.value) })}
          />
        </label>
        <label class="field">
          <span>本星轨道半长轴 {a.home.orbit.semiMajor.toFixed(2)} AU</span>
          <input
            type="range"
            min="0.2"
            max="2.5"
            step="0.01"
            value={a.home.orbit.semiMajor}
            oninput={(e) => {
              const semiMajor = Number(e.currentTarget.value);
              const period = Math.pow(semiMajor, 1.5) / Math.sqrt(a.star.massSolar);
              ed.setHomeAstro({ orbit: { ...a.home.orbit, semiMajor, period } });
            }}
          />
        </label>
        <label class="field">
          <span>离心率 {a.home.orbit.eccentricity.toFixed(3)}</span>
          <input
            type="range"
            min="0"
            max="0.3"
            step="0.005"
            value={a.home.orbit.eccentricity}
            oninput={(e) =>
              ed.setHomeAstro({ orbit: { ...a.home.orbit, eccentricity: Number(e.currentTarget.value) } })}
          />
        </label>
        <label class="field">
          <span>卫星数 {a.home.moons.length}</span>
          <input
            type="number"
            min="0"
            max="8"
            value={a.home.moons.length}
            onchange={(e) => {
              const n = Math.max(0, Math.min(8, Number(e.currentTarget.value) || 0));
              const moons = [...a.home.moons];
              while (moons.length < n) {
                const i = moons.length;
                moons.push({
                  id: `moon-${i}`,
                  name: `卫星 ${i + 1}`,
                  radiusEarth: 0.25,
                  color: '#b8c0c8',
                  orbit: { semiMajor: 3 + i * 2, eccentricity: 0.03, inclinationDeg: 5 + i * 4, period: 3 + i * 7, phaseDeg: i * 90, nodeDeg: i * 30 },
                });
              }
              moons.length = n;
              ed.setHomeAstro({ moons });
            }}
          />
        </label>
        <p class="dim">
          同系统其它行星 {a.planets.length} 颗 ·
          半径 {a.home.radiusKm.toFixed(0)} km ·
          重力 {a.home.gravityG.toFixed(2)} g ·
          大气 {a.home.atmosphereAtm.toFixed(2)} atm
        </p>
      {:else}
        <p class="dim">生成世界后可编辑星系参数。</p>
      {/if}
    </section>
  {/if}
{:else}
  <section>
    <h3>项目</h3>
    <p class="dim">自动保存 {ed.autosaveAt || '…'}</p>
    <div class="grid">
      <button type="button" onclick={() => ed.exportProject?.()}>导出项目</button>
      <button type="button" onclick={() => ed.exportPng?.()}>导出 PNG</button>
      <button type="button" onclick={() => ed.exportSvg?.()}>导出 SVG</button>
      <button type="button" onclick={() => ed.exportGeoJson?.()}>导出 GeoJSON</button>
      <button type="button" onclick={() => ed.exportHeightmap?.()}>导出高程图</button>
      <label class="file">
        导入项目
        <input
          type="file"
          accept=".json,application/json"
          onchange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) ed.importProjectFile?.(f);
          }}
        />
      </label>
      <label class="file">
        导入高程图
        <input
          type="file"
          accept="image/*"
          onchange={(e) => {
            const f = e.currentTarget.files?.[0];
            if (f) ed.applyHeightmap(f);
          }}
        />
      </label>
      <button type="button" onclick={() => ed.clearAutosave()}>清缓存</button>
    </div>
    <label class="field">
      <span>搜索</span>
      <input bind:value={ed.searchQ} />
    </label>
    <button type="button" onclick={() => ed.runSearch()}>搜索</button>
    {#each ed.searchHits as hit (hit.id)}
      <button type="button" class="hit" onclick={() => ed.focusSearch(hit.id)}>
        {hit.name}
      </button>
    {/each}
    <button type="button" onclick={() => ed.toggleMeasure()}>
      📏 测距
    </button>
  </section>
{/if}

<style>
  .tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 14px;
  }
  .tabs button {
    flex: 1;
    padding: 8px;
    border-radius: 8px;
  }
  .tabs button.active {
    background: rgba(107, 124, 147, 0.4);
  }
  section {
    margin-bottom: 18px;
  }
  h3 {
    margin: 0 0 8px;
    font-size: 13px;
  }
  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-bottom: 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .field.inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }
  .row {
    display: flex;
    gap: 8px;
    margin-bottom: 10px;
  }
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
    margin: 8px 0;
  }
  .prof {
    border: 1px solid var(--panel-border);
    border-radius: 8px;
    padding: 6px 8px;
    margin-bottom: 6px;
  }
  summary {
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
  }
  .chk {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .params {
    padding: 8px 0 4px;
  }
  .mini {
    font-size: 11px;
    padding: 2px 6px;
  }
  .prog {
    margin: 8px 0;
    display: flex;
    gap: 8px;
    align-items: center;
    font-size: 11px;
    color: var(--text-dim);
  }
  .prog .bar {
    height: 6px;
    background: #3d9a6a;
    border-radius: 3px;
    flex: 1;
  }
  .file {
    cursor: pointer;
    text-align: center;
    padding: 8px;
    border-radius: 8px;
    border: 1px dashed var(--panel-border);
    font-size: 12px;
  }
  .file input {
    display: none;
  }
  .hit {
    display: block;
    width: 100%;
    text-align: left;
    margin: 4px 0;
  }
  .dim {
    color: var(--text-dim);
    font-size: 12px;
  }
</style>
