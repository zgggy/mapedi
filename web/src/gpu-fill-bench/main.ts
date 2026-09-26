// gpuFill 对齐验证：同一多边形数据 + 同一高度渐变，GPU 批量填充 vs Canvas2D 逐 path 填充。
// 目的：肉眼确认 GPU 渐变填充与 Canvas2D 对齐（不串色/不错位），并对比耗时。
// 非侵入：不接 mapedi 主应用，仅验证 render/gpuFill.ts 的视觉与性能。
import { GpuFillRenderer } from '../render/gpuFill';
import { heightGradientColor } from '../core/heightRegions';
import { fibonacciSphere, sphericalVoronoi, polyToLonLat } from '../core/voronoiSphere';

const W = 800, H = 520;

interface World {
  polys: Float64Array[]; // 屏幕坐标 [x0,y0,...]，x∈0..W, y∈0..H
  hMin: number;
  hMax: number;
}

// 球面 Voronoi → 屏幕坐标多边形（跳过跨日期变更线），高度取中心 y 造有高有低的地形
function genWorld(n: number): World {
  const t0 = performance.now();
  const sites = fibonacciSphere(n);
  const { polys } = sphericalVoronoi(sites);
  const out: Float64Array[] = [];
  let skipped = 0;
  let hMin = Infinity, hMax = -Infinity;
  for (const poly of polys) {
    const ll = polyToLonLat(poly); // Vec3[] → {lon,lat}[]
    if (ll.length < 3) continue;
    const arr = new Float64Array(ll.length * 2);
    let minX = Infinity, maxX = -Infinity, cy = 0;
    for (let j = 0; j < ll.length; j++) {
      const nx = ll[j].lon / (2 * Math.PI) + 0.5; // 归一化 0..1
      const ny = 0.5 - ll[j].lat / Math.PI;
      arr[j * 2] = nx * W;   // → 屏幕坐标
      arr[j * 2 + 1] = ny * H;
      if (nx < minX) minX = nx;
      if (nx > maxX) maxX = nx;
      cy += ny;
    }
    if (maxX - minX > 0.5) { skipped++; continue; } // 跨变更线，跳过
    cy /= ll.length;
    const h = (cy - 0.5) * 2; // -1..1，有高有低验证渐变两端
    out.push(arr);
    if (h < hMin) hMin = h;
    if (h > hMax) hMax = h;
  }
  console.log(`[gpu-fill-bench] 生成 ${out.length} 胞腔（跳过跨变更线 ${skipped}），${(performance.now() - t0).toFixed(0)}ms`);
  return { polys: out, hMin, hMax };
}

function heightToRgb(h: number): [number, number, number, number] {
  const hex = heightGradientColor(h).replace('#', '');
  const v = parseInt(hex.slice(0, 6), 16);
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255, 1];
}

function drawCanvas2D(canvas: HTMLCanvasElement, w: World): number {
  const t0 = performance.now();
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, H, 0, 0); // 底(y=H)=hMin，顶(y=0)=hMax
  for (let i = 0; i <= 16; i++) {
    const t = i / 16;
    grad.addColorStop(t, heightGradientColor(w.hMin + t * (w.hMax - w.hMin)));
  }
  ctx.fillStyle = grad;
  for (const poly of w.polys) {
    ctx.beginPath();
    ctx.moveTo(poly[0], poly[1]);
    for (let i = 2; i < poly.length; i += 2) ctx.lineTo(poly[i], poly[i + 1]);
    ctx.closePath();
    ctx.fill();
  }
  return performance.now() - t0;
}

function drawGpu(canvas: HTMLCanvasElement, w: World): number {
  const t0 = performance.now();
  const r = new GpuFillRenderer(canvas);
  r.clear();
  // worldY = 屏幕 y（cam 恒等映射）；t=0 底→hMin，t=1 顶→hMax，与 Canvas2D 渐变同映射
  const colorFn = (worldY: number): [number, number, number, number] => {
    const t = worldY <= 0 ? 0 : worldY >= H ? 1 : (H - worldY) / H;
    return heightToRgb(w.hMin + t * (w.hMax - w.hMin));
  };
  for (const poly of w.polys) r.addPolygon(poly, colorFn);
  // cam 恒等映射：sx=(x-W/2)*1+W/2=x，使世界坐标=屏幕坐标
  r.render({ cam: { x: W / 2, y: H / 2, scale: 1 }, w: W, h: H, drawDx: 0 });
  return performance.now() - t0;
}

function main(): void {
  const w = genWorld(12000);
  const c2d = document.getElementById('c2d') as HTMLCanvasElement;
  const cgpu = document.getElementById('cgpu') as HTMLCanvasElement;
  const t2d = drawCanvas2D(c2d, w);
  const tgpu = drawGpu(cgpu, w);

  // 像素对齐度：把 GPU canvas 拷到 2D 再逐像素比
  const a = c2d.getContext('2d')!.getImageData(0, 0, W, H).data;
  const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
  const tctx = tmp.getContext('2d')!;
  tctx.drawImage(cgpu, 0, 0);
  const bb = tctx.getImageData(0, 0, W, H).data;
  let diff = 0, compared = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (a[i + 3] === 0 && bb[i + 3] === 0) continue;
    compared++;
    const d = Math.abs(a[i] - bb[i]) + Math.abs(a[i + 1] - bb[i + 1]) + Math.abs(a[i + 2] - bb[i + 2]) + Math.abs(a[i + 3] - bb[i + 3]);
    if (d > 48) diff++;
  }
  const align = compared ? (100 * (1 - diff / compared)).toFixed(2) : '—';
  const stats = document.getElementById('stats')!;
  stats.textContent =
    `胞腔: ${w.polys.length}  高度范围: ${w.hMin.toFixed(2)} .. ${w.hMax.toFixed(2)}\n` +
    `Canvas2D 逐 path 填充: ${t2d.toFixed(1)} ms\n` +
    `GPU 批量填充(gpuFill): ${tgpu.toFixed(1)} ms\n` +
    `加速: ${(t2d / tgpu).toFixed(1)}×\n` +
    `像素对齐: ${align}%（>48 色差计为不同，越接近 100 越对齐）`;
  console.log('[gpu-fill-bench]', stats.textContent);
}

main();
