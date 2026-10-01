<script lang="ts">
  /**
   * 状态栏三分区（设计稿 §5）：
   *   [ 上下文提示 / 操作反馈 / 错误(红) ] [ 悬停数据 ] [ 模式 · 缩放 · FPS · 已存时间 ]
   *  左：随事件变化            中：悬停才显示      右：固定仪表
   */
  import type { ViewMode } from './shell';

  let {
    hover = null,
    status = '',
    error = '',
    fps = 0,
    zoom = 1,
    preparing = false,
    mode = 'view-globe',
    autosaveAt = '',
    copyText = '',
    onPickElement,
  }: {
    hover?: {
      cellId: number;
      lon: number;
      lat: number;
      height: number;
      elementIds?: string[];
      elementNames?: string[];
    } | null;
    status?: string;
    /** 结构化错误（启动/导入失败等）：红色显示，优先于普通状态 */
    error?: string;
    fps?: number;
    /** 缩放级别（相对默认视野的倍率） */
    zoom?: number;
    /** 首启渐现/预热中：不显示会误导的低帧率 */
    preparing?: boolean;
    mode?: ViewMode;
    autosaveAt?: string;
    /** 运行错误全文（含栈）：状态栏复制按钮的载荷（缺省退回当前显示文本） */
    copyText?: string;
    /** 悬停归属元素点击跳选（C4 ①） */
    onPickElement?: (id: string) => void;
  } = $props();

  const modeLabel = $derived(mode === 'view-2d' ? '✏️ 平面' : '🌐 球面');
  /** 出错时（error 或 ⚠️ 状态）左侧出复制钮（2026-10-01 用户需求） */
  const showCopy = $derived(!!error || status.startsWith('⚠️'));
  let copied = $state(false);
  async function copyErr() {
    const text = copyText || error || status;
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // 剪贴板 API 不可用（权限/非安全上下文）→ execCommand 兜底
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } finally {
        ta.remove();
      }
    }
    if (ok) {
      copied = true;
      setTimeout(() => (copied = false), 1500);
    }
  }
</script>

<div class="pill">
  <!-- 左：上下文 / 反馈 / 错误 -->
  <span class="zone left" class:err={!!error}>
    {#if showCopy}
      <button
        type="button"
        class="cpy"
        title={copied ? '已复制' : '复制错误信息'}
        onclick={copyErr}
      >{copied ? '✓' : '⧉'}</button>
    {/if}
    {error || status}
  </span>

  <!-- 中：悬停数据 -->
  <span class="zone mid">
    {#if hover}
      <span>#{hover.cellId}</span>
      <span>{hover.lon.toFixed(1)}°,{hover.lat.toFixed(1)}°</span>
      <span class="h">高度 {hover.height.toFixed(3)}</span>
      <span class="dim">{hover.height > 0 ? '陆地' : hover.height === 0 ? '海平面' : '海洋'}</span>
      {#if hover.elementIds?.length}
        <span class="el">🧩
          {#each hover.elementIds as id, i (id)}
            <button
              type="button"
              class="chip"
              title="跳选该元素"
              onclick={() => onPickElement?.(id)}
            >{hover.elementNames?.[i] ?? id}</button>
          {/each}
        </span>
      {/if}
    {/if}
  </span>

  <!-- 右：固定仪表 -->
  <span class="zone right">
    <span class="be mode">{modeLabel}</span>
    <span class="dim">×{zoom.toFixed(2)}</span>
    {#if preparing && mode === 'view-2d'}
      <span class="be warm">预热中…</span>
    {:else}
      <span class="fps">{fps} FPS</span>
    {/if}
    {#if autosaveAt}
      <span class="be saved" title="自动保存时间">已存 {autosaveAt}</span>
    {/if}
    <span class="be gpu">GPU</span>
  </span>
</div>

<style>
  .pill {
    position: fixed;
    left: 50%;
    bottom: 8px;
    transform: translateX(-50%);
    z-index: 55;
    display: flex;
    gap: 12px;
    align-items: center;
    height: 26px;
    padding: 0 14px;
    font-size: 11px;
    background: rgba(10, 12, 18, 0.85);
    border: 1px solid var(--panel-border);
    border-radius: 13px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .zone {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .left {
    flex: 0 1 auto;
    max-width: 34vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
  }
  .left.err {
    color: #f0a0a0;
    font-weight: 600;
  }
  /* 错误复制钮：状态栏最左（2026-10-01） */
  .cpy {
    flex: 0 0 auto;
    border: 1px solid rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.06);
    color: inherit;
    border-radius: 7px;
    width: 18px;
    height: 16px;
    padding: 0;
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
  }
  .cpy:hover {
    background: rgba(255, 255, 255, 0.14);
  }
  .mid {
    flex: 1 1 auto;
    justify-content: center;
    overflow: hidden;
  }
  .right {
    flex: 0 0 auto;
    justify-content: flex-end;
  }
  .el {
    max-width: 20vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--accent, #7ec8ff);
    opacity: 0.9;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  /* 悬停归属元素：每个可点击跳选（C4 ①） */
  .chip {
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(255, 255, 255, 0.07);
    color: inherit;
    border-radius: 8px;
    padding: 1px 6px;
    font-size: 10px;
    line-height: 1.3;
    cursor: pointer;
    max-width: 14vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip:hover {
    background: rgba(240, 195, 106, 0.25);
    border-color: rgba(240, 195, 106, 0.6);
  }
  .be {
    opacity: 0.8;
    font-size: 11px;
  }
  .be.gpu,
  .be.mode {
    color: var(--accent, #7ec8ff);
  }
  .be.warm {
    color: var(--text-dim);
    font-style: italic;
  }
  .be.saved {
    color: var(--text-dim);
  }
  .fps {
    color: var(--text-dim);
  }
  .dim {
    color: var(--text-dim);
  }
</style>
