<script lang="ts">
  /**
   * 球面视图：**球面原生渲染**。
   * 数据本身就是 lon/lat → 直接 lonLatToVec3 上球，不经 2D 平面再贴图。
   * 内容：地块网格（cellColor）+ 路径折线 + 轴/黄道示意。
   * 参数在顶栏 TopBar，本组件无 HUD。
   */
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
  import type { ClimateParams, World } from '../core/types';
  import { lonLatToVec3 } from '../core/sphere';
  import { composeShownPieces, isLayerShown } from '../core/displayCompose';
  import { catmullRomPolyline } from '../core/paths';
  import { syncHomeFromClimate, type StarSystem } from '../core/astro';

  let {
    world,
    focusLayer = 'cells',
    drawActive = false,
    rev = 0,
    climate,
    astro,
    styleId = 'dark',
    reliefSmooth = 0,
    highlightRegionId = null as string | null,
    showAxis = true,
    showEcliptic = true,
    spinPreview = true,
    fov = 45,
    onPatchAstro,
    onpaint,
    onpick,
    onstrokeend,
    onFov,
  }: {
    world: World;
    focusLayer?: string;
    drawActive?: boolean;
    rev?: number;
    climate?: ClimateParams;
    astro?: StarSystem;
    styleId?: string;
    reliefSmooth?: number;
    highlightRegionId?: string | null;
    showAxis?: boolean;
    showEcliptic?: boolean;
    spinPreview?: boolean;
    /** 相机视野（度）；Shift+滚轮 调整后经 onFov 回写（单源=父状态） */
    fov?: number;
    onPatchAstro?: (patch: Partial<StarSystem>) => void;
    onpaint?: (lon: number, lat: number, shift: boolean, ctrl?: boolean) => void;
    onpick?: (lon: number, lat: number) => void;
    onstrokeend?: () => void;
    onFov?: (v: number) => void;
  } = $props();

  let container: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let lensRoot: THREE.Group;
  let planetRoot: THREE.Group;
  let meshHolder: THREE.Group;
  let overlay: THREE.Group;
  let contentGroup: THREE.Group;
  let pickSphere: THREE.Mesh;
  let anim = 0;
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  let painting = false;
  let spinT = 0;
  /** onMount 内挂接的 FOV 应用器（外部 prop → 镜头） */
  let applyFov: ((v: number) => void) | null = null;

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

  /** 球面原生：cell 多边形三角扇（显示碎片着色）+ 元素边界线 + 路径折线 */
  function rebuildSphereContent() {
    if (!scene || !contentGroup) return;
    clearGroup(contentGroup);

    // 显示碎片 = 平面同一套（显隐唯一开关 layer.visible；叠放 = composeShownPieces 序）
    const pieces = composeShownPieces(world, focusLayer, highlightRegionId);
    const fillOf = new Map<number, string>();
    const pieceOf = new Map<number, number>();
    for (const [pi, p] of pieces.entries()) {
      // 不透明度预乘进颜色（球面三角扇为不透明材质；与平面「透明叠色」观感等价合成）
      const base = new THREE.Color(p.color);
      const op = p.opacity ?? 0.88;
      const mix = base.clone().lerp(new THREE.Color('#1a3348'), 1 - op);
      const hex = `#${mix.getHexString()}`;
      for (const id of p.cellIds) {
        fillOf.set(id, hex);
        pieceOf.set(id, pi);
      }
    }

    const positions: number[] = [];
    const colors: number[] = [];
    const R = 1.001;
    for (const cell of world.cells) {
      if (cell.polygon.length < 3) continue;
      const hit = fillOf.get(cell.id);
      const col = new THREE.Color(hit ?? (cell.isOcean ? '#1a3348' : '#c4a882'));
      if (highlightRegionId) {
        const reg = world.regions.find((r) => r.id === highlightRegionId);
        if (reg?.cells.includes(cell.id)) col.lerp(new THREE.Color('#ffe68c'), 0.45);
      }
      const [cx, cy, cz] = lonLatToVec3(cell.center);
      const verts = cell.polygon.map((ll) => lonLatToVec3(ll));
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % verts.length];
        positions.push(cx * R, cy * R, cz * R, a[0] * R, a[1] * R, b[0] * R, b[1] * R, b[2] * R);
        for (let k = 0; k < 3; k++) colors.push(col.r, col.g, col.b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    contentGroup.add(
      new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
      ),
    );

    // 海球底
    const sea = new THREE.Mesh(
      new THREE.SphereGeometry(0.998, 48, 32),
      new THREE.MeshBasicMaterial({ color: '#1a3348' }),
    );
    contentGroup.add(sea);

    // 元素边界：成员/非成员共享边（同一 cellSet 真相），过边中点的折线段（球面侧的「过边中点」）
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
        const c = new THREE.Color(pieces[top].color).multiplyScalar(0.7);
        const m = lonLatToVec3({
          lon: (pa.lon + pb.lon) / 2,
          lat: (pa.lat + pb.lat) / 2,
        });
        const a = lonLatToVec3(pa);
        const b = lonLatToVec3(pb);
        for (const [u, v] of [
          [a, m],
          [m, b],
        ] as const) {
          bp.push(u[0] * 1.003, u[1] * 1.003, u[2] * 1.003, v[0] * 1.003, v[1] * 1.003, v[2] * 1.003);
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

    // 路径：过点 Catmull-Rom 采样后上球（略抬高避免 z-fight）
    if (world.paths?.length) {
      for (const path of world.paths) {
        if (!path.points || path.points.length < 2) continue;
        if (path.hidden || !isLayerShown(world, path.layerId, focusLayer)) continue;
        const lonlat = path.points;
        const flat: { x: number; y: number; z: number }[] = [];
        for (const ll of lonlat) {
          const v = lonLatToVec3(ll);
          flat.push({ x: v[0], y: v[1], z: v[2] });
        }
        // 在球面上对向量做 Catmull-Rom 再归一化
        const cr = catmullRomPolyline(flat, 8);
        const pts: number[] = [];
        for (const q of cr) {
          const len = Math.hypot(q.x, q.y, q.z) || 1;
          const s = 1.004;
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
    if (!overlay || !planetRoot) return;
    clearGroup(overlay);
    const tilt = (tiltDeg * Math.PI) / 180;
    planetRoot.rotation.z = -tilt;

    if (showAxis) {
      // 自转轴沿球体本地 ±Y（在显示约定里北在下，轴仍是球体极轴）
      const geo = new THREE.BufferGeometry();
      geo.setAttribute(
        'position',
        new THREE.Float32BufferAttribute([0, -1.35, 0, 0, 1.35, 0], 3),
      );
      overlay.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#e8ecf1' })));
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
      // 赤道随倾角
      eqLine.rotation.z = -tilt;
      overlay.add(eqLine);
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
      overlay.add(disc);
    }
  }

  function scheduleRebuild() {
    clearTimeout(rebuildTimer);
    rebuildTimer = setTimeout(() => {
      if (drawActive) return;
      rebuildSphereContent();
    }, 40);
  }

  function hitLonLat(e: PointerEvent) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObject(pickSphere, false);
    if (!hits.length) return null;
    const p = hits[0].point.clone();
    pickSphere.worldToLocal(p);
    p.normalize();
    // 与 lonLatToVec3 一致：东=+X，北=−Y，lon0=+Z
    return {
      lon: (Math.atan2(p.x, p.z) * 180) / Math.PI,
      lat: (-Math.asin(THREE.MathUtils.clamp(p.y, -1, 1)) * 180) / Math.PI,
    };
  }

  $effect(() => {
    void rev;
    void focusLayer;
    void highlightRegionId;
    void drawActive;
    scheduleRebuild();
  });

  $effect(() => {
    void showAxis;
    void showEcliptic;
    void tiltDeg;
    if (scene) rebuildOverlays();
  });

  // 外部 FOV（顶栏滑块）→ 镜头；Shift+滚轮 经 onFov 回写父状态（单源）
  $effect(() => {
    if (fov >= 18) applyFov?.(fov);
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
    // 默认镜头看向 +Z（lon=0），与地图「中间是本初子午线」一致
    camera.position.set(0.2, 0.35, 2.35);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.12;
    controls.maxDistance = 6;
    controls.enablePan = false;
    controls.target.set(0, 0, 0);
    scene.add(new THREE.AmbientLight(0xffffff, 1));

    overlay = new THREE.Group();
    scene.add(overlay);
    // lensRoot 只承载「超半球压扁」镜头特效（对准相机的压扁变换），
    // planetRoot 保倾角——两者解耦：调 FOV/倾角不再互相打乱
    lensRoot = new THREE.Group();
    scene.add(lensRoot);
    planetRoot = new THREE.Group();
    lensRoot.add(planetRoot);
    meshHolder = new THREE.Group();
    planetRoot.add(meshHolder);
    contentGroup = new THREE.Group();
    meshHolder.add(contentGroup);

    /**
     * 镜头（Shift+滚轮 / 顶栏「视野」滑块）：**只改 FOV**，绝不改相机距离与球体姿态。
     * Shift+滚轮额外做「沿视线压扁」：压扁 ellipsoid 才能在球外「看到超过半球」的地面；
     * 单靠 FOV 几何上仍只见 ≤50% 球面。压扁只作用于 lensRoot（planetRoot 倾角不动）。
     * 向上滚：FOV 变大、压扁加强 → 更多地面、内容向盘面中间收拢。
     * FOV 单源 = 父状态（fov prop / onFov 回写）。
     */
    let lensFov = Math.max(18, Math.min(150, fov));
    let lensFlatten = 1;
    const applyFlatten = () => {
      if (!lensRoot) return;
      if (lensFlatten >= 0.999) {
        lensRoot.quaternion.identity();
        lensRoot.scale.set(1, 1, 1);
        return;
      }
      const d = camera.position.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      lensRoot.quaternion.copy(q);
      lensRoot.scale.set(1, 1, lensFlatten);
    };
    const applyFovOnly = () => {
      camera.fov = lensFov;
      camera.updateProjectionMatrix();
    };
    applyFov = (v: number) => {
      lensFov = Math.max(18, Math.min(150, v));
      applyFovOnly();
    };
    applyFovOnly();
    applyFlatten();
    renderer.domElement.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (!e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        const up = e.deltaY < 0;
        lensFov = Math.max(18, Math.min(150, lensFov + (up ? 6 : -6)));
        lensFlatten = Math.max(0.5, Math.min(1, lensFlatten + (up ? -0.05 : 0.05)));
        applyFovOnly();
        applyFlatten();
        onFov?.(lensFov);
      },
      { passive: false, capture: true },
    );

    pickSphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.995, 32, 16),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    planetRoot.add(pickSphere);

    rebuildSphereContent();

    const el = renderer.domElement;
    el.addEventListener('pointerdown', (e) => {
      if (!drawActive) return;
      if (e.button === 0) {
        painting = true;
        controls.enabled = false;
        const ll = hitLonLat(e);
        if (ll) onpaint?.(ll.lon, ll.lat, e.shiftKey, e.ctrlKey || e.metaKey);
      } else if (e.button === 2) {
        const ll = hitLonLat(e);
        if (ll) onpick?.(ll.lon, ll.lat);
      }
    });
    el.addEventListener('pointermove', (e) => {
      if (!painting || !drawActive) return;
      const ll = hitLonLat(e);
      if (ll) onpaint?.(ll.lon, ll.lat, e.shiftKey, e.ctrlKey || e.metaKey);
    });
    const endPaint = () => {
      if (painting) {
        painting = false;
        controls.enabled = true;
        onstrokeend?.();
      }
    };
    el.addEventListener('pointerup', endPaint);
    el.addEventListener('pointerleave', endPaint);
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    const loop = () => {
      anim = requestAnimationFrame(loop);
      if (spinPreview && meshHolder && !drawActive) {
        const dir = prograde ? 1 : -1;
        spinT += dir * (24 / Math.max(6, rotHours)) * 0.004;
        meshHolder.rotation.y = spinT;
      }
      controls.update();
      // 压扁轴始终对准相机（轨道旋转时保持「超半球」观感）
      if (lensFlatten < 0.999) applyFlatten();
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
      controls.dispose();
      renderer.dispose();
      applyFov = null;
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
