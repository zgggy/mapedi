<script lang="ts">
  /**
   * 行按钮（2026-09-30 第十轮：**拖动已退役**，组织模式替代；第十一轮：**行内控件退役**——
   * button 上不再有任何操作控件，滑块只在展开内容里）——外壳/开合/body/限高
   * 全部 = ExpandPanel（header 槽放原交互按钮）；本组件只管头部交互（单击/双击/右键）
   * 与头部内容；眼睛在检查模式展开区（InspectSection）。等高按头部 .txt 测量。
   * depth > 0 = 缩进行：button 内最左侧一根短竖线（缩进的唯一视觉标识，用户定）。
   */
  import type { Snippet } from 'svelte';
  import ExpandPanel from './ExpandPanel.svelte';

  let {
    logo = '',
    logoColor = '',
    name = '',
    desc = '',
    depth = 0,
    selected = false,
    hidden = false,
    gear = false,
    open = false,
    content,
    onClick,
    onDblclick,
    onMenu,
  }: {
    /** 图层 logo（emoji） */
    logo?: string;
    /** 元素 logo（颜色块） */
    logoColor?: string;
    name: string;
    /** 可选简介 */
    desc?: string;
    /** 树深度（>0 显示缩进短竖线） */
    depth?: number;
    /** 选中：金色外框 */
    selected?: boolean;
    /** 已隐藏（L0 状态点，2026-10-02 D6 拍板：异常态才出现） */
    hidden?: boolean;
    /** 有专属生成面板（L0：⚙ 小标） */
    gear?: boolean;
    /** 本行展开态（选中/聚焦驱动；open 时原地长出 content） */
    open?: boolean;
    /** 展开内容（检查/生成/绘制/组织模式区；缺省 = 纯行不可展开） */
    content?: Snippet;
    onClick?: (e: MouseEvent) => void;
    onDblclick?: () => void;
    /** 右键菜单（坐标 + 目标） */
    onMenu?: (e: MouseEvent) => void;
  } = $props();
</script>

<ExpandPanel open={open && !!content} {content} {selected} bodyMax="42vh">
  {#snippet header()}
    <button
      type="button"
      class="ibtn"
      class:open={open && !!content}
      class:hidden
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
      {#if depth > 0}
        <span class="dbar" aria-hidden="true"></span>
      {/if}
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
      </span>
      {#if hidden}
        <span class="badge" title="已隐藏">🚫</span>
      {/if}
      {#if gear}
        <span class="badge" title="有专属生成面板">⚙</span>
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
  /* L0 隐藏态（D6）：名称压暗 + 🚫 点——异常态才出现，不给正常行加噪 */
  .ibtn.hidden .nm {
    opacity: 0.55;
  }
  .badge {
    flex: 0 0 auto;
    font-size: 9px;
    line-height: 1;
    opacity: 0.8;
  }
  /* 缩进短竖线（第十一轮：button 内最左侧；depth > 0 才有） */
  .dbar {
    flex: 0 0 auto;
    width: 2px;
    height: 12px;
    border-radius: 1px;
    background: rgba(240, 195, 106, 0.55);
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
</style>
