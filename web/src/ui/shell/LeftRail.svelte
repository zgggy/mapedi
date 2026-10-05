<script lang="ts">
  /**
   * 左栏（2026-09-30 第七轮微调）：三块——
   * ① 顶行 = 工作区模式胶囊 + undo/redo 圆钮（面板右缘与圆钮右缘对齐：rail 宽 = max-content
   *    由顶行决定，两面板 stretch 同宽）；
   * ② 图层面板 ③ 元素面板（原“工作区”改名）——均为 ExpandPanel 单体（把手自身展开，
   *    不在下面另加面板）；块间 8px；开合本地 state + 持久化；宽度经 onState 回传（C7）。
   */
  import { editor } from '../../app/store.svelte';
  import type { Snippet } from 'svelte';
  import ModeCapsule from './ModeCapsule.svelte';
  import ExpandPanel from './ExpandPanel.svelte';
  import { WS_MODE_ITEMS, persistPanelOpen, readPanelOpen, type WsMode } from './shell';

  let {
    layers,
    workspace,
    taskMode = 'check',
    globeLocked = false,
    onTaskMode,
    onState,
  }: {
    /** 图层面板内容（列表 + 聚焦行展开区） */
    layers: Snippet<[]>;
    /** 元素面板内容（创建/搜索 + 列表 + 选中行展开区） */
    workspace: Snippet<[]>;
    taskMode?: WsMode;
    globeLocked?: boolean;
    onTaskMode?: (m: WsMode) => void;
    /** 面板开合 + 实测宽度回传（App 用于 C7 遮挡宽与高度标注条件） */
    onState?: (s: { layersOpen: boolean; wsOpen: boolean; right: number }) => void;
  } = $props();

  let layersOpen = $state(readPanelOpen('layers', true));
  let wsOpen = $state(readPanelOpen('ws', true));
  let railEl: HTMLElement | undefined = $state();

  function togglePane(which: 'layers' | 'ws', v: boolean) {
    if (which === 'layers') layersOpen = v;
    else wsOpen = v;
    persistPanelOpen(which, v);
    emit();
  }

  function emit() {
    // right = 栏右缘（fixed left8 + 实测宽）——地图居中偏移用（2026-10-04）
    onState?.({
      layersOpen,
      wsOpen,
      right: (railEl?.offsetLeft ?? 8) + (railEl?.clientWidth ?? 220),
    });
  }

  let toprowEl: HTMLElement | undefined = $state();
  // 宽度基准 = 顶行（胶囊+圆钮）——只观测 toprow，面板内容撑不宽 rail；实测宽回传（C7）
  $effect(() => {
    if (!railEl || !toprowEl) return;
    const apply = () => {
      const w = toprowEl!.clientWidth;
      railEl!.style.setProperty('--rail-w', `${w}px`);
      emit();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(toprowEl);
    return () => ro.disconnect();
  });
</script>

<aside class="rail" bind:this={railEl} aria-label="左栏">
  <!-- ① 顶行：模式胶囊 + undo/redo 圆钮（与顶栏视图胶囊同一高度水平线） -->
  <div class="toprow" bind:this={toprowEl}>
    <ModeCapsule
      value={taskMode}
      onChange={(v) => onTaskMode?.(v as 'check' | 'gen' | 'draw')}
      items={WS_MODE_ITEMS}
      ariaLabel="工作区模式"
      segMinW={46}
      disabledWhen={(id) => globeLocked && id !== 'check'}
    />
    <button type="button" class="round" title="撤销 (Ctrl+Z)" aria-label="撤销" onclick={() => editor.undo()}>↶</button>
    <button type="button" class="round" title="重做 (Ctrl+Y)" aria-label="重做" onclick={() => editor.redo()}>↷</button>
  </div>

  <!-- ② 图层面板 ③ 元素面板：同一 ExpandPanel 单体、只换内容 -->
  <ExpandPanel
    icon="📚"
    label="图层"
    open={layersOpen}
    onToggle={(v) => togglePane('layers', v)}
    title={layersOpen ? '收起图层面板' : '展开图层面板'}
    grow
    content={layers}
  />
  <ExpandPanel
    icon="🧩"
    label="元素"
    open={wsOpen}
    onToggle={(v) => togglePane('ws', v)}
    title={wsOpen ? '收起元素面板' : '展开元素面板'}
    grow
    content={workspace}
  />
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
    gap: var(--sp-4); /* 三块之间统一间隔 */
    min-height: 0;
    user-select: none;
    font-size: var(--fs-sm); /* 面板字体统一 11（第十轮） */
    /* 宽度基准 = 顶行（胶囊+圆钮）：panel 内容不得撑宽（展开定宽） */
    width: var(--rail-w, max-content);
  }
  .toprow {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--sp-3);
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
</style>
