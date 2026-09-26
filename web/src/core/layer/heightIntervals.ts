/**
 * 高度工作区间：固定 12 档，不校验连通。
 * 元素 = 区间；绘制赋区间 min；跨档自动换元素。
 */
export interface HeightInterval {
  /** 元素 id：h0…h11 */
  id: string;
  name: string;
  /** 闭区间整数高度 */
  lo: number;
  hi: number;
  /** 绘制默认赋值 = lo */
  min: number;
  color: string;
}

const BINS: [number, number][] = [
  [-63, -55], [-54, -40], [-39, -25], [-24, 0],
  [1, 3], [4, 12], [13, 24], [25, 36],
  [37, 46], [47, 54], [55, 60], [61, 64],
];

const NAMES = [
  '深海', '远海', '近海', '浅滩',
  '海岸', '低地', '平原', '高平原',
  '丘陵', '山地', '高山', '顶峰',
];

const COLORS = [
  '#0A1A3A', '#1A3A6B', '#2A6A9B', '#4A8AB0',
  '#2A5A1A', '#4A7A3A', '#8B8B2A', '#C0C020',
  '#C0A040', '#A0A0A0', '#C0C0C0', '#F5F0E0',
];

export const HEIGHT_INTERVALS: HeightInterval[] = BINS.map(([lo, hi], i) => ({
  id: `h${i}`,
  name: NAMES[i],
  lo,
  hi,
  min: lo,
  color: COLORS[i],
}));

export const HEIGHT_MIN = -63;
export const HEIGHT_MAX = 64;

export function clampHeight(h: number): number {
  return Math.max(HEIGHT_MIN, Math.min(HEIGHT_MAX, Math.round(h)));
}

export function heightToIntervalIndex(h: number): number {
  const v = clampHeight(h);
  for (let i = 0; i < 12; i++) {
    if (v >= BINS[i][0] && v <= BINS[i][1]) return i;
  }
  return v <= 0 ? 3 : 4;
}

export function intervalByIndex(i: number): HeightInterval {
  return HEIGHT_INTERVALS[Math.max(0, Math.min(11, i))];
}

export function intervalById(id: string): HeightInterval | undefined {
  return HEIGHT_INTERVALS.find((x) => x.id === id);
}

/** 档内 +delta 整数；越出档上/下界则进入相邻档（自动换元素）；到顶/底 clamp */
export function stepHeight(h: number, delta: number): number {
  return clampHeight(h + delta);
}

/** Shift：升/降一个档，落到目标档 min；已在顶峰/深海则 clamp */
export function stepLevel(h: number, dir: 1 | -1): number {
  const i = heightToIntervalIndex(h);
  const next = i + dir;
  if (next < 0) return HEIGHT_MIN;
  if (next > 11) return HEIGHT_MAX;
  return HEIGHT_INTERVALS[next].min;
}

export function setHeightToInterval(h: number, intervalId: string): number {
  const iv = intervalById(intervalId);
  return iv ? iv.min : clampHeight(h);
}
