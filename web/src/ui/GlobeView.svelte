<script lang="ts">
  /**
   * 球面视图：**纯展示**（拖动转星球 / 滚轮缩放 / 自转预览）。
 * 交互终稿（2026-10-02 四修，实物地球仪模型）：**相机固定不动**——
 * 左右拖 = 星球绕自转轴自转（轴/赤道/支架=台架不随转；黄道=基准环恒水平）；
 * 上下拖 = 星球系统（球+轴+赤道+支架）绕屏幕水平轴整体翻转（黄道不随）；
 * 滚轮 = 缩放。OrbitControls 已退役（三轮「环绕参考系 vs 屏幕姿态」死结
 * 由换交互模型根治：转物体而非转相机，黄道水平与绕轴手感天然同时成立）。
   * 内容：显示碎片着色（composeShownPieces，与平面同一套图层显隐/叠放）+
   * **高度按半径凸起**（陆上凸、海下凹，光照塑形）+ 元素边界线 + 路径 + 轴/黄道。
   * 无编辑、无镜头 FOV 特效（历史教训：镜头特效耦合姿态 → 显示错乱）。
   */
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import type { ClimateParams, World } from '../core/types';
  import { lonLatToVec3 } from '../core/sphere';
  import { composeShownPieces, isLayerShown } from '../core/displayCompose';
  import { catmullRomPolyline } from '../core/paths';
  import { syncHomeFromClimate, type StarSystem } from '../core/astro';
  import { viewMemory } from './viewMemory';

  let {
    world,
    focusLayer = 'cells',
    rev = 0,
    climate,
    astro,
    highlightRegionId = null as string | null,
    showAxis = true,
    showEcliptic = true,
    spinPreview = false,
  }: {
    world: World;
    focusLayer?: string;
    rev?: number;
    climate?: ClimateParams;
    astro?: StarSystem;
    highlightRegionId?: string | null;
    showAxis?: boolean;
    showEcliptic?: boolean;
    spinPreview?: boolean;
  } = $props();

  let container: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let planetRoot: THREE.Group;
  let meshHolder: THREE.Group;
  /** 台架组：轴/赤道/支架弧——随上下翻转、**不随左右自转**（实物地球仪语义） */
  let overlay: THREE.Group;
  /** 黄道基准环组：永不旋转（黄道恒水平，2026-10-02 用户定） */
  let standGroup: THREE.Group;
  /** 星球系统组：球+台架整体绕屏幕水平轴翻转（上下拖动） */
  let tipGroup: THREE.Group;
  let contentGroup: THREE.Group;
  let anim = 0;
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  let spinT = 0;

  // —— 相机固定（四修）：只存目标点；拖动全部作用在物体上 ——
  const camTarget = new THREE.Vector3(0, 0, 0);
  /** 拖动状态与暂存（无逐事件分配） */
  let dragId: number | null = null;
  let lastX = 0;
  let lastY = 0;
  const wheelOff = new THREE.Vector3();
  const tipQ = new THREE.Quaternion();
  /** 拖动手感（rad/px）：左右=自转、上下=翻转 */
  const SPIN_K = 0.005;
  const TIP_K = 0.005;
  /** 释放惯性：指数衰减速率(/s)与停机阈值(rad/s)——拨一下继续滑行（2026-10-02 用户要回惯性） */
  const INERTIA_K = 3.0;
  const V_CUT = 0.03;
  /** 翻转极点限位：累计角到 ±90°（极点正对相机）即停，拖不过去（2026-10-02 用户定） */
  const TIP_LIMIT = Math.PI / 2;
  let spinV = 0; // 自转角速度 rad/s（释放后惯性滑行）
  let tipV = 0; // 翻转角速度 rad/s
  let tipAngle = 0; // 累计翻转角（绕固定屏幕水平轴的绝对量 → 可钳制）
  const tipAxis = new THREE.Vector3(1, 0, 0); // 屏幕水平轴（相机只缩放不改方向 → 挂载时定一次）
  let lastMoveTs = 0;
  let prevFrameTs = 0;

  const home = $derived.by(() => {
    const base = astro ?? world?.astro ?? null;
    if (!base) return null;
    return climate ? syncHomeFromClimate(base, climate).home : base.home;
  });
  const tiltDeg = $derived(climate?.axialTiltDeg ?? home?.axialTiltDeg ?? 23.4);
  const rotHours = $derived(climate?.rotationHours ?? home?.rotationHours ?? 24);
  const prograde = $derived(
    climate?.rotationPrograde ?? home?.rotationPrograde ?? true,
  );

  /** 高度 → 半径位移（陆上凸 / 海下凹）；0.045 = 相对球半径的峰高 */
  const RELIEF = 0.045;
  const radiusOf = (h: number) => 1 + (Math.max(-63, Math.min(64, h)) / 64) * RELIEF;

  function clearGroup(g: THREE.Group) {
    while (g.children.length) {
      const c = g.children[0];
      g.remove(c);
      if ((c as THREE.Mesh).geometry) (c as THREE.Mesh).geometry?.dispose?.();
      const mat = (c as THREE.Mesh).material;
      if (mat) {
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose?.());
        else (mat as THREE.Material).dispose?.();
      }
    }
  }

  /** 球面展示：显示碎片逐 cell 三角扇（半径随高度）+ 边界线 + 路径 */
  function rebuildSphereContent() {
    if (!scene || !contentGroup) return;
    clearGroup(contentGroup);

    // 显示碎片 = 平面同一套（显隐唯一开关 layer.visible；叠放 = composeShownPieces 序）
    const pieces = composeShownPieces(world, focusLayer, highlightRegionId);
    const fillOf = new Map<number, string>();
    const pieceOf = new Map<number, number>();
    for (const [pi, p] of pieces.entries()) {
      const base = new THREE.Color(p.color);
      const op = p.opacity ?? 0.88;
      const mix = base.clone().lerp(new THREE.Color('#12233a'), 1 - op);
      const hex = `#${mix.getHexString()}`;
      for (const id of p.cellIds) {
        fillOf.set(id, hex);
        pieceOf.set(id, pi);
      }
    }

    // 海球底（深度基准面）
    const sea = new THREE.Mesh(
      new THREE.SphereGeometry(1 - RELIEF * 1.02, 64, 48),
      new THREE.MeshLambertMaterial({ color: '#12294a' }),
    );
    contentGroup.add(sea);

    // cell 三角扇：角点按 cell 高度凸起（块状浮雕，cell 间有高度台阶 = 数据真实）
    const positions: number[] = [];
    const colors: number[] = [];
    const normals: number[] = [];
    for (const cell of world.cells) {
      if (cell.polygon.length < 3) continue;
      const hit = fillOf.get(cell.id);
      const col = new THREE.Color(hit ?? (cell.isOcean ? '#1a3348' : '#c4a882'));
      if (highlightRegionId) {
        const reg = world.regions.find((r) => r.id === highlightRegionId);
        if (reg?.cells.includes(cell.id)) col.lerp(new THREE.Color('#ffe68c'), 0.45);
      }
      const r = radiusOf(cell.height);
      const [cx, cy, cz] = lonLatToVec3(cell.center);
      const ctr = [cx * r, cy * r, cz * r];
      const verts = cell.polygon.map((ll) => {
        const v = lonLatToVec3(ll);
        return [v[0] * r, v[1] * r, v[2] * r] as const;
      });
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % verts.length];
        positions.push(ctr[0], ctr[1], ctr[2], a[0], a[1], a[2], b[0], b[1], b[2]);
        for (let k = 0; k < 3; k++) {
          colors.push(col.r, col.g, col.b);
          normals.push(cx, cy, cz); // 球面法线（光照塑形）
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    contentGroup.add(
      new THREE.Mesh(
        geo,
        new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      ),
    );

    // 元素边界：成员/非成员共享边（同一 cellSet 真相），随高度贴表面
    if (world.sharedEdges?.size && pieceOf.size) {
      const bp: number[] = [];
      const bc: number[] = [];
      for (const [ek, [pa, pb]] of world.sharedEdges) {
        const dash = ek.indexOf('-');
        if (dash < 0) continue;
        const i = +ek.slice(0, dash);
        const j = +ek.slice(dash + 1);
        const oi = pieceOf.get(i);
        const oj = pieceOf.get(j);
        if (oi === oj) continue;
        const top = (oi ?? -1) > (oj ?? -1) ? oi : oj;
        if (top === undefined || top < 0) continue;
        const owner = (oi ?? -1) >= (oj ?? -1) ? i : j;
        const r = radiusOf(world.cells[owner]?.height ?? 0) * 1.002;
        const c = new THREE.Color(pieces[top].color).multiplyScalar(0.7);
        const a = lonLatToVec3(pa);
        const b = lonLatToVec3(pb);
        const m = { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2 };
        const ml = Math.hypot(m.x, m.y, m.z) || 1;
        for (const [u, v] of [
          [a, [m.x / ml, m.y / ml, m.z / ml]],
          [[m.x / ml, m.y / ml, m.z / ml], b],
        ] as const) {
          bp.push(u[0] * r, u[1] * r, u[2] * r, v[0] * r, v[1] * r, v[2] * r);
          bc.push(c.r, c.g, c.b, c.r, c.g, c.b);
        }
      }
      if (bp.length) {
        const bg = new THREE.BufferGeometry();
        bg.setAttribute('position', new THREE.Float32BufferAttribute(bp, 3));
        bg.setAttribute('color', new THREE.Float32BufferAttribute(bc, 3));
        contentGroup.add(
          new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ vertexColors: true })),
        );
      }
    }

    // 路径：过点 Catmull-Rom 采样后上球（贴浮雕面上方）
    if (world.paths?.length) {
      for (const path of world.paths) {
        if (!path.points || path.points.length < 2) continue;
        if (path.hidden || !isLayerShown(world, path.layerId, focusLayer)) continue;
        const flat: { x: number; y: number; z: number }[] = [];
        for (const ll of path.points) {
          const v = lonLatToVec3(ll);
          flat.push({ x: v[0], y: v[1], z: v[2] });
        }
        const cr = catmullRomPolyline(flat, 8);
        const pts: number[] = [];
        for (const q of cr) {
          const len = Math.hypot(q.x, q.y, q.z) || 1;
          const s = 1.012;
          pts.push((q.x / len) * s, (q.y / len) * s, (q.z / len) * s);
        }
        const lg = new THREE.BufferGeometry();
        lg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
        const color =
          path.layerId === 'road'
            ? '#e8c36a'
            : path.layerId === 'route'
              ? '#7ec8e3'
              : '#3d8ec9';
        contentGroup.add(
          new THREE.Line(
            lg,
            new THREE.LineBasicMaterial({ color: path.color || color }),
          ),
        );
      }
    }

    rebuildOverlays();
  }

  function rebuildOverlays() {
    if (!overlay || !planetRoot || !standGroup) return;
    clearGroup(overlay);
    clearGroup(standGroup);
    const tilt = (tiltDeg * Math.PI) / 180;
    planetRoot.rotation.z = -tilt;

    if (showAxis) {
      // 轴与赤道**同一变换**（2026-10-01 用户指正：轴 ⟂ 赤道——原轴线漏了倾斜，
      // 世界竖直的轴与倾斜 23.4° 的赤道线不垂直）。旋转后轴向 = 赤道面法向。
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, -1.35, 0, 0, 1.35, 0], 3),
      );
      const axisLine = new THREE.Line(
        geo,
        new THREE.LineBasicMaterial({ color: '#e8ecf1' }),
      );
      axisLine.rotation.z = -tilt;
      overlay.add(axisLine);
      // 赤道线
      const pts: number[] = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI * 2;
        pts.push(Math.cos(a) * 1.02, 0, Math.sin(a) * 1.02);
      }
      const eq = new THREE.BufferGeometry();
      eq.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      const eqLine = new THREE.Line(
        eq,
        new THREE.LineBasicMaterial({ color: '#7ec8e3', transparent: true, opacity: 0.65 }),
      );
      eqLine.rotation.z = -tilt;
      overlay.add(eqLine);
      // 子午支架弧（2026-10-02 四修终稿·实物模型）：镜像 C 形（凸向右、开口朝左），
      // 与轴/赤道同一 -tilt 变换 → 端点钉在自转轴两极；**挂台架组**——
      // 左右自转不随动（横拖不摆回归：支架就是台架）、上下翻转随动、
      // 相机固定 Y-up 下默认机位弧面正对屏幕（竖向中点∈屏面）。
      // 半径 1.30 > 星球(≈1.045) > 赤道线(1.02)、同款青色细线；随⚙「轴」开关。
      const arc: number[] = [];
      for (let i = 0; i <= 72; i++) {
        const a = -Math.PI / 2 + (i / 72) * Math.PI; // 南极 → 北极（凸向 +X）
        arc.push(Math.cos(a) * 1.3, Math.sin(a) * 1.3, 0);
      }
      const ag = new THREE.BufferGeometry();
      ag.setAttribute('position', new THREE.Float32BufferAttribute(arc, 3));
      const arcLine = new THREE.Line(
        ag,
        new THREE.LineBasicMaterial({ color: '#7ec8e3', transparent: true, opacity: 0.65 }),
      );
      arcLine.rotation.z = -tilt;
      overlay.add(arcLine);
    }

    if (showEcliptic) {
      const disc = new THREE.Mesh(
        new THREE.RingGeometry(1.08, 1.55, 64),
        new THREE.MeshBasicMaterial({
          color: '#c4a35c',
          transparent: true,
          opacity: 0.1,
          side: THREE.DoubleSide,
          depthWrite: false,
        }),
      );
      disc.rotation.x = -Math.PI / 2;
      // 黄道进基准环组：不随翻转、不随自转——恒水平（2026-10-02 用户定）
      standGroup.add(disc);
    }
  }

  function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => rebuildSphereContent(), 40);
  }

  $effect(() => {
    void rev;
    void focusLayer;
    void highlightRegionId;
    scheduleRebuild();
  });

  $effect(() => {
    void showAxis;
    void showEcliptic;
    void tiltDeg;
    if (scene) rebuildOverlays();
  });

  onMount(() => {
    const w = container.clientWidth || 480;
    const h = container.clientHeight || 360;
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(w, h);
    container.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(45, w / h, 0.05, 20);
    // 相机固定（四修终稿）：默认看向 +Z（lon=0），up 默认 Y → 黄道恒水平；
    // 相机只被滚轮缩放，不再环绕（拖动语义全部交给物体，见文件头）。
    camera.position.set(0.2, 0.35, 2.35);
    // 相机记忆（设计稿 §2.1-2）：球面姿态与平面相机互不覆盖
    if (viewMemory.globe) {
      const g = viewMemory.globe;
      camera.position.set(g.pos[0], g.pos[1], g.pos[2]);
      camTarget.set(g.target[0], g.target[1], g.target[2]);
    }
    camera.lookAt(camTarget);
    // 屏幕水平轴 = lookAt 后的相机右轴（up=Y）；相机此后只缩放不改方向 → 一次定死
    tipAxis.crossVectors(camera.up, wheelOff.copy(camera.position).sub(camTarget)).normalize();
    // 光照塑形：让高度凸起可读（平行光 + 弱补光）
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(2.2, 1.6, 2.6);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.42));

    // 组结构（四修）：tipGroup = 星球系统（球+台架，上下拖翻转整体）；
    // standGroup = 黄道基准环（永不转）；相机不动。
    tipGroup = new THREE.Group();
    scene.add(tipGroup);
    standGroup = new THREE.Group();
    scene.add(standGroup);
    overlay = new THREE.Group();
    tipGroup.add(overlay);
    planetRoot = new THREE.Group();
    tipGroup.add(planetRoot);
    meshHolder = new THREE.Group();
    planetRoot.add(meshHolder);
    contentGroup = new THREE.Group();
    meshHolder.add(contentGroup);

    // —— 指针交互（物体旋转模型；setPointerCapture 包 try——合成事件无活跃指针，跳过捕获即可） ——
    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0 || dragId !== null) return;
      dragId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      spinV = 0; // 抓取即接管：清掉残余惯性
      tipV = 0;
      lastMoveTs = performance.now();
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* 合成事件无活跃指针：事件仍派发在画布上，正常跟踪 */
      }
    };
    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerId !== dragId) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      // 左右 → 星球绕自转轴自转（meshHolder 局部 Y = planetRoot 倾斜后的轴；
      // 台架/黄道不随——轴、赤道、支架对自转不变，正是实物地球仪手感）
      const now = performance.now();
      const dt = Math.max(0.001, (now - lastMoveTs) / 1000);
      lastMoveTs = now;
      if (dx !== 0) {
        const dth = dx * SPIN_K;
        spinT += dth;
        meshHolder.rotation.y = spinT;
        spinV = spinV * 0.5 + (dth / dt) * 0.5; // 平滑估速，供释放惯性
      }
      // 上下 → 星球系统（球+轴+赤道+支架）绕「屏幕水平轴」翻转；黄道（standGroup）不随。
      // 累计角钳在 ±90°：极点翻到正对相机即到头，拖不过去。
      if (dy !== 0) {
        const prev = tipAngle;
        tipAngle = Math.min(TIP_LIMIT, Math.max(-TIP_LIMIT, tipAngle + dy * TIP_K));
        tipQ.setFromAxisAngle(tipAxis, tipAngle);
        tipGroup.quaternion.copy(tipQ);
        tipV = tipV * 0.5 + ((tipAngle - prev) / dt) * 0.5; // 撞限位 → applied=0 → 速度归零
      }
    };
    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerId === dragId) dragId = null;
    };
    // 滚轮 = 缩放（沿视线推拉，保留 1.12–6 限幅；相机只做这一件事）
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      wheelOff.copy(camera.position).sub(camTarget);
      const len = Math.min(6, Math.max(1.12, wheelOff.length() * Math.exp(e.deltaY * 0.0012)));
      wheelOff.setLength(len);
      camera.position.copy(camTarget).add(wheelOff);
      camera.lookAt(camTarget);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerup', onPointerUp);
    renderer.domElement.addEventListener('pointercancel', onPointerUp);
    renderer.domElement.addEventListener('wheel', onWheel, { passive: false });

    rebuildSphereContent();

    const loop = () => {
      anim = requestAnimationFrame(loop);
      const nowTs = performance.now();
      const dt = Math.min(0.05, Math.max(0, (nowTs - prevFrameTs) / 1000));
      prevFrameTs = nowTs;
      if (spinPreview && meshHolder) {
        const dir = prograde ? 1 : -1;
        spinT += dir * (24 / Math.max(6, rotHours)) * 0.004;
        meshHolder.rotation.y = spinT;
      }
      // 释放惯性（拖动中不积分：拖动由指针直驱）
      if (dragId === null) {
        if (spinV !== 0) {
          spinT += spinV * dt;
          spinV *= Math.exp(-INERTIA_K * dt);
          if (Math.abs(spinV) < V_CUT) spinV = 0;
          meshHolder.rotation.y = spinT;
        }
        if (tipV !== 0) {
          const prev = tipAngle;
          tipAngle = Math.min(TIP_LIMIT, Math.max(-TIP_LIMIT, tipAngle + tipV * dt));
          if (tipAngle !== prev) {
            tipQ.setFromAxisAngle(tipAxis, tipAngle);
            tipGroup.quaternion.copy(tipQ);
          }
          const outward =
            (tipAngle >= TIP_LIMIT && tipV > 0) || (tipAngle <= -TIP_LIMIT && tipV < 0);
          if (outward) tipV = 0; // 撞极点：惯性也停
          tipV *= Math.exp(-INERTIA_K * dt);
          if (Math.abs(tipV) < V_CUT) tipV = 0;
        }
      }
      // 相机固定（四修）：无 controls.update、无回正滚转、无逐帧弧定向——
      // 黄道水平、台架姿态全部由组结构静态保证。
      renderer.render(scene, camera);
    };
    loop();

    const onResize = () => {
      const ww = container.clientWidth;
      const hh = container.clientHeight;
      if (!ww || !hh) return;
      camera.aspect = ww / hh;
      camera.updateProjectionMatrix();
      renderer.setSize(ww, hh);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(container);

    return () => {
      cancelAnimationFrame(anim);
      clearTimeout(rebuildTimer);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointercancel', onPointerUp);
      renderer.domElement.removeEventListener('wheel', onWheel);
      const p = camera.position;
      viewMemory.globe = {
        pos: [p.x, p.y, p.z],
        target: [camTarget.x, camTarget.y, camTarget.z],
      };
      renderer.dispose();
    };
  });
</script>

<div class="globe-root" bind:this={container}></div>

<style>
  .globe-root {
    position: absolute;
    inset: 0;
    overflow: hidden;
    background: radial-gradient(ellipse at center, #0d1520 0%, #07090e 75%);
  }
  .globe-root :global(canvas) {
    display: block;
    width: 100% !important;
    height: 100% !important;
  }
</style>
