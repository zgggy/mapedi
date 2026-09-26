<script lang="ts">
  export type SheetId = 'none' | 'layers' | 'settings' | 'workspace';
  export type SettingsTab = 'generate' | 'view' | 'project';

  let {
    sheet = $bindable('none'),
    settingsTab = $bindable('generate'),
    hasSelection = false,
  }: {
    sheet?: SheetId;
    settingsTab?: SettingsTab;
    hasSelection?: boolean;
  } = $props();

  function toggle(s: SheetId) {
    sheet = sheet === s ? 'none' : s;
  }
  function openSettings(t: SettingsTab) {
    if (sheet === 'settings' && settingsTab === t) sheet = 'none';
    else {
      settingsTab = t;
      sheet = 'settings';
    }
  }
</script>

<div class="shell">
  <div class="topbar left">
    <button type="button" class:active={sheet === 'settings' && settingsTab === 'generate'} onclick={() => openSettings('generate')}>
      ⚙️ 生成
    </button>
    <button type="button" class:active={sheet === 'layers'} onclick={() => toggle('layers')}>
      📚 图层
    </button>
  </div>

  <div class="topbar right">
    <button type="button" class:active={sheet === 'settings' && settingsTab === 'view'} onclick={() => openSettings('view')}>
      🗺️ 视图
    </button>
    <button type="button" class:active={sheet === 'settings' && settingsTab === 'project'} onclick={() => openSettings('project')}>
      💾 项目
    </button>
  </div>

  <aside class="rail left-rail" aria-label="图层">
    <button type="button" class="rail-btn tall" class:active={sheet === 'layers'} onclick={() => toggle('layers')} title="展开图层">
      📚
    </button>
  </aside>

  <aside class="rail right-rail" aria-label="设置与工作区">
    <button type="button" class="rail-btn" class:active={sheet === 'settings'} onclick={() => toggle('settings')} title="设置">
      ⚙️
    </button>
    <button
      type="button"
      class="rail-btn tall flex"
      class:active={sheet === 'workspace'}
      class:dim={!hasSelection}
      onclick={() => toggle('workspace')}
      title={hasSelection ? '展开工作区' : '工作区（请先选图层）'}
    >
      🛠️
    </button>
  </aside>
</div>

<style>
  .shell {
    pointer-events: none;
  }
  .topbar {
    position: fixed;
    top: 10px;
    z-index: 40;
    display: flex;
    gap: 6px;
    pointer-events: auto;
  }
  .topbar.left {
    left: 56px;
  }
  .topbar.right {
    right: 56px;
  }
  .topbar button {
    padding: 6px 12px;
    border-radius: 10px;
    background: rgba(18, 20, 26, 0.9);
    border: 1px solid var(--panel-border);
    font-size: 12px;
  }
  .topbar button.active {
    background: rgba(107, 124, 147, 0.45);
  }

  .rail {
    position: fixed;
    top: 0;
    bottom: 0;
    width: 44px;
    z-index: 41;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 6px;
    pointer-events: auto;
    background: linear-gradient(
      to right,
      rgba(10, 12, 16, 0.55),
      rgba(10, 12, 16, 0.12)
    );
  }
  .left-rail {
    left: 0;
    align-items: center;
  }
  .right-rail {
    right: 0;
    align-items: center;
    background: linear-gradient(
      to left,
      rgba(10, 12, 16, 0.55),
      rgba(10, 12, 16, 0.12)
    );
  }
  .rail-btn {
    width: 36px;
    height: 36px;
    border-radius: 10px;
    display: grid;
    place-items: center;
    background: rgba(18, 20, 26, 0.92);
    border: 1px solid var(--panel-border);
    font-size: 15px;
  }
  .rail-btn.tall {
    height: 56px;
  }
  .rail-btn.flex {
    flex: 1;
    min-height: 80px;
  }
  .rail-btn.active {
    background: rgba(107, 124, 147, 0.4);
  }
  .rail-btn.dim {
    opacity: 0.45;
  }
</style>
