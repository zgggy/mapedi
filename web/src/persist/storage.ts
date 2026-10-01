import { deserializeWorld, serializeWorld } from '../core/world';
import type { World } from '../core/types';
import { ensureBiome } from '../core/biomes';
import { getCellSetRingsCached } from '../render/borderCache';
import { prepareDisplayRings } from '../core/ring/normalize';
import { sampleMidRing } from '../core/ring/hermite';
import { project } from '../core/project/projections';
import { defaultProjParams } from '../core/project/projections';

const DB_NAME = 'mapedi';
const STORE = 'projects';
const KEY = 'autosave';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbSave(json: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ json, at: Date.now() }, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export async function idbLoad(): Promise<string | null> {
  const db = await openDb();
  const val = await new Promise<{ json: string; at: number } | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result as { json: string; at: number } | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return val?.json ?? null;
}

export async function idbClear(): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function downloadText(filename: string, text: string, mime = 'application/json'): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function exportProjectFile(world: World): void {
  const json = serializeWorld(world);
  const name = `mapedi-${world.meta.seed}.mapedi.json`;
  downloadText(name, json);
}

/** 若支持 CompressionStream，导出 .gz 以减小体积 */
export async function exportProjectGz(world: World): Promise<boolean> {
  if (typeof CompressionStream === 'undefined') return false;
  const json = serializeWorld(world);
  const cs = new CompressionStream('gzip');
  const stream = new Blob([json]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  const blob = new Blob([buf], { type: 'application/gzip' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mapedi-${world.meta.seed}.mapedi.json.gz`;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export async function importProjectFile(file: File): Promise<World> {
  const header = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  const gzip = header[0] === 0x1f && header[1] === 0x8b;
  if (file.name.endsWith('.gz') && !gzip) throw new Error('压缩项目文件格式不正确');
  if (gzip && typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持解压项目文件');
  }
  const text = gzip
    ? await new Response(file.stream().pipeThrough(new DecompressionStream('gzip'))).text()
    : await file.text();
  return deserializeWorld(text);
}

export function exportPngFromCanvas(canvas: HTMLCanvasElement, seed: number): void {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mapedi-${seed}.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

/** 大圆距离 km（地球半径近似 6371） */
export function distanceKm(
  a: { lon: number; lat: number },
  b: { lon: number; lat: number },
): number {
  const D2R = Math.PI / 180;
  const φ1 = a.lat * D2R;
  const φ2 = b.lat * D2R;
  const dλ = (b.lon - a.lon) * D2R;
  const x =
    Math.sin((φ2 - φ1) / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(x)));
}

export function searchRegions(world: World, q: string): { id: string; name: string; layerId: string; cells: number }[] {
  const s = q.trim().toLowerCase();
  if (!s) return [];
  return world.regions
    .filter((r) => r.name.toLowerCase().includes(s))
    .slice(0, 50)
    .map((r) => ({ id: r.id, name: r.name, layerId: r.layerId, cells: r.cells.length }));
}

/** 等距圆柱布局 SVG：高度着色 + 国家叠色 + 路径；经度展开防 ±180 长刺 */
export function exportSvg(world: World, styleLand = '#3d7a4a', styleOcean = '#1a3348'): void {
  void styleLand; // 陆地改为按高度着色，参数保留兼容
  const w = 3600;
  const h = 1800;
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`,
  );
  parts.push(`<rect width="${w}" height="${h}" fill="${styleOcean}"/>`);
  const px = (lon: number) => ((lon + 180) / 360) * w;
  const py = (lat: number) => ((90 - lat) / 180) * h;
  const ringD = (poly: { lon: number; lat: number }[]) => {
    let prevLon = poly[0]?.lon ?? 0;
    const segs: string[] = [];
    for (let i = 0; i < poly.length; i++) {
      let lon = poly[i].lon;
      while (lon - prevLon > 180) lon -= 360;
      while (lon - prevLon < -180) lon += 360;
      prevLon = lon;
      segs.push(`${i === 0 ? 'M' : 'L'}${px(lon).toFixed(1)},${py(poly[i].lat).toFixed(1)}`);
    }
    return segs.join(' ') + 'Z';
  };
  const landColor = (height: number) => {
    const t = Math.max(0, Math.min(1, height));
    const g = Math.floor(70 + t * 50);
    const r = Math.floor(40 + t * 30);
    const b = Math.floor(40 + (1 - t) * 20);
    return `rgb(${r},${g},${b})`;
  };
  // 高度/语义：一律元素边界环（与地图同一 Hermite），禁止 per-cell 语义填色
  {
    const pp = defaultProjParams();
    const projectFn = (ll: { lon: number; lat: number }) => project(ll, 'mercator', pp);
    const frameMinY = project({ lon: 0, lat: -85 }, 'mercator', pp).y;
    const frameMaxY = project({ lon: 0, lat: 85 }, 'mercator', pp).y;
    const frameY = {
      minY: frameMinY,
      maxY: frameMaxY,
    };
    const drawRegionRing = (r: { id: string; cells: number[]; color: string }, opacity: number) => {
      if (!r.cells.length) return;
      const entry = getCellSetRingsCached(world, r.cells, projectFn, 'mercator', `region:${r.id}`);
      const fillPaths: string[] = [];
      const outlinePaths: string[] = [];
      if (entry.fullWorld && !entry.rings.length) {
        const top = py(85).toFixed(1);
        const bottom = py(-85).toFixed(1);
        fillPaths.push(`M0,${top} L${w},${top} L${w},${bottom} L0,${bottom} Z`);
      }
      const svgPath = (pts: { x: number; y: number }[], dx: number) =>
        pts.map((p, i) => {
          const lon = ((p.x + dx) * 180) / Math.PI;
          const lat = (Math.atan(Math.sinh(p.y)) * 180) / Math.PI;
          return `${i === 0 ? 'M' : 'L'}${px(lon).toFixed(2)},${py(lat).toFixed(2)}`;
        }).join(' ');
      for (const ring of entry.rings) {
        for (const piece of prepareDisplayRings(ring, frameY)) {
          const fillPts = sampleMidRing(piece, 0.65, 'fill');
          const outlinePts = sampleMidRing(piece, 0.65, 'outline');
          for (let copy = -2; copy <= 2; copy++) {
            const dx = copy * Math.PI * 2;
            if (piece.closed && fillPts.length >= 3) {
              fillPaths.push(`${svgPath(fillPts, dx)} Z`);
            }
            if (outlinePts.length >= 2) {
              outlinePaths.push(svgPath(outlinePts, dx));
            }
          }
        }
      }
      if (fillPaths.length) {
        parts.push(`<path d="${fillPaths.join(' ')}" fill="${r.color}" fill-opacity="${opacity}" stroke="none" fill-rule="evenodd"/>`);
      }
      if (outlinePaths.length) {
        parts.push(`<path d="${outlinePaths.join(' ')}" fill="none" stroke="${r.color}" stroke-width="0.7"/>`);
      }
    };
    for (const r of world.regions) {
      if (r.layerId === 'height') drawRegionRing(r, 1);
    }
    for (const r of world.regions) {
      if (r.layerId === 'country') drawRegionRing(r, 0.72);
    }
  }
  // 路径：道路/航线/河流
  const pathColor: Record<string, string> = {
    road: '#e8c36a',
    route: '#7ec8e3',
    river: '#3d8ec9',
  };
  for (const p of world.paths ?? []) {
    if (!p.points || p.points.length < 2) continue;
    let prevLon = p.points[0].lon;
    const d = p.points
      .map((ll, i) => {
        let lon = ll.lon;
        while (lon - prevLon > 180) lon -= 360;
        while (lon - prevLon < -180) lon += 360;
        prevLon = lon;
        return `${i === 0 ? 'M' : 'L'}${px(lon).toFixed(1)},${py(ll.lat).toFixed(1)}`;
      })
      .join(' ');
    const stroke = p.color || pathColor[p.layerId] || '#e8c36a';
    const width = p.layerId === 'river' ? 3 : p.layerId === 'route' ? 2 : 2.5;
    parts.push(
      `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"${p.layerId === 'route' ? ' stroke-dasharray="8 6"' : ''}/>`,
    );
  }
  parts.push('</svg>');
  downloadText(`mapedi-${world.meta.seed}.svg`, parts.join('\n'), 'image/svg+xml');
}

export function exportGeoJson(world: World): void {
  // biome 按需重算（还债步骤 4：不落盘真缓存，导出反映当前地形）
  const biome = ensureBiome(world);
  const features: unknown[] = [];
  for (const cell of world.cells) {
    if (cell.polygon.length < 3) continue;
    const ring = cell.polygon.map((p) => [p.lon, p.lat]);
    ring.push(ring[0]);
    features.push({
      type: 'Feature',
      properties: {
        id: cell.id,
        height: cell.height,
        isOcean: cell.isOcean,
        biome: biome.get(cell.id) ?? null,
      },
      geometry: { type: 'Polygon', coordinates: [ring] },
    });
  }
  for (const r of world.regions) {
    if (!r.centerCellId) continue;
    const c = world.cells[r.centerCellId];
    if (!c) continue;
    features.push({
      type: 'Feature',
      properties: { kind: 'center', regionId: r.id, name: r.name, layerId: r.layerId },
      geometry: { type: 'Point', coordinates: [c.center.lon, c.center.lat] },
    });
  }
  const gj = { type: 'FeatureCollection', features };
  downloadText(
    `mapedi-${world.meta.seed}.geojson`,
    JSON.stringify(gj),
    'application/geo+json',
  );
}

/** 灰度高程图 PNG：equirect，陆地 0–1 → 128–255，海洋用 0–128 */
export function exportHeightmapPng(world: World): void {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const img = ctx.createImageData(w, h);
  // 填海洋底
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = 20;
    img.data[i + 1] = 40;
    img.data[i + 2] = 60;
    img.data[i + 3] = 255;
  }
  // 用 cell 中心 splat
  for (const cell of world.cells) {
    const x = Math.floor(((cell.center.lon + 180) / 360) * w);
    const y = Math.floor(((90 - cell.center.lat) / 180) * h);
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const v =
      cell.height > 0
        ? Math.floor(128 + Math.min(1, cell.height) * 127)
        : Math.floor(Math.max(0, 128 + cell.height * 100));
    // 画 3x3
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const o = (yy * w + xx) * 4;
        img.data[o] = v;
        img.data[o + 1] = v;
        img.data[o + 2] = v;
        img.data[o + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mapedi-${world.meta.seed}-height.png`;
    a.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}
