import type { World } from '../core/types';
import { assignContinents } from '../core/height';

/**
 * 将灰度高程图映射到现有 cell。
 * 约定：equirect，像素亮度 → 高度；陆/海以 0.5 为界（可调 seaLevel 0–1）。
 */
export async function applyHeightmapFile(
  world: World,
  file: File,
  opts?: { seaLevel?: number; invert?: boolean; exaggerate?: number },
): Promise<{ land: number; ocean: number }> {
  const sea = opts?.seaLevel ?? 0.5;
  const invert = opts?.invert ?? false;
  const img = await createImageBitmap(file);
  const w = img.width;
  const h = img.height;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, w, h).data;
  img.close();

  let land = 0;
  let ocean = 0;
  for (const cell of world.cells) {
    const x = Math.min(w - 1, Math.max(0, Math.floor(((cell.center.lon + 180) / 360) * w)));
    const y = Math.min(h - 1, Math.max(0, Math.floor(((90 - cell.center.lat) / 180) * h)));
    const o = (y * w + x) * 4;
    let v = (data[o] + data[o + 1] + data[o + 2]) / (3 * 255);
    if (invert) v = 1 - v;
    if (v >= sea) {
      // 陆地 0–1
      const t = (v - sea) / Math.max(1e-6, 1 - sea);
      cell.height = Math.min(1, 0.05 + t * 0.95);
      cell.isOcean = false;
      land++;
    } else {
      const t = v / Math.max(1e-6, sea);
      cell.height = -Math.min(1, t) * 0.8;
      cell.isOcean = true;
      ocean++;
    }
  }
  assignContinents(world);
  return { land, ocean };
}
