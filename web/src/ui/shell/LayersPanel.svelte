<script lang="ts">
  /**
   * 图层段（左轨内的图层子面板，设计稿 §3.2）：
   * - header 常驻：`[⊟ 收起整轨] 当前聚焦层（emoji·名·eye·元素数） [展开/收起]`
   * - 展开：CreateRow + 单列网格 ItemButton 行（内滚由左轨段负责，§3.1 双滚动模型）
   * 行 = 眼睛（显隐）+ 图层 logo + 名称；单击聚焦（C1：不进绘制）；双击打开显示参数。
   * 右键菜单：显示/隐藏、上移一层、下移一层、复制一个、删除。
   * 拖动 = 长按进度条解锁 → 整个按钮被拿起来（浮动件跟指针）→ 目标格与下方元素让一格
   *（transform + 过渡动画）→ 松手触发重排重算。
   */
  import { tick } from 'svelte';
  import { LAYER_META } from '../workbench/layerMeta';
  import type { World } from '../../core/types';
  import ItemButton from './ItemButton.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import CreateRow from './CreateRow.svelte';
  import { defaultLayerVisible } from '../../core/displayCompose';
  import { measureSlot } from './liftDrag';
  import OrganizeRow from './OrganizeRow.svelte';

  let {
    world,
    focusLayer = 'cells',
    newName = '',
    onSelect,
    onDrawLayer,
    onAddLayer,
    onNewName,
    onRandomName,
    onMoveLayer,
    onCopyLayer,
    onDeleteLayer,
    expandPanel,
    taskMode = 'check',
    onOrganize,
  }: {
    world: World | null;
    focusLayer?: string;
    newName?: string;
    /** 工作区模式（组织 = 上移/下移/缩进/提升面板，替代已退役的拖动） */
    taskMode?: 'check' | 'gen' | 'draw' | 'organize';
    /** 组织四操作（App 转发 store） */
    onOrganize?: (action: 'up' | 'down' | 'indent' | 'unindent', id: string) => void;
    /** 单击选中（并置顶显示） */
    onSelect?: (id: string) => void;
    /** 选中（C1：单击只聚焦，不进绘制） */
    onDrawLayer?: (id: string) => void;
    onAddLayer?: () => void;
    onNewName?: (v: string) => void;
    onRandomName?: () => void;
    /** 右键菜单：上移/下移一层（dir=-1 上移） */
    onMoveLayer?: (id: string, dir: -1 | 1) => void;
    /** 右键菜单：复制一个 */
    onCopyLayer?: (id: string) => void;
    /** 右键菜单：删除 */
    onDeleteLayer?: (id: string) => void;
    /** 聚焦行下方的模式展开区（检查=InspectSection / 生成=GenerateSection / 绘制=不传=空） */
    expandPanel?: import('svelte').Snippet;
  } = $props();

  type Meta = { emoji: string; name: string; kind: string; category: string; pending?: boolean };

  const rows = $derived.by(() => {
    const layers = world?.layers ?? [];
    const parentOf = new Map<string, string>();
    for (const l of layers) if (l.parentLayerId) parentOf.set(l.id, l.parentLayerId);
    const children = new Map<string | null, string[]>();
    for (const l of layers) {
      const p = parentOf.get(l.id);
      const key = p && layers.some((x) => x.id === p) ? p : null;
      let arr = children.get(key);
      if (!arr) {
        arr = [];
        children.set(key, arr);
      }
      arr.push(l.id);
    }
    const byId = new Map(layers.map((l) => [l.id, l]));
    const out: {
      id: string;
      depth: number;
      parentId: string | null;
      meta: Meta;
      visible: boolean;
    }[] = [];
    const walk = (pid: string | null, depth: number) => {
      for (const id of children.get(pid) ?? []) {
        const layer = byId.get(id);
        if (!layer) continue;
        const base = (LAYER_META[id] ?? {
          emoji: '📄',
          name: layer.name,
          kind: layer.kind,
          category: 'custom',
        }) as Meta;
        out.push({
          id,
          depth,
          parentId: pid,
          meta: { ...base, name: layer.name || base.name },
          visible: layer.visible ?? defaultLayerVisible(layer),
        });
        walk(id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  });


  // —— 右键菜单 ——
  let menu = $state<{ x: number; y: number; items: MenuItem[] } | null>(null);

  function openMenu(e: MouseEvent, id: string) {
    // 简化（2026-09-30 拍板 3）：显隐 → 行内 eye；信息/显示参数 → 检查模式展开区；
    // 上移/下移 → 长按拖动。只留无其他入口的复制/删除。
    const items: MenuItem[] = [{ id: 'copy', label: '复制一个', action: () => onCopyLayer?.(id) }];
    if (id.startsWith('custom-')) {
      items.push({ id: 'del', label: '删除', danger: true, action: () => onDeleteLayer?.(id) });
    } else {
      items.push({ id: 'del', label: '删除（内置层不可删）', disabled: true });
    }
    menu = { x: e.clientX, y: e.clientY, items };
  }

  let listEl: HTMLElement | undefined = $state();
  // 行内容变化后统一行高（等高保留；拖动已退役——2026-09-30 组织模式替代）
  $effect(() => {
    const el = listEl;
    if (!el) return;
    measureSlot(el);
    const mo = new MutationObserver(() => {
      measureSlot(el);
    });
    mo.observe(el, { subtree: true, childList: true, characterData: true });
    return () => mo.disconnect();
  });

  function handleSelect(id: string) {
    if (focusLayer === id) {
      // 再点已聚焦行 = 收起（对称单开：聚焦取消 → 行展开区消失、工作区回空态提示）
      onSelect?.('');
      return;
    }
    onSelect?.(id);
    onDrawLayer?.(id);
  }

  function onBlankClick(e: MouseEvent) {
    const t = e.target as HTMLElement | null;
    if (t?.closest?.('[data-row-id]')) return;
    if (t?.closest?.('button,input,select,textarea')) return;
    onSelect?.('');
  }

</script>

<div class="sec-root">
  <!-- 2026-09-30 第六轮终稿：header/胶囊/轻区头已上移或退役——本组件 = 纯图层列表
       （收起/展开把手由 LeftRail 的面板框架承担） -->
    <div class="body">
      <div class="create">
    <CreateRow
      placeholder="新图层"
      {newName}
      onNewName={(v) => onNewName?.(v)}
      onRandom={() => onRandomName?.()}
      onCreate={() => onAddLayer?.()}
    />
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul class="grid" role="list" bind:this={listEl} onclick={onBlankClick}>
    {#each rows as row, i (row.id)}
      <li
        class="cell"
        class:open={focusLayer === row.id}
        data-row-id={row.id}
        style="padding-left:0"
      >
        <!-- 第八轮：行按钮自身 = 把手（聚焦行原地展开）；显隐眼睛在检查模式展开区 -->
        <!-- 第十轮：组织模式 = OrganizeRow（上移/下移/缩进/提升，替代拖动） -->
        {#snippet rowOrg()}
          <OrganizeRow
            name={row.meta.name}
            first={rows[0]?.id === row.id}
            top={!row.parentId}
            onMove={(dir) => onOrganize?.(dir === -1 ? 'up' : 'down', row.id)}
            onIndent={() => onOrganize?.('indent', row.id)}
            onUnindent={() => onOrganize?.('unindent', row.id)}
          />
        {/snippet}
        <ItemButton
          logo={row.meta.emoji}
          name={row.meta.name}
          selected={focusLayer === row.id}
          open={focusLayer === row.id}
          content={focusLayer === row.id ? (taskMode === 'organize' ? rowOrg : expandPanel) : null}
          onClick={() => handleSelect(row.id)}
          onMenu={(e) => openMenu(e, row.id)}
        />
      </li>
    {/each}
      </ul>
    </div>


  {#if menu}
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => (menu = null)} />
  {/if}
</div>

<style>
  .sec-root {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  /* header = 设计稿 §3.1 的一行：[⊟] 当前层/图层 [展开|收起] */
  /* 展开体：由左轨段负责滚动（§3.1 双滚动模型），这里只撑满 */
  .body {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
  .create {
    flex: 0 0 auto;
    padding: 4px 2px; /* 与列表同宽；第十轮：去分割线 */
  }
  /* 单列网格：一格 = 一个 ItemButton（与工作区列表同 padding/gap：2026-09-30 紧凑统一） */
  .grid {
    flex: 1;
    min-height: 0;
    list-style: none;
    margin: 0;
    padding: 2px; /* 第十轮：边距 = 原 1/3（用户定） */
    display: grid;
    grid-template-columns: 1fr;
    gap: 4px;
    align-content: start;
  }
  .cell {
    margin: 0;
    height: var(--ibtn-h, 40px);
    transition: transform 0.18s ease;
  }
  /* 模式展开区（panel 节点，可变高） */
  /* 第八轮：聚焦行原地展开（li 高度随把手内容自适应；等高机制只测头部） */
  .cell.open {
    height: auto;
  }
</style>
