<script lang="ts">
  /**
   * 图层段（左轨内的图层子面板，设计稿 §3.2；第十一轮结构定稿）：
   * - ul = 创建行（新图层文本框**兼过滤器** + 🎲 + ➕，拉满与 button 同宽）
   *   → 图层行（缩进行 button 内最左侧一根短竖线；li 左垫 = depth×14）。
   * - 行 = 图层 logo + 名称；单击聚焦（C1：不进绘制）+ 原地展开模式区。
   * - 组织模式行展开区 = 上移/下移/缩进/提升（缩进=成为上一个同级的子图层）。
   * - 内滚：.grid overflow-y auto（第十一轮根治「不能滚动」）。
   * 右键菜单：复制一个、删除。
   */
  import { tick } from 'svelte';
  import { LAYER_META } from '../workbench/layerMeta';
  import type { World } from '../../core/types';
  import ItemButton from './ItemButton.svelte';
  import ContextMenu, { type MenuItem } from './ContextMenu.svelte';
  import CreateRow from './CreateRow.svelte';
  import { defaultLayerVisible } from '../../core/displayCompose';
  import { layerTreeOf } from '../../core/layer/tree';
  import { measureSlot } from './liftDrag';
import { isRowOrControlClick } from './shell';
  import OrganizeRow from './OrganizeRow.svelte';

  let {
    world,
    focusLayer = 'cells',
    onSelect,
    onDrawLayer,
    onAddLayer,
    onRandomName,
    onCopyLayer,
    onDeleteLayer,
    expandPanel,
    taskMode = 'check',
    onOrganize,
  }: {
    world: World | null;
    focusLayer?: string;
    /** 工作区模式（组织 = 上移/下移/缩进/提升面板，替代已退役的拖动） */
    taskMode?: 'check' | 'gen' | 'draw' | 'organize';
    /** 组织四操作（App 转发 store） */
    onOrganize?: (action: 'up' | 'down' | 'indent' | 'unindent', id: string) => void;
    /** 单击选中（并置顶显示） */
    onSelect?: (id: string) => void;
    /** 选中（C1：单击只聚焦，不进绘制） */
    onDrawLayer?: (id: string) => void;
    /** 创建（带本面板文本；store 内部清空自身 newName） */
    onAddLayer?: (name: string) => void;
    /** 随机名（返回生成的名字，本面板回填文本框） */
    onRandomName?: () => string;
    /** 右键菜单：复制一个 */
    onCopyLayer?: (id: string) => void;
    /** 右键菜单：删除 */
    onDeleteLayer?: (id: string) => void;
    /** 聚焦行下方的模式展开区（检查=InspectSection / 生成=GenerateSection / 绘制=不传=空） */
    expandPanel?: import('svelte').Snippet;
  } = $props();

  /** 本面板私有创建/搜索文本（2026-10-01 用户定：两面板各自只搜自己，互不影响） */
  let text = $state('');

  type Meta = { emoji: string; name: string; kind: string; category: string; pending?: boolean };

  // 组织面包屑链由 layerTreeOf 单源携带（O2，原 chainOf 内联 walk 已删）

  const rows = $derived.by(() => {
    const layers = world?.layers ?? [];
    const byId = new Map(layers.map((l) => [l.id, l]));
    const out: {
      id: string;
      depth: number;
      parentId: string | null;
      chain: string;
      meta: Meta;
      hidden: boolean;
    }[] = [];
    for (const r of layerTreeOf(world)) {
      const layer = byId.get(r.id);
      if (!layer) continue;
      const base = (LAYER_META[r.id] ?? {
        emoji: '📄',
        name: layer.name,
        kind: layer.kind,
        category: 'custom',
      }) as Meta;
      out.push({
        id: r.id,
        depth: r.depth,
        parentId: r.parentId,
        chain: r.chain,
        meta: { ...base, name: layer.name || base.name },
        hidden: !(layer.visible ?? defaultLayerVisible(layer)),
      });
    }
    return out;
  });

  /**
   * 创建行文本 = 过滤器（第十一轮结构定稿：搜索并入创建行，独立搜索行退役）。
   * 规则与元素过滤同构：本体命中保留整支；子命中保留祖先路径。
   */
  const shownRows = $derived.by(() => {
    const q = text.trim().toLowerCase();
    if (!q) return rows;
    type Row = (typeof rows)[number];
    const children = new Map<string | null, Row[]>();
    for (const r of rows) {
      let arr = children.get(r.parentId);
      if (!arr) {
        arr = [];
        children.set(r.parentId, arr);
      }
      arr.push(r);
    }
    const keep = (r: Row): Row[] => {
      if (r.meta.name.toLowerCase().includes(q)) {
        const all: Row[] = [];
        const add = (x: Row) => {
          all.push(x);
          for (const k of children.get(x.id) ?? []) add(k);
        };
        add(r);
        return all;
      }
      const kept: Row[] = [];
      for (const k of children.get(r.id) ?? []) kept.push(...keep(k));
      return kept.length ? [r, ...kept] : [];
    };
    const out: Row[] = [];
    for (const r of children.get(null) ?? []) out.push(...keep(r));
    return out;
  });

  /** 组织四钮禁用判定（按过滤后的显示列表，2026-10-01 语义 v2）：
   *  prev/next = 同 parentId 邻居（上移/下移）；
   *  canIndent = 存在视觉上一行且当前父 ≠ 上一行（缩进目标 = 视觉上一行，无则禁用/无操作）。 */
  const sibFlags = $derived.by(() => {
    const m = new Map<string, { prev: boolean; next: boolean; canIndent: boolean }>();
    shownRows.forEach((r, i) => {
      const prev = shownRows.slice(0, i).some((x) => x.parentId === r.parentId);
      const next = shownRows.slice(i + 1).some((x) => x.parentId === r.parentId);
      const above = i > 0 ? shownRows[i - 1] : null;
      const canIndent = !!above && r.parentId !== above.id;
      m.set(r.id, { prev, next, canIndent });
    });
    return m;
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
    if (isRowOrControlClick(e)) return;
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
      newName={text}
      onNewName={(v) => (text = v)}
      onRandom={() => {
        const n = onRandomName?.();
        if (n) text = n;
      }}
      onCreate={() => {
        onAddLayer?.(text);
        text = '';
      }}
    />
  </div>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <ul class="grid" role="list" bind:this={listEl} onclick={onBlankClick}>
    {#each shownRows as row, i (row.id)}
      <li
        class="cell"
        class:open={focusLayer === row.id}
        data-row-id={row.id}
        style="padding-left:{row.depth * 14}px"
      >
        <!-- 第八轮：行按钮自身 = 把手（聚焦行原地展开）；显隐眼睛在检查模式展开区 -->
        <!-- 第十轮：组织模式 = OrganizeRow（上移/下移/缩进/提升，替代拖动） -->
        {#snippet rowOrg()}
          {@const sib = sibFlags.get(row.id) ?? { prev: false, next: false, canIndent: false }}
          <OrganizeRow
            name={row.meta.name}
            chain={row.chain}
            first={!sib.prev}
            last={!sib.next}
            top={!row.parentId}
            indentable={sib.canIndent}
            onMove={(dir) => onOrganize?.(dir === -1 ? 'up' : 'down', row.id)}
            onIndent={() => onOrganize?.('indent', row.id)}
            onUnindent={() => onOrganize?.('unindent', row.id)}
          />
        {/snippet}
        <ItemButton
          logo={row.meta.emoji}
          name={row.meta.name}
          depth={row.depth}
          selected={focusLayer === row.id}
          hidden={row.hidden}
          open={focusLayer === row.id}
          content={focusLayer === row.id && taskMode !== 'draw'
            ? taskMode === 'organize'
              ? rowOrg
              : expandPanel
            : null}
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
    padding: 4px 1px; /* 与列表同宽；第十一轮：左右间距再调小 */
  }
  /* 单列网格：一格 = 一个 ItemButton（与工作区列表同 padding/gap：2026-09-30 紧凑统一） */
  .grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto; /* 第十一轮根治：图层列表此前无 overflow → wheel 不滚 */
    scrollbar-width: none;
    list-style: none;
    margin: 0;
    padding: 1px; /* 第十一轮：左右间距再调小（用户定） */
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--sp-2);
    align-content: start;
  }
  .grid::-webkit-scrollbar {
    width: 0;
    height: 0;
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
