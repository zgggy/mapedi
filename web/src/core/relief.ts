import type { Cell, World } from './types';

export interface ReliefOptions {
  /** 0 平顶，1 完全平滑 */
  smooth: number;
  /** 高度夸张（显示用） */
  exaggeration: number;
}

/**
 * 为 cell 生成显示用环带网格：内环 = h_c，外环 = 邻域高度加权。
 * 返回局部 2D 墨卡托/当前投影坐标在调用方已转好的 lonlat 多边形上的高度环。
 * 这里返回每 cell 的顶点高度（与 polygon 一一对应）+ 内缩中心高度。
 */
export function cellReliefHeights(
  world: World,
  cell: Cell,
  smooth: number,
): { polyHeights: number[]; innerHeight: number } {
  const s = Math.max(0, Math.min(1, smooth));
  const polyHeights: number[] = [];
  for (let i = 0; i < cell.polygon.length; i++) {
    // 用邻接 cell 高度平均作为边外侧目标
    let sum = 0;
    let n = 0;
    for (const nid of cell.neighbors) {
      sum += world.cells[nid].height;
      n++;
    }
    const neighborAvg = n ? sum / n : cell.height;
    // 顶点在边界上：向邻域过渡
    const h = cell.height * (1 - s) + neighborAvg * s;
    polyHeights.push(h);
  }
  return {
    polyHeights,
    innerHeight: cell.height,
  };
}

/** 平滑后的显示高度（用于 2D hillshade 近似） */
export function displayHeight(cell: Cell, neighbors: Cell[], smooth: number): number {
  const s = Math.max(0, Math.min(1, smooth));
  if (!neighbors.length) return cell.height;
  const avg = neighbors.reduce((a, c) => a + c.height, 0) / neighbors.length;
  return cell.height * (1 - s * 0.5) + avg * (s * 0.5);
}

export function seaLevel(): number {
  return 0;
}

/** 抽象高度 → 球半径偏移（夸张后） */
export function radialOffset(height: number, exaggeration: number): number {
  if (height <= 0) return height * 0.35 * exaggeration;
  return height * exaggeration;
}
