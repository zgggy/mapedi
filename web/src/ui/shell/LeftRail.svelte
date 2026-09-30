<script lang="ts">
  /**
   * 左栏（2026-09-30 第六轮终稿）：三块统一框架、块间 8px 间隔——
   * ① 顶行 = 工作区模式胶囊（与顶栏视图胶囊同一高度水平线）+ undo/redo 圆钮；
   * ② 图层面板；③ 工作区面板——两者框架一模一样：**收起 = 一行把手，展开 = 自身成子面板**，
   * 内容滚动只发生在各自 pane 内；都展开时各占一半（flex:1 平分），一开一收时展开者占满。
   * ⊟ 整轨收起已删（2026-09-30 用户定）；开合状态本地持有并持久化。
   */
  import type { Snippet } from 'svelte';
  import ModeCapsule from './ModeCapsule.svelte';
  import FoldHandle from './FoldHandle.svelte';
  import { WS_MODE_ITEMS, persistPanelOpen, readPanelOpen } from './shell';

  let {
    width = 220,
    layers,
    workspace,
    taskMode = 'check',
    globeLocked = false,
    onTaskMode,
    onUndo,
    onRedo,
    onState,
  }: {
    width?: number;
    /** 图层面板内容（列表 + 聚焦行展开区；滚动在其内部） */
    layers: Snippet<[]>;
    /** 工作区面板内容（创建/搜索 + 列表 + 选中行展开区；滚动在其内部） */
    workspace: Snippet<[]>;
    taskMode?: 'check' | 'gen' | 'draw';
    /** 球面锁定：仅检查档可用 */
    globeLocked?: boolean;
    onTaskMode?: (m: 'check' | 'gen' | 'draw') => void;
    onUndo?: () => void;
    onRedo?: () => void;
    /** 面板开合状态回传（App 用于 C7 遮挡宽与高度标注条件） */
    onState?: (s: { layersOpen: boolean; wsOpen: boolean }) => void;
  } = $props();

  let layersOpen = $state(readPanelOpen('layers', true));
  let wsOpen = $state(readPanelOpen('ws', true));

  function togglePane(which: 'layers' | 'ws', v: boolean) {
    if (which === 'layers') layersOpen = v;
    else wsOpen = v;
    persistPanelOpen(which, v);
    onState?.({ layersOpen, wsOpen });
  }

  // 初始同步（App 首帧即拿到真实开合态）
  $effect(() => {
    onState?.({ layersOpen, wsOpen });
  });
</script>

<aside class="rail" style="width:{width}px" aria-label="左栏">
  <!-- ① 顶行：模式胶囊 + undo/redo 圆钮（top 与顶栏视图胶囊同高） -->
  <div class="toprow">
    <ModeCapsule
      value={taskMode}
      onChange={(v) => onTaskMode?.(v as 'check' | 'gen' | 'draw')}
      items={WS_MODE_ITEMS}
      ariaLabel="工作区模式"
      segMinW={46}
      disabledWhen={(id) => globeLocked && id !== 'check'}
    />
    <button type="button" class="round" title="撤销 (Ctrl+Z)" aria-label="撤销" onclick={() => onUndo?.()}>↶</button>
    <button type="button" class="round" title="重做 (Ctrl+Y)" aria-label="重做" onclick={() => onRedo?.()}>↷</button>
  </div>

  <!-- ② 图层面板：收起=一行把手；展开=子面板（45% 上限内滚由内容负责） -->
  <section class="pane" class:open={layersOpen}>
    <FoldHandle
      icon="📚"
      label="图层"
      open={layersOpen}
      onToggle={(v) => togglePane('layers', v)}
      title={layersOpen ? '收起图层面板' : '展开图层面板'}
    />
    {#if layersOpen}
      <div class="pane-body">{@render layers()}</div>
    {/if}
  </section>

  <!-- ③ 工作区面板：框架与图层一模一样 -->
  <section class="pane" class:open={wsOpen}>
    <FoldHandle
      icon="🗂"
      label="工作区"
      open={wsOpen}
      onToggle={(v) => togglePane('ws', v)}
      title={wsOpen ? '收起工作区面板' : '展开工作区面板'}
    />
    {#if wsOpen}
      <div class="pane-body">{@render workspace()}</div>
    {/if}
  </section>
</aside>

<style>
  .rail {
    position: fixed;
    left: 8px;
    top: 10px;
    bottom: 8px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 8px; /* 三块之间统一间隔（2026-09-30 终稿） */
    min-height: 0;
    user-select: none;
    font-size: 12px;
    /* 容器无框：框/影在各 .pane 上（块间露出间隔） */
  }
  /* ① 顶行：与顶栏视图胶囊同一高度（height 26 = 胶囊/圆钮同高） */
  .toprow {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
    height: 26px;
  }
  .round {
    flex: 0 0 auto;
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
  .round:hover {
    background: rgba(18, 20, 26, 0.96);
  }
  /* ② ③ 面板：同款框架（收起 = 仅把手行；展开 = flex:1 分配） */
  .pane {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
    background: rgba(16, 19, 26, 0.94);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
  }
  .pane.open {
    flex: 1 1 0; /* 都展开 = 各占一半；一开一收 = 展开者占满 */
  }
  /* 子面板：内容滚动只发生在这里（不溢出把手/框） */
  .pane-body {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-top: 1px solid var(--panel-border);
  }
</style>
