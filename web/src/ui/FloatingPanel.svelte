<script lang="ts">
  import type { PanelState, PanelCorner } from './panelStore';
  import { nearestCorner } from './panelStore';

  let {
    panel,
    onupdate,
    onpin,
  }: {
    panel: PanelState;
    onupdate: (p: Partial<PanelState> & { id: string }) => void;
    onpin?: (id: string) => void;
  } = $props();

  let dragging = $state(false);
  let resizing = $state(false);
  let dragOx = 0;
  let dragOy = 0;

  function clamp(v: number, a: number, b: number) {
    return Math.max(a, Math.min(b, v));
  }

  function onPointerDownTitle(e: PointerEvent) {
    if (panel.form !== 'panel') return;
    dragging = true;
    dragOx = e.clientX - panel.x;
    dragOy = e.clientY - panel.y;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (dragging) {
      const x = clamp(e.clientX - dragOx, 0, window.innerWidth - 80);
      const y = clamp(e.clientY - dragOy, 0, window.innerHeight - 40);
      onupdate({ id: panel.id, x, y });
      return;
    }
    if (resizing) {
      const w = clamp(e.clientX - panel.x, 160, window.innerWidth - panel.x);
      const h = clamp(e.clientY - panel.y, 80, window.innerHeight - panel.y);
      onupdate({ id: panel.id, w, h });
    }
  }

  function onPointerUp(e: PointerEvent) {
    dragging = false;
    resizing = false;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
  }

  /** 只收成圆角矩形图标，停到最近角 */
  function collapse() {
    const corner: PanelCorner = nearestCorner(panel, window.innerWidth, window.innerHeight);
    onupdate({ id: panel.id, form: 'icon', corner });
  }

  function expand() {
    onupdate({
      id: panel.id,
      form: 'panel',
      w: Math.max(panel.w, 240),
      h: Math.max(panel.h, 160),
      x: Math.max(8, Math.min(panel.x, window.innerWidth - 260)),
      y: Math.max(8, Math.min(panel.y, window.innerHeight - 180)),
    });
  }
</script>

{#if panel.form === 'hidden'}
  <!-- hidden -->
{:else if panel.form === 'icon'}
  <button
    type="button"
    class="icon-tile"
    style="left:{panel.x}px;top:{panel.y}px"
    onclick={expand}
    title={panel.title}
  >
    <span class="emoji">{panel.emoji}</span>
  </button>
{:else}
  <div
    class="panel"
    style="left:{panel.x}px;top:{panel.y}px;width:{panel.w}px;height:{panel.h}px"
  >
    <header
      role="toolbar"
      tabindex="-1"
      onpointerdown={onPointerDownTitle}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
      ondblclick={collapse}
    >
      <span class="title">{panel.emoji} {panel.title}</span>
      <span class="actions">
        <button type="button" class="collapse-btn" onclick={collapse} title="收起为图标">
          ▫️
        </button>
        {#if onpin}
          <button type="button" onclick={() => onpin?.(panel.id)} title="钉住">📌</button>
        {/if}
      </span>
    </header>
    <div class="body">
      <div class="dim pad">{panel.title}</div>
    </div>
    <div
      class="resize"
      role="separator"
      aria-orientation="horizontal"
      onpointerdown={(e) => {
        resizing = true;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onpointermove={onPointerMove}
      onpointerup={onPointerUp}
    ></div>
  </div>
{/if}

<style>
  .panel {
    position: fixed;
    z-index: 20;
    display: flex;
    flex-direction: column;
    background: var(--panel);
    backdrop-filter: blur(12px);
    border: 1px solid var(--panel-border);
    border-radius: 12px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 8px 6px 12px;
    cursor: grab;
    user-select: none;
    border-bottom: 1px solid var(--panel-border);
    background: rgba(255, 255, 255, 0.03);
  }

  header:active {
    cursor: grabbing;
  }

  .title {
    font-weight: 600;
    font-size: 13px;
  }

  .actions {
    display: flex;
    gap: 4px;
  }

  .actions button {
    padding: 2px 6px;
    min-width: 28px;
  }

  .collapse-btn {
    border-radius: 8px;
  }

  .body {
    flex: 1;
    overflow: auto;
    padding: 10px 12px;
    min-height: 40px;
  }
  .pad {
    opacity: 0.45;
    font-size: 11px;
  }

  .resize {
    position: absolute;
    right: 0;
    bottom: 0;
    width: 14px;
    height: 14px;
    cursor: nwse-resize;
    background: linear-gradient(135deg, transparent 50%, rgba(255, 255, 255, 0.15) 50%);
  }

  .icon-tile {
    position: fixed;
    z-index: 21;
    width: 48px;
    height: 40px;
    display: grid;
    place-items: center;
    background: var(--panel);
    border: 1px solid var(--panel-border);
    border-radius: 10px;
    cursor: pointer;
    user-select: none;
    padding: 0;
  }
  .icon-tile:hover {
    background: rgba(255, 255, 255, 0.1);
  }
  .emoji {
    font-size: 16px;
  }
  .dim {
    color: var(--text-dim);
  }
</style>
