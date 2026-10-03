/**
 * 语义层取色单源（2026-10-04 用户定）：
 * - **彩虹条采样 ≥20 色**——旧色池同池重复（实测各层唯一色仅 4–5 个、色相窄带）
 *   导致「不同元素颜色差别太小」；这里固定 24 色相均分（15° 步进），按序轮转。
 * - **同色系微调 tintOf**：子图层元素 = 所属父元素色 ±（色相 ±16°/明度 ±7%），
 *   按兄弟序确定性；生成聚合与组织缩进两条路径共用。
 * 色值由公式在模块初始化时确定（同代码恒同输出，序列化稳定）。
 */

function hslToHex(h: number, s: number, l: number): string {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number): string => {
    const k = (n + h / 30) % 12;
    const c = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { h: 0, s: 0, l: 0.5 };
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return { h, s, l };
}

/** 彩虹色板：24 色相均分（15° 步进）——语义层缺省取色 */
export const RAINBOW: string[] = Array.from({ length: 24 }, (_, i) =>
  hslToHex(i * 15, 0.72, 0.52),
);

/** 取色：自定义池优先，否则彩虹板按序轮转 */
export function colorAt(pool: string[] | undefined, i: number): string {
  const p = pool && pool.length ? pool : RAINBOW;
  const n = p.length;
  return p[((i % n) + n) % n];
}

/** 同色系微调：父色 ±（色相 (i 奇偶摆动 ±8/±16°）±明度 (i%3−1)·7%）——按兄弟序确定性 */
export function tintOf(parentHex: string, i: number): string {
  const { h, s, l } = hexToHsl(parentHex);
  const dh = ((i % 5) - 2) * 8; // −16, −8, 0, +8, +16 循环
  const dl = ((i % 3) - 1) * 0.07;
  const hh = ((h + dh) % 360 + 360) % 360;
  return hslToHex(hh, Math.min(0.9, Math.max(0.25, s)), Math.min(0.85, Math.max(0.22, l + dl)));
}
