// mapedi 地块渲染性能对照：Canvas2D 逐 path 填充（现状）vs three.js GPU 批量绘制（优化）。
// 非侵入独立演示，不改现有 layers.ts 渲染路径；用真实球面 Voronoi 胞腔作数据源。
import * as THREE from 'three';
import { fibonacciSphere, sphericalVoronoi, polyToLonLat } from '../core/voronoiSphere';

interface Cells {
  polys: Float64Array[]; // equirect 归一化坐标 [x0,y0,x1,y1,...]，x/y ∈ 0..1
  colors: string[];
  skipped: number;
}

const PALETTE = ['#cfe0f2','#d8ecc8','#f2d9c4','#f0c9d6','#e6dff2','#d4ecec','#f6e6b8','#e8eef7'];

function genCells(n: number): Cells {
  const t0 = performance.now();
  const sites = fibonacciSphere(n);
  const { polys } = sphericalVoronoi(sites);
  const out: Float64Array[] = [];
  const colors: string[] = [];
  let skipped = 0;
  for (let i = 0; i < polys.length; i++) {
    const ll = polyToLonLat(polys[i]);
    const arr = new Float64Array(ll.length * 2);
    let minX = Infinity, maxX = -Infinity;
    for (let j = 0; j < ll.length; j++) {
      const x = ll[j].lon / (2 * Math.PI) + 0.5;
      const y = 0.5 - ll[j].lat / Math.PI;
      arr[j * 2] = x;
      arr[j * 2 + 1] = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (arr.length < 6) continue;
    // 跨 dateline 的胞腔（x 跳变）会产生拉伸三角，demo 里跳过以保证画面与测量干净
    if (maxX - minX > 0.5) { skipped++; continue; }
    out.push(arr);
    colors.push(PALETTE[i % PALETTE.length]);
  }
  console.log(`[gpu-bench] 生成 ${out.length} 胞腔（跳过跨日期变更线 ${skipped}），耗时 ${(performance.now() - t0).toFixed(0)}ms`);
  return { polys: out, colors, skipped };
}

// ---- Canvas2D（对照组，模拟现有 layers.ts 逐 path 填充）----
function drawCanvas2D(ctx: CanvasRenderingContext2D, cells: Cells, W: number, H: number, offset: number) {
  const { polys, colors } = cells;
  for (let i = 0; i < polys.length; i++) {
    const p = polys[i];
    ctx.beginPath();
    ctx.moveTo(p[0] * W + offset, p[1] * H);
    for (let j = 2; j < p.length; j += 2) ctx.lineTo(p[j] * W + offset, p[j + 1] * H);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
  }
}

// ---- GPU（优化组：fan 三角化 + 合并 buffer + 单次 draw call）----
function buildGPU(cells: Cells, W: number, H: number) {
  const t0 = performance.now();
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const { polys, colors } = cells;
  let tris = 0;
  for (let i = 0; i < polys.length; i++) {
    const p = polys[i];
    c.set(colors[i]);
    const x0 = p[0] * W, y0 = p[1] * H;
    for (let j = 2; j + 3 < p.length; j += 2) {
      pos.push(x0, y0, 0, p[j] * W, p[j + 1] * H, 0, p[j + 2] * W, p[j + 3] * H, 0);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
      tris++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  console.log(`[gpu-bench] GPU buffer 构建 ${tris} 三角形（一次 draw call），耗时 ${(performance.now() - t0).toFixed(0)}ms`);
  return geo;
}

class Meter {
  frames = 0; last = performance.now(); fps = 0; ms = 0;
  sample(drawMs: number) {
    this.frames++;
    const now = performance.now();
    if (now - this.last >= 400) {
      this.fps = (this.frames * 1000) / (now - this.last);
      this.frames = 0;
      this.last = now;
    }
    this.ms = drawMs;
  }
}

function main() {
  const c2dCanvas = document.getElementById('c2d') as HTMLCanvasElement;
  const gpuCanvas = document.getElementById('gpu') as HTMLCanvasElement;
  const cellsSlider = document.getElementById('cells') as HTMLInputElement;
  const cellsLabel = document.getElementById('cellsLabel') as HTMLElement;
  const rebuildBtn = document.getElementById('rebuild') as HTMLButtonElement;
  const buildInfo = document.getElementById('buildInfo') as HTMLElement;
  const c2dStat = document.getElementById('c2dStat') as HTMLElement;
  const gpuStat = document.getElementById('gpuStat') as HTMLElement;

  const W = 560, H = 420;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  for (const cv of [c2dCanvas, gpuCanvas]) {
    cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  }
  const c2d = c2dCanvas.getContext('2d')!;
  c2d.scale(dpr, dpr);

  // three.js 场景（正交相机，像素坐标，y 向下与 canvas 一致）
  const renderer = new THREE.WebGLRenderer({ canvas: gpuCanvas, antialias: true });
  renderer.setPixelRatio(dpr);
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera(0, W, 0, H, 0.1, 10);
  cam.position.z = 5;
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });

  let cells: Cells = { polys: [], colors: [], skipped: 0 };
  let mesh: THREE.Mesh | null = null;

  function rebuild() {
    const n = parseInt(cellsSlider.value, 10);
    cellsLabel.textContent = String(n);
    cells = genCells(n);
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    const geo = buildGPU(cells, W, H);
    mesh = new THREE.Mesh(geo, material);
    scene.add(mesh);
    const tris = (geo.getAttribute('position') as THREE.BufferAttribute).count / 3;
    buildInfo.textContent = `胞腔 ${cells.polys.length.toLocaleString()} · 三角形 ${Math.round(tris).toLocaleString()} · 跳过跨线 ${cells.skipped}`;
  }

  cellsSlider.addEventListener('input', () => { cellsLabel.textContent = cellsSlider.value; });
  rebuildBtn.addEventListener('click', rebuild);

  const meter2d = new Meter();
  const meterGpu = new Meter();

  function loop() {
    const t = performance.now();
    // 同样幅度的水平摆动，模拟拖动交互
    const offset = Math.sin(t * 0.0004) * W * 0.35;

    let s = performance.now();
    c2d.clearRect(0, 0, W, H);
    drawCanvas2D(c2d, cells, W, H, offset);
    meter2d.sample(performance.now() - s);

    s = performance.now();
    if (mesh) mesh.position.x = offset;
    renderer.render(scene, cam);
    meterGpu.sample(performance.now() - s);

    c2dStat.textContent = `Canvas2D  ${meter2d.fps.toFixed(0)} fps  ·  绘制 ${meter2d.ms.toFixed(1)}ms/帧`;
    gpuStat.textContent = `GPU  ${meterGpu.fps.toFixed(0)} fps  ·  render ${meterGpu.ms.toFixed(2)}ms/帧`;
    requestAnimationFrame(loop);
  }

  rebuild();
  requestAnimationFrame(loop);
}

main();
