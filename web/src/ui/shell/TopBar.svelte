<script lang="ts">
  /**
   * 顶栏（设计稿 §2）：三组悬浮件——模式胶囊（居中）· 世界名菜单 · ⚙ 视图设置。
   * 常驻、不随面板开合变化；所有弹出层挂 body 级（§4 portal），不被面板 overflow 截断。
   */
  import ModeCapsule from './ModeCapsule.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import ViewSettingsPopover from './ViewSettingsPopover.svelte';
  import type { ViewMode } from './shell';

  let {
    viewMode = 'view-globe',
    onSwitchView,
    worldName = '未命名世界',
    autosaveAt = '',
    onExport,
    onImport,
    onClearCache,
    onRename,
    projection = 'robinson',
    onProjection,
    styleId = 'dark',
    onStyle,
    globeShowAxis = true,
    globeShowEcliptic = true,
    globeSpin = false,
    globeTilt = 23.4,
    globeRotHours = 24,
    onGlobeShowAxis,
    onGlobeShowEcliptic,
    onGlobeSpin,
    onGlobeTilt,
    onGlobeRotHours,
  }: {
    viewMode?: ViewMode;
    onSwitchView: (m: ViewMode) => void;
    worldName?: string;
    autosaveAt?: string;
    onExport: (kind: 'json' | 'gz' | 'png' | 'svg') => void;
    onImport: (kind: string, file: File) => void;
    onClearCache: () => void;
    onRename: (name: string) => void;
    projection?: string;
    onProjection?: (p: string) => void;
    styleId?: string;
    onStyle?: (s: string) => void;
    globeShowAxis?: boolean;
    globeShowEcliptic?: boolean;
    globeSpin?: boolean;
    globeTilt?: number;
    globeRotHours?: number;
    onGlobeShowAxis?: (v: boolean) => void;
    onGlobeShowEcliptic?: (v: boolean) => void;
    onGlobeSpin?: (v: boolean) => void;
    onGlobeTilt?: (v: number) => void;
    onGlobeRotHours?: (v: number) => void;
  } = $props();

  // —— 世界名：单击开菜单 / 双击改名（D2）——
  // 双击 = 两次 click + dblclick：用短延迟区分，避免菜单闪一下又关。
  let menuPos = $state<{ x: number; y: number } | null>(null);
  let gearOpen = $state(false);
  let renaming = $state(false);
  let draft = $state('');
  let nameBtn: HTMLButtonElement | undefined = $state();
  let fileInput: HTMLInputElement | undefined = $state();
  let clickTimer: ReturnType<typeof setTimeout> | null = null;

  function onNameClick() {
    if (renaming) return;
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
      return; // 双击的第二次 click：不排队菜单
    }
    clickTimer = setTimeout(() => {
      clickTimer = null;
      const r = nameBtn?.getBoundingClientRect();
      if (!r) return;
      gearOpen = false;
      menuPos = { x: Math.min(r.left, window.innerWidth - 240), y: r.bottom + 6 };
    }, 180);
  }
  function onNameDblClick() {
    if (clickTimer) {
      clearTimeout(clickTimer);
      clickTimer = null;
    }
    menuPos = null;
    gearOpen = false;
    draft = worldName;
    renaming = true;
    queueMicrotask(() => {
      document.getElementById('world-name-input')?.focus();
      (document.getElementById('world-name-input') as HTMLInputElement | null)?.select();
    });
  }
  function commitRename() {
    if (!renaming) return;
    renaming = false;
    const v = draft.trim();
    if (v && v !== worldName) onRename(v);
  }
  function cancelRename() {
    renaming = false;
    draft = worldName;
  }

  const menuItems = $derived<MenuItem[]>([
    ...(autosaveAt ? [{ id: 'autosave', label: `自动保存 ${autosaveAt}`, disabled: true }] : []),
    { id: 'json', label: '导出 .mapedi.json', action: () => onExport('json') },
    { id: 'gz', label: '导出 .mapedi.json.gz', action: () => onExport('gz') },
    { id: 'png', label: '导出 PNG', action: () => onExport('png') },
    { id: 'svg', label: '导出 SVG', action: () => onExport('svg') },
    { id: 'import', label: '导入…', action: () => fileInput?.click() },
    { id: 'clear', label: '清除自动存档', danger: true, action: () => onClearCache() },
  ]);
</script>

<!-- 模式胶囊 + 视图设置：顶栏居中悬浮（2026-09-30：⚙ 移到切换显示右侧） -->
<div class="center">
  <ModeCapsule value={viewMode} onChange={onSwitchView} />
  <div class="gear-wrap">
    <button
      type="button"
      class="gear"
      aria-label="视图设置"
      aria-expanded={gearOpen}
      onclick={() => {
        gearOpen = !gearOpen;
        menuPos = null;
      }}
    >⚙</button>
    <ViewSettingsPopover
      open={gearOpen}
      onClose={() => (gearOpen = false)}
      {viewMode}
      {projection}
      {onProjection}
      {styleId}
      {onStyle}
      {globeShowAxis}
      {globeShowEcliptic}
      {globeSpin}
      {globeTilt}
      {globeRotHours}
      {onGlobeShowAxis}
      {onGlobeShowEcliptic}
      {onGlobeSpin}
      {onGlobeTilt}
      {onGlobeRotHours}
    />
  </div>
</div>

<!-- 世界名：右端 -->
<div class="right">
  <div class="name-wrap">
    {#if renaming}
      <input
        id="world-name-input"
        class="name-input"
        bind:value={draft}
        onblur={commitRename}
        onkeydown={(e) => {
          if (e.key === 'Enter') commitRename();
          else if (e.key === 'Escape') cancelRename();
        }}
      />
    {:else}
      <button
        type="button"
        class="name"
        bind:this={nameBtn}
        title="单击菜单 · 双击改名"
        onclick={onNameClick}
        ondblclick={onNameDblClick}
      >
        🗂 {worldName} ▾
      </button>
    {/if}
  </div>
</div>

{#if menuPos}
  <ContextMenu x={menuPos.x} y={menuPos.y} items={menuItems} onClose={() => (menuPos = null)} />
{/if}

<input
  bind:this={fileInput}
  type="file"
  accept=".json,.gz,.mapedi.json,.mapedi.json.gz"
  style="position:fixed;left:-9999px"
  onchange={(e) => {
    const f = e.currentTarget.files?.[0];
    if (f) onImport('json', f);
    e.currentTarget.value = '';
  }}
/>

<style>
  .center {
    position: fixed;
    top: 10px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: auto;
  }
  .right {
    position: fixed;
    top: 10px;
    right: 14px;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 6px;
    pointer-events: auto;
  }
  .name,
  .name-input {
    height: 26px;
    padding: 0 12px;
    border-radius: 13px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(10, 12, 18, 0.82);
    color: var(--text, #ddd);
    font-size: 12px;
    line-height: 24px;
    cursor: pointer;
    outline: none;
  }
  .name:hover {
    background: rgba(18, 20, 26, 0.96);
  }
  .name-input {
    width: 180px;
    cursor: text;
    border-color: rgba(240, 195, 106, 0.7);
  }
  .gear {
    width: 26px;
    height: 26px;
    padding: 0;
    border-radius: 13px;
    border: 1px solid rgba(255, 255, 255, 0.16);
    background: rgba(10, 12, 18, 0.82);
    color: var(--text, #ddd);
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
  }
  .gear:hover {
    background: rgba(18, 20, 26, 0.96);
  }
  .gear-wrap {
    position: relative;
  }
</style>
