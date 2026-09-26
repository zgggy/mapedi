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
  import { buildFillsForFocus, cellDisplayColor } from '../render/cellColor';
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
    onPatchAstro,
    onpaint,
    onpick,
    onstrokeend,
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
    onPatchAstro?: (patch: Partial<StarSystem>) => void;
    onpaint?: (lon: number, lat: number, shift: boolean, ctrl?: boolean) => void;
    onpick?: (lon: number, lat: number) => void;
    onstrokeend?: () => void;
  } = $props();

  let container: HTMLDivElement;
  let renderer: THREE.WebGLRenderer;
  let scene: THREE.Scene;
  let camera: THREE.PerspectiveCamera;
  let controls: OrbitControls;
  let planetRoot: THREE.Group;
  let meshHolder: THREE.Group;
  let overlay: THREE.Group;
  let contentGroup: THREE.Group;
  let pickSphere: THREE.Mesh;
  let anim = 0;
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
  let painting = false;
  let spinT = 0;

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

  /** 球面原生：cell 多边形三角扇 + 路径折线 */
  function rebuildSphereContent() {
    if (!scene || !contentGroup) return;
    clearGroup(contentGroup);

    const fills = buildFillsForFocus(world, focusLayer);
    const positions: number[] = [];
    const colors: number[] = [];
    const R = 1.001;
    for (const cell of world.cells) {
      if (cell.polygon.length < 3) continue;
      const col = new THREE.Color(cellDisplayColor(world, cell.id, focusLayer, fills));
      if (highlightRegionId) {
        const reg = world.regions.find((r) => r.id === highlightRegionId);
        if (reg?.cells.includes(cell.id)) col.lerp(new THREE.Color('#ffe68c'), 0.45);
      }
      const [cx, cy, cz] = lonLatToVec3(cell.center);
      const verts = cell.polygon.map((ll) => lonLatToVec3(ll));
      for (let i = 0; i < verts.length; i++) {
        const a = verts[i];
        const b = verts[(i + 1) % verts.length];
        positions.push(cx * R, cy * R, cz * R, a[0] * R, a[1] * R, a[2] * R, b[0] * R, b[1] * R, b[2] * R);
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

    // 路径：过点 Catmull-Rom 采样后上球（略抬高避免 z-fight）
    if (world.paths?.length) {
      for (const path of world.paths) {
        if (!path.points || path.points.length < 2) continue;
        if (focusLayer !== path.layerId && focusLayer !== 'height') continue;
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
    planetRoot = new THREE.Group();
    scene.add(planetRoot);
    meshHolder = new THREE.Group();
    planetRoot.add(meshHolder);
    contentGroup = new THREE.Group();
    meshHolder.add(contentGroup);

    /**
     * 镜头（Shift+滚轮）：**只改 FOV + 沿视线压扁**，绝不改相机距离。
     * 压扁 ellipsoid 才能在球外「看到超过半球」的地面（近 2/3）；
     * 单靠 FOV 几何上仍只见 ≤50% 球面。
     * 向上滚：FOV 变大、压扁加强 → 更多地面、内容向盘面中间收拢。
     */
    let lensFov = 45;
    let lensFlatten = 1;
    const applyLens = () => {
      camera.fov = lensFov;
      camera.updateProjectionMatrix();
      if (!planetRoot) return;
      const d = camera.position.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
      planetRoot.quaternion.copy(q);
      planetRoot.scale.set(1, 1, lensFlatten);
    };
    renderer.domElement.addEventListener(
      'wheel',
      (e: WheelEvent) => {
        if (!e.shiftKey) return;
        e.preventDefault();
        e.stopPropagation();
        const up = e.deltaY < 0;
        lensFov = Math.max(18, Math.min(150, lensFov + (up ? 6 : -6)));
        lensFlatten = Math.max(0.5, Math.min(1, lensFlatten + (up ? -0.05 : 0.05)));
        applyLens();
      },
      { passive: false, capture: true },
    );
    applyLens();

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
      if (lensFlatten < 0.999) applyLens();
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
