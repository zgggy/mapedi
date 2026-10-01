<script lang="ts">
  /**
   * 球面视图：**纯展示**（拖动环绕 / 滚轮缩放 / 自转预览）。
   * 内容：显示碎片着色（composeShownPieces，与平面同一套图层显隐/叠放）+
   * **高度按半径凸起**（陆上凸、海下凹，光照塑形）+ 元素边界线 + 路径 + 轴/黄道。
   * 无编辑、无镜头 FOV 特效（历史教训：镜头特效耦合姿态 → 显示错乱）。
   */
  import { onMount } from 'svelte';
  import * as THREE from 'three';
  import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
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
  let controls: OrbitControls;
  let planetRoot: THREE.Group;
  let meshHolder: THREE.Group;
  let overlay: THREE.Group;
  let contentGroup: THREE.Group;
  let anim = 0;
  let rebuildTimer: ReturnType<typeof setTimeout> | undefined;
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
    if (!overlay || !planetRoot) return;
    clearGroup(overlay);
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
      // 下弦弧：世界系（不倾斜）XZ 平面、半径 1.30 > 星球(≈1.045) > 赤道线(1.02)、
      // 同款青色细线；只画朝向相机的前半（默认机位略俯视 → 呈星球下方对称半圆 = "下弦"）。
      // 挂 overlay（非 meshHolder）→ 不随地球自转；相机环绕（鼠标拖动）时随视角转动。
      const arc: number[] = [];
      for (let i = 0; i <= 72; i++) {
        const a = (i / 72) * Math.PI; // z = sin(a) ≥ 0：前半
        arc.push(Math.cos(a) * 1.3, 0, Math.sin(a) * 1.3);
      }
      const ag = new THREE.BufferGeometry();
      ag.setAttribute('position', new THREE.Float32BufferAttribute(arc, 3));
      const arcLine = new THREE.Line(
        ag,
        new THREE.LineBasicMaterial({ color: '#7ec8e3', transparent: true, opacity: 0.65 }),
      );
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
      overlay.add(disc);
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
    // 默认镜头看向 +Z（lon=0），与地图「中间是本初子午线」一致
    camera.position.set(0.2, 0.35, 2.35);
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.minDistance = 1.12;
    controls.maxDistance = 6;
    controls.enablePan = false;
    controls.target.set(0, 0, 0);
    // 相机记忆（设计稿 §2.1-2）：球面姿态与平面相机互不覆盖
    if (viewMemory.globe) {
      const g = viewMemory.globe;
      camera.position.set(g.pos[0], g.pos[1], g.pos[2]);
      controls.target.set(g.target[0], g.target[1], g.target[2]);
      controls.update();
    }
    // 光照塑形：让高度凸起可读（平行光 + 弱补光）
    const sun = new THREE.DirectionalLight(0xffffff, 1.15);
    sun.position.set(2.2, 1.6, 2.6);
    scene.add(sun);
    scene.add(new THREE.AmbientLight(0xffffff, 0.42));

    overlay = new THREE.Group();
    scene.add(overlay);
    planetRoot = new THREE.Group();
    scene.add(planetRoot);
    meshHolder = new THREE.Group();
    planetRoot.add(meshHolder);
    contentGroup = new THREE.Group();
    meshHolder.add(contentGroup);

    rebuildSphereContent();

    const loop = () => {
      anim = requestAnimationFrame(loop);
      if (spinPreview && meshHolder) {
        const dir = prograde ? 1 : -1;
        spinT += dir * (24 / Math.max(6, rotHours)) * 0.004;
        meshHolder.rotation.y = spinT;
      }
      controls.update();
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
      const p = camera.position;
      const t = controls.target;
      viewMemory.globe = {
        pos: [p.x, p.y, p.z],
        target: [t.x, t.y, t.z],
      };
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
