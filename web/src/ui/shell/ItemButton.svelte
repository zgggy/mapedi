<script lang="ts">
  /**
   * 行按钮（2026-09-30 第十轮：**拖动已退役**，组织模式替代）——外壳/开合/body/限高
   * 全部 = ExpandPanel（header 槽放原交互按钮）；本组件只管头部交互（单击/双击/右键）
   * 与头部内容；眼睛在检查模式展开区（InspectSection）。等高按头部 .txt 测量。
   */
  import type { Snippet } from 'svelte';
  import ExpandPanel from './ExpandPanel.svelte';

  let {
    logo = '',
    logoColor = '',
    name = '',
    desc = '',
    badge = '',
    selected = false,
    open = false,
    content,
    onClick,
    onDblclick,
    onMenu,
    control,
  }: {
    /** 图层 logo（emoji） */
    logo?: string;
    /** 元素 logo（颜色块） */
    logoColor?: string;
    name: string;
    /** 可选简介 */
    desc?: string;
    badge?: string;
    /** 选中：金色外框 */
    selected?: boolean;
    /** 本行展开态（选中/聚焦驱动；open 时原地长出 content） */
    open?: boolean;
    /** 展开内容（检查/生成/绘制/组织模式区；缺省 = 纯行不可展开） */
    content?: Snippet;
    onClick?: (e: MouseEvent) => void;
    onDblclick?: () => void;
    /** 右键菜单（坐标 + 目标） */
    onMenu?: (e: MouseEvent) => void;
    /** 可选控件（高度元素 = 胶囊滑块） */
    control?: Snippet;
  } = $props();
</script>

<ExpandPanel open={open && !!content} {content} {selected} bodyMax="42vh">
  {#snippet header()}
    <button
      type="button"
      class="ibtn"
      class:open={open && !!content}
      onclick={onClick}
      ondblclick={(e) => {
        e.preventDefault();
        onDblclick?.();
      }}
      oncontextmenu={(e) => {
        e.preventDefault();
        onMenu?.(e);
      }}
    >
      {#if logoColor}
        <span class="logo swatch" style="background:{logoColor}"></span>
      {:else if logo}
        <span class="logo em">{logo}</span>
      {/if}
      <span class="txt">
        <span class="nm">{name}</span>
        {#if desc}
          <span class="desc">{desc}</span>
        {/if}
        {#if badge}
          <span class="badge" title={badge}>{badge}</span>
        {/if}
      </span>
      {#if control}
        <span
          class="ctl no-drag"
          onpointerdown={(e) => e.stopPropagation()}
          onclick={(e) => e.stopPropagation()}
          ondblclick={(e) => e.stopPropagation()}
          oncontextmenu={(e) => e.stopPropagation()}
        >
          {@render control()}
        </span>
      {/if}
      {#if content}
        <span class="caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      {/if}
    </button>
  {/snippet}
</ExpandPanel>

<style>
  /* 头部内芯（外壳/开合/body = ExpandPanel，样式单源回归其组件） */
  .ibtn {
    position: relative;
    width: 100%;
    min-width: 0;
    /* 等高：由列表统一测量设定（按头部 .txt，展开内容不参与） */
    height: var(--ibtn-h, 26px);
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px; /* 把手同款内边距 */
    border: 0;
    border-radius: 12px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
    font-size: 11px;
    overflow: hidden;
    touch-action: none;
    user-select: none;
  }
  .ibtn.open {
    /* 第十轮：展开不加标题下横线 */
    border-radius: 12px 12px 0 0;
  }
  .ibtn:hover {
    background: rgba(255, 255, 255, 0.04);
  }
  /* 展开箭头（把手语言） */
  .caret {
    flex: 0 0 auto;
    font-size: 10px;
    color: var(--text-dim);
    padding-left: 2px;
  }
  .logo.em {
    flex: 0 0 auto;
    font-size: 13px;
    line-height: 1;
  }
  .logo.swatch {
    flex: 0 0 auto;
    width: 12px;
    height: 12px;
    border-radius: 3px;
  }
  /* 名称区（第十轮：不换行，紧凑单行省略——推翻旧换行契约，用户定） */
  .txt {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 6px;
    line-height: 1.25;
    max-height: 100%;
    overflow: hidden;
    scrollbar-width: none;
  }
  .txt .nm {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
  }
  .txt::-webkit-scrollbar {
    width: 0;
    display: none;
  }

  .desc {
    font-size: 10px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }
  .badge {
    flex: 0 0 auto;
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 999px;
    background: rgba(240, 195, 106, 0.15);
    border: 1px solid rgba(240, 195, 106, 0.4);
    max-width: 6em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ctl {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
