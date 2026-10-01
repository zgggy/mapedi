import type { CellClimate, ClimateParams, World } from './types';
import { isLand, isOcean } from './types';
import { createRng, hashSeed } from './rng';
import { heightRev } from './rev';

function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hashSeed(seed, i) / 4294967296;
  const b = hashSeed(seed, i + 1) / 4294967296;
  return a + (b - a) * u;
}

/** 整数高度（-63..64）→ 约海拔米：陆 0..8848（顶峰≈珠峰），海 0..-11000（深海） */
export function heightToMeters(h: number): number {
  if (h > 0) return (h / 64) * 8848;
  return (h / 63) * 11000;
}

/**
 * 为每个 cell 计算气候派生场。
 * 温度：纬度余弦 + 高度递减 + 倾角极地加强
 * 降水：距海 + 迎风坡近似 + 河流邻域
 * 风带：顺/逆行决定中纬西风与信风方向
 */
export function computeClimate(world: World): Map<number, CellClimate> {
  const c = world.climate;
  const rng = createRng(hashSeed(world.meta.seed, 501));
  void rng;

  // 粗海岸距离：BFS 从海洋 cell
  const coastDist = new Float32Array(world.cells.length).fill(99);
  const q: number[] = [];
  for (const cell of world.cells) {
    if (isOcean(cell)) {
      coastDist[cell.id] = 0;
      q.push(cell.id);
    }
  }
  let qi = 0;
  while (qi < q.length) {
    const id = q[qi++];
    for (const n of world.cells[id].neighbors) {
      if (coastDist[n] > coastDist[id] + 1) {
        coastDist[n] = coastDist[id] + 1;
        q.push(n);
      }
    }
  }

  // 高度梯度粗算（用于迎风/背风）
  const riverCells = new Set<number>();
  for (const [, river] of world.rivers) {
    riverCells.add(river.a);
    riverCells.add(river.b);
  }
  const out = new Map<number, CellClimate>();
  for (const cell of world.cells) {
    const lat = Math.abs(cell.center.lat);
    const latR = (lat * Math.PI) / 180;
    const tiltFactor = 1 + (c.axialTiltDeg / 23.4) * 0.15;
    const m = heightToMeters(cell.height);
    // 递减率 ~0.65°C/100m
    let t =
      c.baseTemperatureC * Math.cos(latR) -
      (m / 100) * 0.65 -
      Math.pow(lat / 90, 2) * 18 * tiltFactor;
    t += (noise1(cell.id * 0.17, world.meta.seed) - 0.5) * 4;
    if (isOcean(cell)) t = Math.min(t, 2); // 海面略冷于同纬陆地热带

    // 风：顺行 → 低纬东北信风、中纬西风
    const pro = c.rotationPrograde ? 1 : -1;
    let windAngle: number;
    if (lat < 30) windAngle = pro > 0 ? Math.PI * 0.25 : Math.PI * 0.75;
    else if (lat < 60) windAngle = pro > 0 ? Math.PI * 1.25 : Math.PI * 0.75;
    else windAngle = pro > 0 ? Math.PI * 1.75 : Math.PI * 0.25;

    const cd = coastDist[cell.id];
    const land = isLand(cell);
    // 距海越远降水越少
    let precip = land
      ? Math.exp(-cd / (4 + 3 * c.oceanHeatCapacity)) * 0.9 + 0.05
      : 0.7;
    // 河流邻域加湿
    if (riverCells.has(cell.id)) {
      precip = Math.min(1, precip + 0.15);
    }
    // 迎风：邻域更高则可能雨影
    let rainShadow = 0;
    const windLon = Math.cos(windAngle);
    const windLat = Math.sin(windAngle);
    for (const n of cell.neighbors) {
      const nc = world.cells[n];
      const dx = nc.center.lon - cell.center.lon;
      const dy = nc.center.lat - cell.center.lat;
      // 上风向更高 → 雨影
      if (dx * windLon + dy * windLat < 0 && nc.height > cell.height + 0.05) {
        rainShadow += 0.08;
      }
    }
    precip = Math.max(0.02, Math.min(1, precip - rainShadow));
    precip += (noise1(cell.id * 0.31, world.meta.seed + 9) - 0.5) * 0.15;
    precip = Math.max(0, Math.min(1, precip));

    const humidity = Math.min(1, precip * 0.85 + (land ? 0 : 0.3));
    const oxygen =
      c.oxygenLevel *
      (land ? Math.max(0.55, 1 - m / 9000) : 0.9) *
      (0.95 + noise1(cell.id * 0.07, world.meta.seed + 3) * 0.1);

    out.set(cell.id, {
      temperatureC: t,
      precipitation: precip,
      humidity,
      windAngle,
      oxygen,
      coastDist: cd,
    });
  }
  world.cellClimate = out;
  computedAtRev = heightRev();
  return out;
}

/** 气候派生缓存的"算毕于"修订号（模块级：单活世界；worker 另有模块实例） */
let computedAtRev = -1;

/**
 * 气候按需重算入口（还债步骤 4，真缓存语义）：缓存缺席或高度域已翻新才重算。
 * cellClimate 不落盘（serializeWorld 已删），跨会话必缺席 → 加载后首读即按当前地形算；
 * 会话内高度变更（笔画/撤销/生成）bump heightRev → 下一读重算。**读方批量前调一次**，
 * 禁止在逐 cell 循环内调用。已知边界：仅改河流（partial river regen，当前 UI 不可达）
 * 不翻 heightRev——降水河邻加湿沿用旧值，影响带内 ±0.15。
 */
export function ensureClimate(world: World): Map<number, CellClimate> {
  if (!world.cellClimate || computedAtRev !== heightRev()) {
    computeClimate(world);
  }
  return world.cellClimate!;
}
