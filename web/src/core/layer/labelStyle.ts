/**
 * 注记排版单源（LABEL_DESIGN_2026-10-04 包2 · R6/R7/R14 · P3/P4）。
 *
 * 分工（两套正交的真相）：
 *  - **档位**（本文件）：字号 / 字重 / 字距 / 拉丁大写 / 灰阶 / 缩放门槛——与主题无关，
 *    全局四档，相邻档差 ≥2px（制图惯例：差 <15% 不可辨）；
 *  - **主题**（`core/styles.ts` 的 `labels.default`）：字体族（含中英栈）/ 基准色 / halo——
 *    换预设（暗色/羊皮纸/霓虹）时档位颜色跟着走（alpha 叠在主题基准色上）。
 *
 * 中英并重（用户 2026-10-04 要求「中英文排版都要有，要和地图上那种似的」）：
 *  - **拉丁**：西文惯例 = 大写 + 加大字距（国家/州名的经典做法）——`upper: true` 的档位
 *    对整串 `toUpperCase()`；**中文不受大小写影响**，混排（"华夏 Empire"→"华夏 EMPIRE"）
 *    正是地图上常见的样子，无需按字符分流。
 *  - **中文**：无大小写可用 → 层级靠**字号 + 字重 + 字距（方块字加字距效果显著）+ 灰阶**，
 *    绝不用斜体（伪斜体小字号可读性差，见 LABEL_DESIGN §1.3 警告）。
 *  - **字体族**：走主题的 `labels.default.family`，各预设已配成「西文在前 + 中文回退」的
 *    栈（浏览器逐字体回退：拉丁命中前面的西文字体、汉字跳到 PingFang/雅黑/宋体）。
 */
import type { LayerDef, LabelTier, World } from '../types';
import type { StyleSet } from '../styles';

/**
 * 图集衬线栈（**国家名用**，2026-10-04 用户要求「正经地图怎么标名字」→ 重新调研）：
 * 经典印刷图集（NatGeo/CIA 系）国名用衬线 + 大字距大写；现代开源底图（OSM/Mapbox/ArcGIS）
 * 全部无衬线——两条路线并存，本项目按**档位**分：primary（国家）=衬线图集感，
 * 其余档 = 主题无衬线（居民地/语义层）。西文在前、中文回退在后（OSM fonts.mss 原则：
 * CJK 字体自带拉丁字形，放前面会覆盖西文设计）。
 */
export const MAP_SERIF_STACK =
  'Georgia, "Times New Roman", "Source Serif 4", "Songti SC", SimSun, "Source Han Serif SC", "Noto Serif CJK SC", serif';

/** 中日韩文字判定（拉丁大写/字距上限按此分流：中文 gap 上限 1×字大，西文 0.5em） */
export function isCJK(text: string): boolean {
  return /[\u3400-\u9fff\u3040-\u30ff\uac00-\ud7af\uf900-\ufaff]/.test(text);
}

/** 档位默认排版（color 是 alpha，运行时叠在主题基准色上） */
export interface LabelTierSpec {
  /** 字号 px（屏幕恒定，不随缩放变） */
  size: number;
  /** 字重（Canvas font 前缀） */
  weight: number;
  /** 字距 em（Canvas letterSpacing；0.15em ≈ 制图里国名的疏排感） */
  spacing: number;
  /** 拉丁全大写（对汉字无影响） */
  upper: boolean;
  /** 灰阶 alpha：层级越高越实（深底浅字时代，对比度即层级） */
  alpha: number;
  /** 名称缩放门槛：缩小到该 scale 以下本档不画（R14） */
  minScale: number;
  /** 用图集衬线栈（国家名的「正经地图」感）；缺省=主题无衬线栈 */
  serif?: boolean;
}

/**
 * 四档表（包2 默认；每层可用 `labelSize`/`labelMinScale`/`labelTier` 覆盖）。
 * 取值依据 LABEL_DESIGN §1.3：国家 14–15、省 12–13、语义层 12、次级 10–11；
 * 档差 ≥2px；国名/省名走大写+疏排（西文惯例），语义/次级不放大写避免抢戏。
 */
export const LABEL_TIERS: Record<LabelTier, LabelTierSpec> = {
  primary: { size: 15, weight: 600, spacing: 0.16, upper: true, alpha: 1, minScale: 55, serif: true },
  secondary: { size: 13, weight: 500, spacing: 0.1, upper: true, alpha: 0.9, minScale: 75 },
  tertiary: { size: 12, weight: 400, spacing: 0.05, upper: false, alpha: 0.8, minScale: 95 },
  minor: { size: 10, weight: 400, spacing: 0.02, upper: false, alpha: 0.68, minScale: 125 },
};

/** 注记的最终排版（档位 × 主题 × 层覆盖 合成） */
export interface LabelSpec extends LabelTierSpec {
  tier: LabelTier;
  family: string;
  color: string;
  halo: string;
}

/** 档位 = 层显式 `labelTier` ?? **按层深度**（父层 primary、子层 secondary……与叠放/优先级同树） */
export function tierOf(
  world: Pick<World, 'layers'>,
  layer: Pick<LayerDef, 'id' | 'parentLayerId' | 'labelTier'>,
): LabelTier {
  if (layer.labelTier) return layer.labelTier;
  let depth = 0;
  let cur = layer.parentLayerId;
  const seen = new Set<string>([layer.id]);
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    depth++;
    const p = world.layers.find((l) => l.id === cur);
    if (!p) break;
    cur = p.parentLayerId;
  }
  if (depth <= 0) return 'primary';
  if (depth === 1) return 'secondary';
  return depth === 2 ? 'tertiary' : 'minor';
}

/**
 * 合成该层注记排版：档位表 × 主题（family/基准色/halo）× 层覆盖（labelSize/labelMinScale）。
 * `color`/`halo` 按档位 alpha 叠算——换主题时层级灰阶自动跟随（羊皮纸深字同理）。
 */
export function labelSpecOf(
  world: Pick<World, 'layers'>,
  layer: LayerDef,
  style: StyleSet,
): LabelSpec {
  const tier = tierOf(world, layer);
  const t = LABEL_TIERS[tier];
  const base = style.labels.default;
  return {
    tier,
    size: layer.labelSize ?? t.size,
    weight: t.weight,
    spacing: t.spacing,
    upper: t.upper,
    alpha: t.alpha,
    minScale: layer.labelMinScale ?? t.minScale,
    family: t.serif ? MAP_SERIF_STACK : base.family,
    serif: t.serif,
    color: withAlpha(base.color, t.alpha),
    halo: base.halo ?? 'rgba(0,0,0,0.6)',
  };
}

/** 主题基准色（#rgb/#rrggbb/rgb()/rgba()）按 alpha 叠算 → rgba() 文本 */
export function withAlpha(color: string, alpha: number): string {
  if (alpha >= 1) return color;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex) {
    const h = hex[1];
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const r = parseInt(full.slice(0, 2), 16);
    const g = parseInt(full.slice(2, 4), 16);
    const b = parseInt(full.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(color.trim());
  if (rgba) {
    const parts = rgba[1].split(',').map((x) => x.trim());
    const r = parts[0];
    const g = parts[1] ?? parts[0];
    const b = parts[2] ?? parts[0];
    const a = parts.length >= 4 ? parseFloat(parts[3]) : 1;
    return `rgba(${r},${g},${b},${(a * alpha).toFixed(3)})`;
  }
  return color;
}

/** 最终渲染文本：拉丁大写（汉字原样），供 measureText 与绘制共用 */
export function labelTextOf(name: string, spec: Pick<LabelSpec, 'upper'>): string {
  return spec.upper ? name.toUpperCase() : name;
}
