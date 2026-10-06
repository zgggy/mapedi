<script lang="ts">
  import { onMount } from 'svelte';
  import type { World } from '../core/types';
  import { defaultLayerStyleFor } from '../core/types';
  import { pickCell } from '../core/world';
  import { patchPieceEntry, invalidatePieceEntries, reconcilePieceMembership } from '../render/borderCache';
  import {
    unproject,
    project,
    type ProjectionId,
    type ProjectionParams,
    defaultProjParams, projectionPeriodAt } from '../core/project/projections';
  import {
    defaultCamera,
    drawWorld,
    warmLayerGeometry,
    type Camera,
    type HoverInfo,
  } from '../render/map2d';
  import { getProjCache } from '../render/projCache';
  import { frameLayer, pathsLayer } from '../render/layers';
  import {
    screenToContentLonLat,
    unwrapXAgainst,
    contentOffsetAt,
    worldToScreenX,
    worldToScreenY,
  } from '../render/space';
  import { zoomCamAt, panCam, contentPanDeltaX } from './planeCamera';
  import {
    catmullRomPolyline,
    createPathFeature,
    deleteControlPoint,
    insertControlPointOnPath,
    migrateToPathFeature,
    solePathOfKind,
    type PathKind,
  } from '../core/paths';
  import type { DrawTool } from '../core/draw/brush';
  import { cellsInBrush } from '../core/draw/brush';
  import { composeShownPieces, isFreeLayerId } from '../core/displayCompose';
  import { editsHeightAt } from '../core/layer/flags';
  import type { LonLat } from '../core/types';
  import { resolveLayerStyle } from '../core/layer/config';
  import { styleById } from '../core/styles';
  import { editor } from '../app/store.svelte';
  import {
    consumeHeightDeltas,
    consumePieceInvalidations,
  } from '../render/patchQueues';
  import { MapGlRenderer } from '../render/gl/mapRenderer';
  import { viewMemory } from './viewMemory';

  let {
    world,
    focusLayer = 'cells',
    centerBias = 0,
    forceLayerId = null,
    drawActive = false,
    drawTool = 'brush' as DrawTool,
    brushRadiusDeg = 1.5,
    highlightRegionId = null,
    roadSegments = [] as { a: number; b: number; pa: LonLat; pb: LonLat }[],
    projection = 'mercator' as ProjectionId,
    projParams,
    styleId = 'dark',
    workspaceOpen = false,
    onhover,
    onzoom,
    onwarm,
    onpick,
    bindCanvas,
  }: {
    world: World;
    focusLayer?: string;
    /**
     * 左栏让位偏移（像素，= 栏右缘；面板开合回传）。世界中心右移 centerBias/2：
     * 渲染与输入同用派生 viewCam —— 与旧「画布内缩」数学恒等（inset+(W-inset)/2
     * ≡ W/2+inset/2），但画布恢复全宽 → 地图透到左栏组件后面（2026-10-06 用户定）。
     */
    centerBias?: number;
    /** 绘制模式强制显示的焦点层（App 按模式传：draw → focusLayer；其余 null） */
    forceLayerId?: string | null;
    drawActive?: boolean;
    drawTool?: DrawTool;
    brushRadiusDeg?: number;
    highlightRegionId?: string | null;
    roadSegments?: { a: number; b: number; pa: LonLat; pb: LonLat }[];
    projection?: ProjectionId;
    projParams?: ProjectionParams;
    styleId?: string;
    /** 右侧工作区面板是否打开（高度标注的显示条件之一） */
    workspaceOpen?: boolean;
    onhover?: (info: HoverInfo | null) => void;
    /** 缩放级别（cam.scale / 默认 180）→ 状态栏显示 */
    onzoom?: (zoom: number) => void;
    /** 首启渐现/预热状态（true = 已完成）：状态栏据此显示「预热中…」而非误导性的低帧率 */
    onwarm?: (done: boolean) => void;
    /**
     * C1：会话外左键**单击** = 反选该处元素（抬起位移 <4px 才算单击，拖动是中/右键的事）。
     * 传 null = 该处无 cell（点击空白处，语义交由调用方决定）。
     */
    onpick?: (cellId: number | null) => void;
    bindCanvas?: (c: HTMLCanvasElement) => void;
  } = $props();

  let canvas: HTMLCanvasElement;
  let glCanvas: HTMLCanvasElement;
  let overlay: HTMLCanvasElement;
  let viewportRoot: HTMLDivElement;
  // 相机记忆（设计稿 §2.1-2）：两个视图互斥挂载，切走即卸载 → 视角存组件外的模块单例
  let cam: Camera = $state(viewMemory.plane?.cam ?? defaultCamera());
  /**
   * 显示相机（派生）：raw cam 只存/只写（平移增量、缩放锚点、viewMemory 均用 raw），
   * 渲染与输入读 viewCam = raw − (centerBias/2)/scale —— 内容整体右移 centerBias/2 px，
   * 与旧画布内缩逐点恒等（含屏幕↔内容反算），面板开合/栏宽变化自动跟随。
   */
  const viewCam = $derived.by(
    (): Camera => (centerBias ? { ...cam, x: cam.x - centerBias / 2 / cam.scale } : cam),
  );
  let hoverId: number | null = $state(null);
  let panning = false;
  let painting = false;
  let dragEndpoint: number | null = null;
  let spaceDown = false;
  let lastX = 0;
  let lastY = 0;
  /** 右键拖动：地图内容相对于矩形的偏移（右键拖动 = 构图摆放，与中键改相机是两个概念，C2） */
  let contentOffsetX = $state(viewMemory.plane?.contentOffsetX ?? 0);
  /** 右键内容平移会话（'cam' 成员已死：中键相机平移走独立路径，5-a 清理） */
  let panningMode: 'content' | null = null;

  // 每次相机/内容偏移变化即回写（视图卸载前的最后一次回写即记忆）
  $effect(() => {
    viewMemory.plane = { cam, contentOffsetX };
  });
  /** C1 反选：左键按下点（会话外），抬起位移 <4px 才触发 onpick */
  let pickDown: { x: number; y: number } | null = null;

  /**（C7 选中露出已删——2026-10-02 用户拍板：点击元素不再移动镜头）*/
  /** 路/航/河：正在绘制的路径控制点 */
  let pathDraft = $state<LonLat[] | null>(null);
  /** 正在拖动的控制点索引 */
  let dragPtIdx = $state(-1);
  /** 正在拖动的路径在 world.paths 中的索引 */
  let dragPathIdx = $state(-1);

  const isFreeLayer = $derived(isFreeLayerId(world, focusLayer));
  /** 网格底图层（baseMesh，内置 = cells）与其焦点判定：showCellMesh 单源 */
  const baseMeshLayer = $derived(world.layers.find((l) => l.baseMesh));
  const focusIsBaseMesh = $derived(
    world.layers.find((l) => l.id === focusLayer)?.baseMesh === true,
  );
  /**
   * 路径编辑：仅当 ①在路/航/河层 且 ②绘制态（工作区选中路径或已 startDraw）。
   * Esc / 退出绘制后控件消失，不能再画。
   */
  const pathEdit = $derived(isFreeLayer && drawActive);
  const pathPipeline = [pathsLayer, frameLayer];
  /** 拖点时的原曲线（虚线幽灵） */
  let dragGhostPts = $state<LonLat[] | null>(null);

  /**
   * 当前编辑的路径 = 工作区选中的那条（1 元素 : 1 曲线）。
   * 未选中且本层仅有一条时可直接编辑；多条必须先选中。
   */
  function activePathOfKind(kind: PathKind) {
    const paths = world.paths ?? [];
    if (highlightRegionId) {
      const sel = paths.find((p) => p.id === highlightRegionId);
      if (sel && sel.layerId === kind) return sel;
    }
    const kindPaths = paths.filter((p) => p.layerId === kind);
    if (kindPaths.length === 1) return kindPaths[0];
    return null;
  }

  function pathPointsOf(p: {
    points?: LonLat[];
    start?: LonLat;
    end?: LonLat;
    controls?: LonLat[];
  }): LonLat[] {
    if (p.points?.length) return p.points;
    return migrateToPathFeature(p as Record<string, unknown>).points;
  }

  function projParamsOr(): ProjectionParams {
    return projParams ?? defaultProjParams();
  }

  /** 屏幕 → 经纬（与地图同一变换；覆盖层/拾取共用） */
  function llAt(e: PointerEvent): LonLat {
    return screenToContentLonLatHelper(e);
  }

  function screenToContentLonLatHelper(e: PointerEvent): LonLat {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const pp = projParamsOr();
    return screenToContentLonLat(
      sx,
      sy,
      viewCam,
      rect.width,
      rect.height,
      contentOffsetX,
      (x, y) => unproject(x, y, projection, pp),
      (ll) => project(ll, projection, pp),
      projection,
    );
  }

  /** 投影点 → 屏幕（与地图 beginWorld 一致） */
  function toScreenXY(px: number, py: number, rect: DOMRect) {
    // 内容位移 y 依赖（罗宾森 scale(y)·Δλ）；圆柱族退化常数
    return {
      sx: worldToScreenX(px + contentOffsetAt(projection, py, contentOffsetX), viewCam, rect.width, 0),
      sy: worldToScreenY(py, viewCam, rect.height),
    };
  }

  function bestScreenInFrame(
    px: number,
    py: number,
    rect: DOMRect,
  ): { sx: number; sy: number } | null {
    const sp = toScreenXY(px, py, rect);
    if (
      sp.sx < -80 ||
      sp.sy < -80 ||
      sp.sx > rect.width + 80 ||
      sp.sy > rect.height + 80
    )
      return null;
    return sp;
  }

  function unwrapPathXY(lls: LonLat[]): { x: number; y: number }[] {
    const pp = projParamsOr();
    if (!lls.length) return [];
    const out: { x: number; y: number }[] = [];
    let prev = project(lls[0], projection, pp);
    out.push(prev);
    for (let i = 1; i < lls.length; i++) {
      const p = project(lls[i], projection, pp);
      out.push({ x: unwrapXAgainst(prev.x, p.x), y: p.y });
      prev = out[out.length - 1];
    }
    return out;
  }

  function nearestEndpoint(lon: number, lat: number): number | null {
    let best: number | null = null;
    let bestD = 0.08;
    for (const s of roadSegments) {
      for (const [cell, p] of [
        [s.a, s.pa],
        [s.b, s.pb],
      ] as const) {
        const d = Math.hypot(p.lon - lon, p.lat - lat);
        if (d < bestD) {
          bestD = d;
          best = cell;
        }
      }
    }
    return best;
  }

  /** 复制到剪贴板：Document 未聚焦时 writeText 会抛 NotAllowedError，用 execCommand 兜底 */
  async function copyTextToClipboard(text: string): Promise<void> {
    try {
      canvas?.focus?.();
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* fall through */
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      /* ignore */
    }
    ta.remove();
  }

  /** 【绘制模型】拖动中的 cell 色块高亮（零重算即时反馈）；松手后真实重算落地即清除。
   *  只存 cell id——投影在渲染时做，色块跟随相机（拖动中不预烘屏幕坐标） */
  /** 点选模态（核心格 / 特殊地块标记）激活中：画布单击要交给 onpick，**不能**被笔画劫持 */
  const pickModal = $derived(!!editor.centerPickId || !!editor.markerPick);
  let paintPreview = new Set<number>();
  let paintPreviewCommitted = false;

  function paintAt(e: PointerEvent) {
    const ll = llAt(e);
    const res = editor.paint(ll.lon, ll.lat, e.shiftKey, e.ctrlKey || e.metaKey, e.altKey, e.button);
    // 高亮集合 = **将要改变归属的格**（预告），不是半径内的全部格——
    // 已属本元素的格没有归属变化，不参与高亮（用户 2026-10-04 语义）
    if (res?.changed.length) {
      let grew = false;
      for (const id of res.changed) {
        if (!paintPreview.has(id)) {
          paintPreview.add(id);
          grew = true;
        }
      }
      if (grew) requestOverlay();
    }
    brushLon = ll.lon;
    brushLat = ll.lat;
  }

  function hitTest(e: PointerEvent) {
    const ll = llAt(e);
    const cell = pickCell(world, ll.lon, ll.lat);
    hoverId = cell?.id ?? null;
    if (cell) {
      onhover?.({
        cellId: cell.id,
        lon: ll.lon,
        lat: ll.lat,
        height: cell.height,
      });
    } else {
      onhover?.(null);
    }
    // 高度域层（editsHeight）：地块标签在覆盖层，hover 只刷 overlay
    if (editsHeightAt(world, focusLayer)) requestOverlay();
    else requestRender();
  }

  function hitControlPoint(sx: number, sy: number, rect: DOMRect) {
    if (!world.paths) return null;
    const threshold = 8;
    for (let pi = 0; pi < world.paths.length; pi++) {
      const p = world.paths[pi];
      if (p.layerId !== focusLayer) continue;
      const pts = pathPointsOf(p);
      const xys = unwrapPathXY(pts);
      for (let ci = 0; ci < xys.length; ci++) {
        const sp = bestScreenInFrame(xys[ci].x, xys[ci].y, rect);
        if (!sp) continue;
        if (Math.hypot(sp.sx - sx, sp.sy - sy) < threshold)
          return { pathIdx: pi, ptIdx: ci };
      }
    }
    return null;
  }

  /** 点落在 Catmull-Rom 曲线附近时，返回最近段 */
  function hitOnCurve(sx: number, sy: number, rect: DOMRect) {
    if (!world.paths) return null;
    const threshold = 8;
    let best: {
      pathIdx: number;
      dist: number;
      seg: number;
      t: number;
      polyLen: number;
    } | null = null;
    for (let pi = 0; pi < world.paths.length; pi++) {
      const p = world.paths[pi];
      if (p.layerId !== focusLayer) continue;
      const pts = pathPointsOf(p);
      if (pts.length < 2) continue;
      const xys = unwrapPathXY(pts);
      const poly = catmullRomPolyline(xys, 10);
      let localBest = { dist: Infinity, seg: 0, t: 0 };
      for (let i = 0; i < poly.length - 1; i++) {
        const a = bestScreenInFrame(poly[i].x, poly[i].y, rect);
        const b = bestScreenInFrame(poly[i + 1].x, poly[i + 1].y, rect);
        if (!a || !b) continue;
        const dx = b.sx - a.sx;
        const dy = b.sy - a.sy;
        const len2 = dx * dx + dy * dy || 1;
        let t = ((sx - a.sx) * dx + (sy - a.sy) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const dist = Math.hypot(a.sx + dx * t - sx, a.sy + dy * t - sy);
        if (dist < localBest.dist) localBest = { dist, seg: i, t };
      }
      if (localBest.dist <= threshold && (!best || localBest.dist < best.dist)) {
        best = {
          pathIdx: pi,
          dist: localBest.dist,
          seg: localBest.seg,
          t: localBest.t,
          polyLen: poly.length,
        };
      }
    }
    return best;
  }

  let dirty = false;
  let overlayDirty = false;
  let lastPaintRender = 0;
  let raf = 0;
  let panningLive = false;
  let zoomingLive = false;
  let zoomEndTimer = 0;

  function requestRender() {
    if (dirty) return;
    dirty = true;
    raf = requestAnimationFrame(() => {
      dirty = false;
      render();
    });
    // 兜底：rAF 被浏览器丢弃/深度节流（后台标签等）时渲染不得永久停摆
    setTimeout(() => {
      if (dirty) {
        dirty = false;
        render();
      }
    }, 250);
  }

  function resize() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    if (overlay) {
      overlay.width = canvas.width;
      overlay.height = canvas.height;
    }
    if (glCanvas) {
      glCanvas.width = canvas.width;
      glCanvas.height = canvas.height;
    }
    requestRender();
  }

  /** dpr/尺寸可能在无 resize 事件时变化（系统/浏览器缩放）——渲染前对齐 backing store，
   *  否则渲染坐标系（canvas.width/dpr）与输入坐标系（rect）错位：内容半显 + 缩放定锚漂移 */
  function syncBackingStore() {
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const wantW = Math.max(1, Math.floor(rect.width * dpr));
    const wantH = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== wantW || canvas.height !== wantH) resize();
  }

  /** 仅重绘路径控件 / 笔刷光标（不触发地图管线） */
  function requestOverlay() {
    if (overlayDirty) return;
    overlayDirty = true;
    requestAnimationFrame(() => {
      overlayDirty = false;
      renderOverlay();
    });
    setTimeout(() => {
      if (overlayDirty) {
        overlayDirty = false;
        renderOverlay();
      }
    }, 250);
  }

  function brushRadiusPx(): number {
    return Math.max(
      4,
      brushRadiusDeg * (Math.PI / 180) * cam.scale * Math.cos((brushLat * Math.PI) / 180),
    );
  }

  /**
   * 覆盖层：高度标签、路径控制点、虚线、笔刷圆。
   * 笔刷/标签移动只刷 overlay，不重绘地图。
   * 高度值：仅 高度层 + 工作区打开 + 笔刷 hover 到的 cell。
   */
  function renderOverlay() {
    if (!overlay) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, overlay.width / dpr, overlay.height / dpr);
    const rect = canvas.getBoundingClientRect();
    const toScreen = (x: number, y: number) => toScreenXY(x, y, rect);
    /**
     * 副本展开（2026-10-06 用户「跨 180° 绘制高亮也要显示在左边的地图副本上」）：
     * 反馈层（高亮/高度值）与件渲染同一副本集（worldCopyKs + 与会件同规 ±1）——
     * 每格按 k 位移 contentOffsetAt(y, contentOffsetX + k·2π) 逐一投影，
     * 跨线绘制时副本上也出高亮，与本体的无缝相接。
     */
    const pcFB = getProjCache(world, projection, projParamsOr());
    /** 逐 k 投影（与件渲染同源位移；这里 k 只用于**跨 180° 格自补**——见高亮段） */
    const toScreenK = (q: { x: number; y: number }, k: number) => {
      const off = contentOffsetAt(projection, q.y, contentOffsetX + k * Math.PI * 2);
      return {
        sx: worldToScreenX(q.x + off, viewCam, rect.width, 0),
        sy: worldToScreenY(q.y, viewCam, rect.height),
      };
    };

    // —— 【绘制模型】cell 色块高亮：拖动中即时反馈，松手后真实重算落地即清 ——
    if (paintPreview.size) {
      const ppp = projParams ?? defaultProjParams();
      // 深底上 0.38 透明金几乎看不见（2026-10-04 用户报「没有显示」）→ 提对比：
      // 填充 0.55 + 亮描边 1.2px；本层已是最上（viewport-root 内 z=2，gl=0 / 主画布=1）
      ctx.fillStyle = 'rgba(255, 208, 118, 0.55)';
      ctx.strokeStyle = 'rgba(255, 238, 168, 0.95)';
      ctx.lineWidth = 1.2;
      for (const id of paintPreview) {
        const cell = world.cells[id];
        const poly = cell?.polygon;
        if (!poly?.length) continue;
        // **逐格绘制**（2026-10-06 用户「难道就不能一个一个地块的绘制吗？」=正解）：
        // 顶点先 unwrap 连续化——跨 180° 的格其顶点本在 ±180 两侧，不连续化会投影成
        // 一条横贯屏幕的长条（前几轮「拉长/横线穿屏」的真正根因，与副本选择无关）。
        // unwrap 周期必须与件渲染（projCache）同链 = **y 依赖** periodAt(y)
        // （伪圆柱 = scale(y)·2π）：常数 2π 在罗宾森会把高纬格拉成 π 长条
        //（=「拉长半个地图」，2026-10-06 用户四轮实证）。
        const perAt = (yy: number) => projectionPeriodAt(projection, yy) ?? Math.PI * 2;
        const qs: { x: number; y: number }[] = [];
        let prevX: number | null = null;
        for (const ll of poly) {
          const q = project(ll, projection, ppp);
          const x: number = prevX === null ? q.x : unwrapXAgainst(prevX, q.x, perAt(q.y));
          qs.push({ x, y: q.y });
          prevX = x;
        }
        // 连续化后 x 可能越出 ±π（跨线格）：补画平移 ±2π 的同一格（=180° 线另一侧的
        // 那一半、无缝相接）；非跨线格的平移份落在屏外不出现
        for (const k of [-1, 0, 1]) {
          const p = new Path2D();
          for (let i = 0; i < qs.length; i++) {
            const s = toScreenK(qs[i], k);
            if (i === 0) p.moveTo(s.sx, s.sy);
            else p.lineTo(s.sx, s.sy);
          }
          p.closePath();
          ctx.fill(p);
          ctx.stroke(p);
        }
      }
    }

    // —— 地块高度值（仅笔刷覆盖到的 cell） ——
    const showHLabels =
      editsHeightAt(world, focusLayer) &&
      workspaceOpen &&
      brushHover &&
      drawActive &&
      !pathEdit;
    if (showHLabels) {
      const drawHLabel = (sx: number, sy: number, text: string, strong: boolean) => {
        ctx.font = strong ? '600 12px sans-serif' : '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(text).width;
        const bh = strong ? 16 : 13;
        ctx.fillStyle = strong ? 'rgba(20,22,28,0.72)' : 'rgba(12,14,20,0.45)';
        ctx.fillRect(sx - tw / 2 - 3, sy - bh / 2, tw + 6, bh);
        ctx.fillStyle = strong ? '#ffe68c' : 'rgba(235,240,245,0.88)';
        ctx.fillText(text, sx, sy);
      };
      const pc = getProjCache(world, projection, projParamsOr());
      const brushR = brushRadiusPx();
      // 笔刷圈内 cell 才标高度（与 hover 光标一致，不扫全图）
      const hits = cellsInBrush(world, brushLon, brushLat, brushRadiusDeg);
      for (const id of hits) {
        const cell = world.cells[id];
        if (!cell) continue;
        const isHover = hoverId === cell.id;
        const x = pc.centers[cell.id * 2];
        const y = pc.centers[cell.id * 2 + 1];
        if (!Number.isFinite(x)) continue;
        const label = cell.height.toFixed(2);
        // 单点本体投影（逐格；中心越界时自然落在 180° 线另一侧）；圈外兜底保留
        const sp = toScreenK({ x, y }, 0);
        if (
          sp.sx < -8 ||
          sp.sy < -8 ||
          sp.sx > rect.width + 8 ||
          sp.sy > rect.height + 8
        )
          continue;
        if (Math.hypot(sp.sx - brushSx, sp.sy - brushSy) > brushR * 1.15 && !isHover) continue;
        drawHLabel(sp.sx, sp.sy, label, isHover);
      }
    }

    // 笔刷：光标位置（与 cell 无关，不进地图管线）
    if (drawActive && !pathEdit && brushHover) {
      ctx.beginPath();
      ctx.arc(brushSx, brushSy, brushRadiusPx(), 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(240,195,106,0.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 路径控制点（仅绘制态；退出后消失）
    if (!pathEdit) return;
    const kind = focusLayer as PathKind;
    const path = activePathOfKind(kind);
    const list: { pts: LonLat[]; pi: number }[] = [];
    if (path && world.paths) {
      list.push({ pts: pathPointsOf(path), pi: world.paths.indexOf(path) });
    }
    if (pathDraft && pathDraft.length >= 1) {
      list.push({ pts: pathDraft, pi: -1 });
    }


    // 拖点时：原曲线 → 虚线幽灵
    if (dragGhostPts && dragGhostPts.length >= 2) {
      const gxy = unwrapPathXY(dragGhostPts);
      const gpoly = catmullRomPolyline(gxy, 10);
      if (gpoly.length >= 2) {
        const s0 = toScreen(gpoly[0].x, gpoly[0].y);
        ctx.beginPath();
        ctx.moveTo(s0.sx, s0.sy);
        for (let i = 1; i < gpoly.length; i++) {
          const sp = toScreen(gpoly[i].x, gpoly[i].y);
          ctx.lineTo(sp.sx, sp.sy);
        }
        ctx.strokeStyle = 'rgba(180,190,200,0.55)';
        ctx.lineWidth = 1.4;
        ctx.setLineDash([6, 4]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    for (const item of list) {
      const xys = unwrapPathXY(item.pts);
      const poly = item.pts.length >= 2 ? catmullRomPolyline(xys, 10) : xys;
      const isDragged =
        item.pi >= 0 && dragPathIdx === item.pi && dragGhostPts != null;
      // 拖动中：当前曲线实线；地图层已隐藏该路径，避免与幽灵叠线
      if (poly.length >= 2) {
        ctx.beginPath();
        const s0 = toScreen(poly[0].x, poly[0].y);
        ctx.moveTo(s0.sx, s0.sy);
        for (let i = 1; i < poly.length; i++) {
          const sp = toScreen(poly[i].x, poly[i].y);
          ctx.lineTo(sp.sx, sp.sy);
        }
        ctx.strokeStyle = isDragged ? 'rgba(240,195,106,0.95)' : 'rgba(240,195,106,0.8)';
        ctx.lineWidth = isDragged ? 2 : 1.5;
        ctx.setLineDash(pathDraft && item.pi < 0 ? [5, 4] : []);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      for (let ci = 0; ci < xys.length; ci++) {
        const sp = toScreen(xys[ci].x, xys[ci].y);
        if (poly.length >= 2) {
          let best = { dist: Infinity, px: 0, py: 0 };
          for (let i = 0; i < poly.length - 1; i++) {
            const a = toScreen(poly[i].x, poly[i].y);
            const b = toScreen(poly[i + 1].x, poly[i + 1].y);
            const dx = b.sx - a.sx;
            const dy = b.sy - a.sy;
            const len2 = dx * dx + dy * dy || 1;
            let tt = ((sp.sx - a.sx) * dx + (sp.sy - a.sy) * dy) / len2;
            tt = Math.max(0, Math.min(1, tt));
            const px = a.sx + dx * tt;
            const py = a.sy + dy * tt;
            const dist = Math.hypot(px - sp.sx, py - sp.sy);
            if (dist < best.dist) best = { dist, px, py };
          }
          if (Number.isFinite(best.dist) && best.dist > 0.5) {
            ctx.beginPath();
            ctx.setLineDash([3, 3]);
            ctx.strokeStyle = 'rgba(240,195,106,0.5)';
            ctx.lineWidth = 1;
            ctx.moveTo(sp.sx, sp.sy);
            ctx.lineTo(best.px, best.py);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
        const dragging = dragPathIdx === item.pi && dragPtIdx === ci;
        const isEnd = ci === 0 || ci === xys.length - 1;
        ctx.beginPath();
        ctx.arc(sp.sx, sp.sy, dragging ? 7 : isEnd ? 6 : 5, 0, Math.PI * 2);
        ctx.fillStyle = dragging
          ? '#f0c36a'
          : isEnd
            ? 'rgba(255,255,255,0.95)'
            : 'rgba(240,195,106,0.95)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }
    }
  }

  // 切层顺滑：世界稳定后预热各层件几何（环/样条/三角化/Path2D），切层命中缓存。
  // warmDone=false 期间为「首启渐现」（冷件跳过）；完成后同步重建，件不得消失。
  let warmTimer = 0;
  let warmDone = false;
  function scheduleWarm() {
    warmDone = false;
    onwarm?.(false);
    clearTimeout(warmTimer);
    warmTimer = setTimeout(() => {
      if (!canvas || !world.cells.length) {
        // 没有可预热的内容 = 不在预热（否则状态栏会永远停在「预热中…」）
        warmDone = true;
        onwarm?.(true);
        return;
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const gl = ensureMapGl();
      warmLayerGeometry(
        ctx,
        world,
        viewCam,
        dpr,
        {
          focusLayer,
          focusLayerId: focusLayer,
          projection,
          projParams,
          styleId,
          displayPieces: undefined,
          forceLayerId,
          showCellMesh: false,
          styleOf: (id: string) => resolveLayerStyle(world, id, styleById(styleId)),
        },
        world.layers.map((l) => l.id),
        (pieces) => gl?.prime(pieces),
        () => {
          warmDone = true;
          onwarm?.(true);
          requestRender();
        },
      );
    }, 600);
  }

  // GL 直绘场景：惰性创建（显示面板切到 GPU 才建）；失败/异常整帧回退 Canvas2D（显示不降级）
  let mapGl: MapGlRenderer | null = null;
  /** 致命：连续 3 次创建失败（上下文活着也不行）→ 强提示；仍低频自试 */
  let mapGlFailed = $state(false);
  /** 瞬态：上下文丢失恢复中 / 初始化冷却中 → 弱提示（2026-10-01 还债步骤 2） */
  let glTransient = $state(false);
  let glRetryN = 0;
  let mapGlRetryAt = 0;
  /**
   * GL 生命周期（还债步骤 2：单点黑屏 → 自愈路径）：
   * - 上下文丢失：renderer 标 dead+failed（preventDefault 已在 renderer）→ 本函数每帧探测
   *   `isContextLost()`，丢失期间只出「恢复中」提示，不累计失败；
   * - 上下文恢复：换**全新实例**重建全部 GL 资源（程序/缓冲/纹理随旧上下文作废，重建即自愈）；
   * - 初始化失败：2s 冷却重试，连续 3 次 → 致命提示；任何时候创建成功即复位。
   */
  function ensureMapGl(): MapGlRenderer | null {
    if (!glCanvas) return null;
    // ⚠ 绝不能在 renderer 创建前 `getContext('webgl2')`：**首次调用者决定上下文属性**，
    // 无参 probe 曾以默认属性建出 alpha/depth=true、stencil=false 的上下文 → renderer 的
    // stencil:true 被静默忽略 → 轮廓 stencil/evenodd 填色掩码全废 = 渲染错乱（2026-10-01）。
    // 丢失判定改用 renderer 自带 gl（isLost()），创建路径只走 MapGlRenderer.create。
    if (mapGl) {
      if (mapGl.isLost()) {
        if (!glTransient) glTransient = true;
        mapGl.dead = true;
        mapGl.failed = true;
        return null;
      }
      if (mapGl.ok) {
        if (glTransient) glTransient = false;
        return mapGl;
      }
    }
    const now = performance.now();
    if (mapGl && now < mapGlRetryAt) {
      // 实例 failed 但上下文活着：冷却期内等待
      if (!glTransient && !mapGlFailed) glTransient = true;
      return null;
    }
    // 创建/重建（含丢失恢复后的换新实例）
    mapGl = MapGlRenderer.create(glCanvas);
    if (mapGl) {
      if (mapGlFailed || glTransient) {
        mapGlFailed = false;
        glTransient = false;
      }
      glRetryN = 0;
      return mapGl;
    }
    glRetryN += 1;
    mapGlRetryAt = now + (glRetryN >= 3 ? 5000 : 2000);
    if (glRetryN >= 3) {
      mapGlFailed = true;
      glTransient = false;
    } else {
      glTransient = true;
    }
    return null;
  }

  // GL 丢失/恢复要**主动触发重绘**（2026-10-01 还债步骤 2）：渲染是命令式驱动，
  // 不挂监听的话恢复后没有任何 requestRender，画面会停到下次交互才自愈。
  $effect(() => {
    const c = glCanvas;
    if (!c) return;
    const onLost = () => {
      glTransient = true;
      if (mapGl) {
        mapGl.dead = true;
        mapGl.failed = true;
      }
      requestRender();
    };
    const onRestored = () => {
      // 下一帧 ensureMapGl 探测 isContextLost()=false → 换全新实例重建资源
      glTransient = true;
      requestRender();
    };
    c.addEventListener('webglcontextlost', onLost);
    c.addEventListener('webglcontextrestored', onRestored);
    return () => {
      c.removeEventListener('webglcontextlost', onLost);
      c.removeEventListener('webglcontextrestored', onRestored);
    };
  });

  /** 指针捕获对已释放/合成指针抛 NotFoundError——不得炸穿 handler（运行时错误见一例修一例） */
  function capturePointer(c: HTMLCanvasElement, id: number) {
    try {
      c.setPointerCapture(id);
    } catch {
      /* 捕获失败不影响拖动状态机 */
    }
  }
  function releasePointer(c: HTMLCanvasElement, id: number) {
    try {
      if (c.hasPointerCapture?.(id)) c.releasePointerCapture(id);
    } catch {
      /* 同上 */
    }
  }

  function render() {
    if (!canvas) return;
    syncBackingStore();
    // 二期：笔刷 Δ → 件环就地补丁（O(|Δ|·deg + 受牵连环)），渲染层持有投影器故在此消费
    // （5-a：队列抽为 patchQueues 模块，渲染不再反向 import store 私有队列）
    const deltas = consumeHeightDeltas();
    if (deltas?.length) {
      for (const d of deltas) {
        patchPieceEntry(
          world,
          `piece:${d.layerId}:${d.regionId}:0`,
          projection,
          (ll) => project(ll, projection, projParams ?? defaultProjParams()),
          d.added,
          d.removed,
        );
      }
    }
    // 成员笔刷提交的定向失效（守「全清/补丁」不变量）
    const invs = consumePieceInvalidations();
    if (invs?.length) {
      for (const prefix of invs) invalidatePieceEntries(prefix);
    }
    // 松手重算已落地 → 清色块高亮（元素由真实件接替出现）
    if (paintPreviewCommitted) {
      paintPreviewCommitted = false;
      if (paintPreview.size) {
        paintPreview = new Set();
        requestOverlay();
      }
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    // 统一接口：选中 ≡ 显示；无图层特殊性
    const displayPieces = pathEdit
      ? undefined
      : composeShownPieces(world, focusLayer, highlightRegionId, forceLayerId);
    // 成员对账补丁（手感批 2026-10-04）：本次数据修订内一次——已缓存件与**合成件
    // cellIds**（唯一显示真相，含区间型累积/父切片）的 Δ 就地补上（替代 touch* 的
    // 全清，全清=重建长帧闪屏）。必须在 compose 之后：期望集吃 dp.cellIds。
    reconcilePieceMembership(
      world,
      projection,
      (ll) => project(ll, projection, projParams ?? defaultProjParams()),
      displayPieces,
    );
    drawWorld(ctx, world, viewCam, hoverId, dpr, {
      focusLayer,
      focusLayerId: focusLayer,
      highlightRegionId,
      projection,
      projParams,
      styleId,
      showLabels: !panningLive && !zoomingLive && !pathEdit,
      contentOffsetX,
      pipeline: pathEdit ? pathPipeline : undefined,
      singleWorldCopy: pathEdit,
      displayPieces,
      forceLayerId,
      isDragging: panningLive || zoomingLive,
      glScene: ensureMapGl() ?? undefined,
      onGeometryReady: requestRender,
      progressiveBoot: !warmDone,
      styleOf: (id: string) => resolveLayerStyle(world, id, styleById(styleId)),
      borderStyle: focusLayer ? resolveLayerStyle(world, focusLayer) : undefined,
      showCellMesh: focusIsBaseMesh || (baseMeshLayer?.visible ?? false),
      hidePathId:
        pathEdit && dragPathIdx >= 0 && world.paths?.[dragPathIdx]
          ? world.paths[dragPathIdx].id
          : null,
    });
    // GPU 填充已在 drawPreparedElement 内按绘制序合成进 2d，这里不再叠加。
    renderOverlay();
  }

  let brushLon = 0;
  let brushLat = 0;
  /** 笔刷视觉位置 = 鼠标屏幕坐标（不把鼠标再投影回地图） */
  let brushSx = 0;
  let brushSy = 0;
  let brushHover = false;

  onMount(() => {
    resize();
    bindCanvas?.(canvas);
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    // dpr 变化（系统/浏览器缩放）不触发 ResizeObserver；补 matchMedia 监听
    let dprMq: MediaQueryList | null = null;
    let dprHandler: (() => void) | null = null;
    const watchDpr = () => {
      const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      const onChange = () => {
        resize();
        mq.removeEventListener('change', onChange);
        watchDpr();
      };
      mq.addEventListener('change', onChange);
      dprMq = mq;
      dprHandler = onChange;
    };
    watchDpr();
    // 禁止画布上弹出浏览器右键菜单（右键用于拖地图内容）
    const stopCtx = (ev: Event) => {
      ev.preventDefault();
      ev.stopPropagation();
    };
    canvas.addEventListener('contextmenu', stopCtx);
    canvas.addEventListener('dragstart', stopCtx);
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown = true;
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (dprMq && dprHandler) dprMq.removeEventListener('change', dprHandler);
      canvas.removeEventListener('contextmenu', stopCtx);
      canvas.removeEventListener('dragstart', stopCtx);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  });

  $effect(() => {
    // world 身份 = 任何数据触碰（笔刷提交/撤销/显隐/样式）→ 必须重绘；
    // 否则数据已变、屏幕停在旧帧（"改了颜色不变，切一下图层才对"）
    void world;
    void focusLayer;
    void highlightRegionId;
    void drawActive;
    void drawTool;
    void pathEdit;
    void pathDraft;
    void roadSegments.length;
    void projection;
    void projParams;
    void styleId;
    void cam.scale;
    void centerBias; /* 面板开合 → 偏置变 → 立即重绘（viewCam 随动） */
    void forceLayerId; /* 绘制模式强制显示 → 随动重绘 */
    onzoom?.(cam.scale / 180);
    requestRender();
    requestOverlay();
  });

  // 预热只跟「世界令牌」（seed+cellCount：载入/生成才变）。
  // 严禁挂在 world 对象身份上——笔刷每 tick 都会 {...world} 换新对象，
  // 预热会被反复触发并在松手后连续阻塞主线程（4s 冻结的真凶）。
  $effect(() => {
    void world.meta.seed;
    void world.cells.length;
    scheduleWarm();
  });

  // hover 只刷覆盖层（高度标注/笔刷反馈）；地图管线无 hover 消费者，不重绘
  $effect(() => {
    void hoverId;
    requestOverlay();
  });

</script>

<div class="viewport-root" bind:this={viewportRoot} class:draw={drawActive && !pathEdit} class:path-edit={pathEdit}>
  <!-- GL 直绘层：bg/cellsMesh/元素三通道，最底（GL 唯一后端） -->
  <canvas class="gl" bind:this={glCanvas}></canvas>
  {#if mapGlFailed}
    <div class="gl-fail">GPU 渲染不可用（WebGL2 初始化失败）——地块与元素暂缺，路径/标注/图框仍可用；将持续低频重试。</div>
  {:else if glTransient}
    <div class="gl-fail">GPU 上下文丢失，恢复中…（路径/标注/图框仍可用）</div>
  {/if}
  <canvas
    bind:this={canvas}
    oncontextmenu={(e) => e.preventDefault()}
    style="position:relative;z-index:1;touch-action:none;user-select:none;-webkit-user-select:none;"
    ondblclick={(e) => {
      // 双击结束路径草稿（≥2 点时提交为正式路径）——1-b：经 withPaths 入栈
      if (!isFreeLayer || !pathDraft || pathDraft.length < 2) return;
      const kind = focusLayer as PathKind;
      const draft = pathDraft;
      editor.withPaths('创建路径', () => {
        const w = editor.world!;
        if (!w.paths) w.paths = [];
        const feat = createPathFeature(kind, draft);
        w.paths = w.paths.filter((x) => x.id !== `draft-${kind}`);
        w.paths.push(feat);
      });
      pathDraft = null;
      requestRender();
    }}
    onpointerdown={(e) => {
      // 中键：平移；Shift+中键：复制 `#id`（无弹窗；文档未聚焦时用 textarea 兜底）
      if (e.button === 1) {
        if (e.shiftKey) {
          e.preventDefault();
          const ll = llAt(e);
          const cell = pickCell(world, ll.lon, ll.lat);
          if (cell) {
            void copyTextToClipboard(`#${cell.id}`);
            hoverId = cell.id;
            onhover?.({
              cellId: cell.id,
              lon: ll.lon,
              lat: ll.lat,
              height: cell.height,
            });
            requestRender();
          }
          return;
        }
        e.preventDefault();
        panning = true;
        panningLive = true;
        lastX = e.clientX;
        lastY = e.clientY;
        capturePointer(canvas, e.pointerId);
        return;
      }
      // 右键：拖动地图内容相对于矩形的偏移
      if (e.button === 2) {
        panningMode = 'content';
        lastX = e.clientX;
        lastY = e.clientY;
        capturePointer(canvas, e.pointerId);
        e.preventDefault();
        return;
      }
      // 左键：绘制态下画；路/航/河层用控制点绘制
      if (e.button === 0 && (drawActive || pathEdit) && !spaceDown && !pickModal) {
        if (pathEdit) {
          const rect = canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const kind = focusLayer as PathKind;
          // world.paths 可选（无路径世界）：路径编辑分支必须有 paths 才能继续
          const paths = world.paths;
          if (!paths) {
            editor.status = '请在右侧工作区 ➕ 新建，或选中一条路径再绘制';
            return;
          }

          /** 只编辑工作区当前选中的路径（1 元素 = 1 条曲线） */
          let path = activePathOfKind(kind);
          const pathPoints = () => (path ? pathPointsOf(path) : []);

          const projectOnto = (pts: LonLat[], cx: number, cy: number) => {
            const xys = unwrapPathXY(pts);
            const poly = catmullRomPolyline(xys, 10);
            let best = { dist: Infinity, seg: 0, t: 0 };
            for (let i = 0; i < poly.length - 1; i++) {
              const a = bestScreenInFrame(poly[i].x, poly[i].y, rect);
              const b = bestScreenInFrame(poly[i + 1].x, poly[i + 1].y, rect);
              if (!a || !b) continue;
              const dx = b.sx - a.sx;
              const dy = b.sy - a.sy;
              const len2 = dx * dx + dy * dy || 1;
              let tt = ((cx - a.sx) * dx + (cy - a.sy) * dy) / len2;
              tt = Math.max(0, Math.min(1, tt));
              const dist = Math.hypot(a.sx + dx * tt - cx, a.sy + dy * tt - cy);
              if (dist < best.dist) best = { dist, seg: i, t: tt };
            }
            return best;
          };

          // 点中任意本层控件：优先切到那条路径再操作
          const hit = hitControlPoint(sx, sy, rect);
          if (hit && paths[hit.pathIdx]?.layerId === kind) {
            const hitPath = paths[hit.pathIdx];
            if (e.shiftKey) {
              editor.withPaths('删除控制点', () => {
                const hp = editor.world!.paths![hit.pathIdx];
                if (hp) hp.points = deleteControlPoint(pathPointsOf(hp), hit.ptIdx);
              });
              requestRender();
              return;
            }
            dragGhostPts = pathPointsOf(hitPath).map((q) => ({ ...q }));
            dragPathIdx = hit.pathIdx;
            dragPtIdx = hit.ptIdx;
            editor.beginPathsDrag(); // 拖动会话：up 时 commitPathsDrag 一条命令
            // 点到哪条就编辑哪条
            if (highlightRegionId !== hitPath.id) {
              editor.selectedRegionId = hitPath.id;
              editor.draw = { ...editor.draw, targetRegionId: hitPath.id };
            }
            capturePointer(canvas, e.pointerId);
            requestOverlay();
            return;
          }

          if (!path) {
            editor.status = '请在右侧工作区 ➕ 新建，或选中一条路径再绘制';
            return;
          }

          const ll = llAt(e);
          const pts = pathPoints();

          // 空路径：前两点成直线
          if (pts.length < 2) {
            if (!pathDraft || pathDraft.length === 0) {
              pathDraft = [ll];
            } else if (pathDraft.length === 1) {
              pathDraft = [pathDraft[0], ll];
              editor.withPaths('建立路径', () => {
                path.points = [...pathDraft!];
              });
              pathDraft = null;
              dragPathIdx = paths.indexOf(path);
              dragPtIdx = 1;
              editor.beginPathsDrag();
              dragGhostPts = null;
              capturePointer(canvas, e.pointerId);
              requestRender();
            }
            return;
          }

          // 已有曲线：点在线条附近 → 投影插入（只加在当前选中的这条上）
          const h = projectOnto(pts, sx, sy);
          const pickPx = Math.max(12, (brushRadiusDeg || 1.5) * cam.scale * 0.08);
          if (h.dist <= pickPx) {
            dragGhostPts = pts.map((q) => ({ ...q }));
            const { points: nextPts, index } = insertControlPointOnPath(pts, h.seg, h.t);
            editor.withPaths('添加控制点', () => {
              path.points = nextPts;
            });
            dragPathIdx = paths.indexOf(path);
            dragPtIdx = index;
            editor.beginPathsDrag();
            capturePointer(canvas, e.pointerId);
            requestRender();
          }
          return;
        }
        if (drawActive && drawTool === 'road') {
          const ll = llAt(e);
          const ep = nearestEndpoint(ll.lon, ll.lat);
          if (ep !== null) {
            dragEndpoint = ep;
            capturePointer(canvas, e.pointerId);
            editor.endpoint(ep, ll.lon, ll.lat, 'start');
            return;
          }
        }
        painting = true;
        brushHover = true;
        {
          const rect = canvas.getBoundingClientRect();
          brushSx = e.clientX - rect.left;
          brushSy = e.clientY - rect.top;
        }
        capturePointer(canvas, e.pointerId);
        paintAt(e);
      } else if (e.button === 0 && !spaceDown) {
        // C1：会话外左键 = 记下按下点；抬起时若几乎没动才算「单击」→ 反选
        pickDown = { x: e.clientX, y: e.clientY };
      }
    }}
    onpointermove={(e) => {
      // 拖动控制点
      if (dragPtIdx >= 0 && dragPathIdx >= 0 && world.paths) {
        const p = world.paths[dragPathIdx];
        if (p) {
          const ll = llAt(e);
          const pts = pathPointsOf(p);
          if (dragPtIdx >= 0 && dragPtIdx < pts.length) {
            pts[dragPtIdx] = ll;
            p.points = pts;
          }
          // 轻量重绘地图（该路径在地图层被 hidePathId 跳过）+ 覆盖层幽灵/实线
          requestRender();
          requestOverlay();
        }
        return;
      }
      if (dragEndpoint !== null) {
        const ll = llAt(e);
        editor.endpoint(dragEndpoint, ll.lon, ll.lat, 'move');
        return;
      }
      // 始终更新笔刷位置 = 鼠标屏幕坐标（绘制命中仍用 llAt）
      if (drawActive && !pathEdit) {
        const rect = canvas.getBoundingClientRect();
        brushSx = e.clientX - rect.left;
        brushSy = e.clientY - rect.top;
        const ll = llAt(e);
        brushLon = ll.lon;
        brushLat = ll.lat;
        brushHover = true;
        requestOverlay();
      }
      if (painting) {
        paintAt(e);
        requestOverlay();
        const now = performance.now();
        if (now - lastPaintRender > 90) {
          lastPaintRender = now;
          requestRender();
        }
        // 绘制中同步 hover（所有层；原仅高度层，语义层绘制时悬停信息不更新）
        {
          const ll = llAt(e);
          const cell = pickCell(world, ll.lon, ll.lat);
          hoverId = cell?.id ?? null;
          if (cell) {
            onhover?.({
              cellId: cell.id,
              lon: ll.lon,
              lat: ll.lat,
              height: cell.height,
            });
          }
        }
        return;
      }
      if (panningMode === 'content') {
        const dx = e.clientX - lastX;
        lastX = e.clientX;
        lastY = e.clientY;
        // 不 wrap：外框固定，wrap contentOffset 会让内容相对外框瞬移一个世界宽。
        // 平移 = 转动地球经度（增量运算在 planeCamera.contentPanDeltaX）。
        contentOffsetX += contentPanDeltaX(dx, cam, projection);
        requestRender();
        return;
      }
      if (panning) {
        const dx = e.clientX - lastX;
        const dy = e.clientY - lastY;
        lastX = e.clientX;
        lastY = e.clientY;
        // 不 wrap cam.x：wrap 会在拖动中把相机扔回 [-π,π]，表现为地图瞬移
        cam = panCam(cam, dx, dy);
        requestRender();
      } else {
        hitTest(e);
      }
    }}
    onpointerup={(e) => {
      if (dragPtIdx >= 0 && dragPathIdx >= 0) {
        editor.commitPathsDrag('移动控制点');
        dragPtIdx = -1;
        dragPathIdx = -1;
        dragGhostPts = null;
        requestOverlay();
        requestRender();
      }
      if (dragEndpoint !== null) {
        const ll = llAt(e);
        editor.endpoint(dragEndpoint, ll.lon, ll.lat, 'end');
        dragEndpoint = null;
      }
      if (painting) {
        editor.commitStroke();
        paintPreviewCommitted = true;
        requestOverlay();
      }
      // C1：会话外左键单击（位移 <4px）= 反选该处元素；有位移 = 只是没按稳，不动作
      if (pickDown && e.button === 0) {
        const moved = Math.hypot(e.clientX - pickDown.x, e.clientY - pickDown.y);
        pickDown = null;
        if (moved < 4 && (!drawActive || pickModal) && !pathEdit && !painting) {
          const ll = llAt(e);
          onpick?.(pickCell(world, ll.lon, ll.lat)?.id ?? null);
        }
      }
      panning = false;
      panningLive = false;
      panningMode = null;
      painting = false;
      releasePointer(canvas, e.pointerId);
      requestRender();
    }}
    onpointerleave={() => {
      if (painting) {
        editor.commitStroke();
        paintPreviewCommitted = true;
        requestOverlay();
      }
      panning = false;
      panningMode = null;
      painting = false;
      dragEndpoint = null;
      brushHover = false;
      hoverId = null;
      pickDown = null;
      onhover?.(null);
      requestRender();
    }}
    onwheel={(e) => {
      e.preventDefault();
      // Alt+滚轮：改笔刷半径
      if (e.altKey && drawActive) {
        const d = e.deltaY > 0 ? -0.15 : 0.15;
        editor.draw = { ...editor.draw, radiusDeg: Math.max(0.3, Math.min(8, brushRadiusDeg + d)) };
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      // 缩放中：低分辨率 + 关阴影
      zoomingLive = true;
      clearTimeout(zoomEndTimer);
      zoomEndTimer = setTimeout(() => {
        zoomingLive = false;
        requestRender();
      }, 150);
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      // 锚点缩放数学在 planeCamera.zoomCamAt（光标下世界点不动）：
      // 在 viewCam（偏置）空间解锚点 → 写回 raw cam（+centerBias/2/scale 还原）
      const zc = zoomCamAt(viewCam, factor, sx, sy, rect.width, rect.height);
      cam = centerBias ? { ...zc, x: zc.x + centerBias / 2 / zc.scale } : zc;
      requestRender();
    }}
  ></canvas>
  <!-- 覆盖层：笔刷光标 + 路径控制点（不触发地图重绘） -->
  <canvas
    class="ovl"
    bind:this={overlay}
    style="pointer-events:none;"
  ></canvas>
</div>

<style>
  .viewport-root {
    position: relative;
    width: 100%;
    height: 100%;
  }
  .viewport-root canvas:not(.ovl) {
    cursor: default;
  }
  /* 高度/语义笔刷：隐藏系统光标，用覆盖层圆当鼠标 */
  .viewport-root.draw canvas:not(.ovl) {
    cursor: none;
  }
  /* 路径编辑：十字准星，控制点可见 */
  .viewport-root.path-edit canvas:not(.ovl) {
    cursor: crosshair;
  }
  .viewport-root canvas.gl {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 0;
  }
  .viewport-root canvas.ovl {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 2;
  }

  .gl-fail {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #f0c36a;
    font-size: 14px;
    z-index: 3;
    pointer-events: none;
    text-align: center;
    padding: 0 24px;
  }
</style>
