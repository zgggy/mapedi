<script lang="ts">
  /**
   * 左侧轨（设计稿 §3）：视口全高，**轨本身不滚**，段内各自滚。
   *
   * 结构 = 图层子面板（可收成 header 一行）+ 工作区，四段次序由各段自身负责
   * （C8：工具带 → 新增+搜索 → 元素列表 → 低频折叠区）。本组件只提供布局、
   * 段间分隔与滚动边界；chrome（⊟、图层 header、工作区 header）由段自己渲染，
   * 因为它们的数据（当前层 emoji/名称/元素数）只在段内有。
   */
  import type { Snippet } from 'svelte';

  let {
    width = 220,
    layers,
    workspace,
  }: {
    width?: number;
    /** 图层段（含自己的 header 与展开/收起） */
    layers: Snippet;
    /** 工作区段（含自己的 header 与四段内容） */
    workspace: Snippet;
  } = $props();
</script>

<aside class="rail" style="width:{width}px" aria-label="图层与工作区">
  <!-- 图层段：header 常驻（收起时只剩 header），列表内滚、最高 45% 轨高 -->
  <div class="sec layers"><div class="in">{@render layers()}</div></div>
  <!-- 工作区段：占余下全部；内部再分工具带/列表（列表 flex-1 内滚） -->
  <div class="sec ws"><div class="in">{@render workspace()}</div></div>
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
    min-height: 0;
    background: rgba(16, 19, 26, 0.94);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.45);
    overflow: hidden;
    user-select: none;
    font-size: 12px;
  }
  .sec {
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  /* 图层段：随内容收缩（收起时只剩 header），**最高 45% 轨高**，超出内滚——
     用 max-height 而非 flex-basis：basis 会让收起后的空壳仍占 45%（§3.1） */
  .sec.layers {
    flex: 0 0 auto;
    max-height: 45%;
    overflow-y: auto;
    scrollbar-width: none;
    border-bottom: 1px solid var(--panel-border);
  }
  .sec.layers::-webkit-scrollbar {
    width: 0;
    height: 0;
  }
  /* 工作区段：占余下全部，自身不滚（内部列表滚） */
  .sec.ws {
    flex: 1 1 auto;
    overflow: hidden;
  }
  .in {
    display: flex;
    flex-direction: column;
    min-height: 0;
    flex: 1;
  }
</style>
