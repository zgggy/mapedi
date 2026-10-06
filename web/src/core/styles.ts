import type { ElementStylePatch } from './layer/style';

export interface StrokeStyle {
  color: string;
  width: number;
  dash?: number[];
}

export interface FontSpec {
  /** 字体族 = **中英混合栈**（西文在前命中拉丁字形、汉字回退 PingFang/雅黑/宋体） */
  family: string;
  size: number;
  color: string;
  halo?: string;
}

export interface StyleSet {
  id: string;
  name: string;
  ocean: string;
  landBase: string;
  /** 地图矩形外的遮罩色（框外不显示内容） */
  frameVoid?: string;
  /** 符号：焦点层显示图标密度等 */
  symbols: {
    vegetation: boolean;
    capital: boolean;
    scale: number;
  };
  hillshade: boolean;
  /**
   * 高度 12 档覆盖色（2026-10-06 用户定「羊皮纸要改高度图每个高度的颜色——
   * 羊皮纸上没有这么丰富的色彩」）：缺省 = 数据色（core/layer/heightIntervals
   * 的 COLORS，逐元素 reg.color 落盘）；定义则渲染取色处按区间覆盖
   * （填色/描边/符号同源），不改数据。
   */
  heightBands?: string[];
  /**
   * 元素色整体去饱和系数（0..1 = 饱和度保留比例；parchment=0.45）：古地图手绘淡彩式——
   * 保色相（层间/国家间区分度不变）只压饱和与鲜度，覆盖彩虹板等所有数据色渲染点。
   */
  desaturate?: number;
  /**
   * **视图级图层默认样式**（2026-10-06 用户定架构「不同视图下各图层颜色集与默认显示
   * 参数不同」）：键 = layerId，值 = ElementStylePatch。解析链 = 静态默认 → **视图覆盖**
   * → 存档覆盖（存档优先：用户显式调过的不被视图压掉；写入走数据基线不含视图，零污染）。
   * 图层颜色集 = `heightBands`（同属视图携带的图层配置）。
   */
  layerStyles?: Record<string, ElementStylePatch>;
  cellStroke: StrokeStyle;
  regionStroke: StrokeStyle;
  continentStroke: StrokeStyle;
  coast: StrokeStyle;
  river: StrokeStyle;
  road: StrokeStyle;
  /** 行政/区域边界描边 */
  border: StrokeStyle;
  stripe: {
    enabled: boolean;
    width: number;
    contrast: number;
  };
  labels: {
    /**
     * 元素名称的**主题**部分（family/基准色/halo）。
     * 字号/字重/字距/大写/灰阶/缩放门槛在档位表 `core/layer/labelStyle.ts`（全局单源）；
     * 原 country/city/continent/biome 四个 FontSpec 全库零消费（2026-10-04 包2 收编删除）。
     */
    default: FontSpec;
  };
}

export const PRESET_STYLES: StyleSet[] = [
  {
    id: 'dark',
    name: '暗色制图',
    ocean: '#1a3348',
    landBase: '#2d4a3e',
    symbols: { vegetation: true, capital: true, scale: 1 },
    hillshade: true,
    cellStroke: { color: 'rgba(255,255,255,0.05)', width: 0.5 },
    regionStroke: { color: 'rgba(0,0,0,0.35)', width: 1.2 },
    continentStroke: { color: 'rgba(0,0,0,0.5)', width: 2 },
    coast: { color: 'rgba(200,230,255,0.55)', width: 1.4 },
    river: { color: '#4a90c8', width: 1.2 },
    road: { color: '#e8c46a', width: 2.2 },
    border: { color: 'rgba(0,0,0,0.55)', width: 1.6 },
    stripe: { enabled: true, width: 3, contrast: 0.45 },
    labels: {
      // 中英混合栈：拉丁命中新西文（地图感的几何无衬线），汉字回退中文字体
      default: {
        // 西文在前（Segoe UI/Roboto/Open Sans = 各平台地图感 grotesque）→ 中文回退（苹方/雅黑/思源）
        family:
          '"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, "Open Sans", "Noto Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC", "Noto Sans CJK SC", sans-serif',
        size: 13,
        color: '#f5f0e6',
        halo: 'rgba(0,0,0,0.65)',
      },
    },
  },
  {
    id: 'parchment',
    name: '羊皮纸',
    // 色卡（2026-10-06 用户定「搜集地图色库定义羊皮纸全色卡」）——色锚来自古地图/
    // 手绘 atlas 通用配色：纸面 #E8DCC4/#F2E8D5、陆 #E4D5B0/#B98B5E、墨 #4A3728/#3E3025、
    // 旧纸赭 #723F15、老海蓝绿 #A9C0B7/#7A9EAE（web 检索 wallfully/icolorpalette/
    // 123freevectors/historicpictoric 交叉）。
    ocean: '#345473',
    landBase: '#e4d5b0',
    // 高度 12 档（2026-10-06 用户参考色卡定稿，双源校验）：
    // ① 用户色卡 7 锚：深海#345473 / 近海#466b8c / 滩涂#e2c9a4 / 低地平原#ddb887 /
    //    平缓高地#d99e6b / 丘陵#c97c50 / 高山主峰#a84434；
    // ② 用户效果图像素聚类（2526×1492）：蓝系水 ~35%（#406080/#407090 族）、
    //    黄橙红陆 ~28%（#d0b070/#d0a060/#d09050/#d08040）——与表同族、无青绿无紫。
    // 7→12 映射：锚点精确、中间插值、浅滩=近海浅化为亮蓝（按图校正）、顶峰=主峰加深；
    // 浅滩→滩涂大跳色 = 图中水陆清晰分界。
    heightBands: [
      '#345473', '#3d607f', '#466b8c', '#5d88a3',
      '#e2c9a4', '#ddb887', '#dba879', '#d99e6b',
      '#c97c50', '#b86042', '#a84434', '#8f3a2c',
    ],
    desaturate: 0.45,
    // 高度层不显示边界（同日用户定）：档间/陆海描边关（选中态仍画专属色——sel 优先）
    layerStyles: { height: { border: { enabled: false } } },
    /** 框外 = 旧地图装裱底（深暖褐，区别于默认黑） */
    frameVoid: 'rgba(52, 40, 26, 0.92)',
    symbols: { vegetation: true, capital: true, scale: 1 },
    hillshade: true,
    cellStroke: { color: 'rgba(114, 91, 60, 0.14)', width: 0.4 },
    regionStroke: { color: 'rgba(110, 91, 75, 0.5)', width: 1 },
    continentStroke: { color: 'rgba(74, 55, 40, 0.65)', width: 1.8 },
    coast: { color: 'rgba(74, 55, 40, 0.8)', width: 1.2 },
    river: { color: '#7a9eae', width: 1.1 },
    road: { color: '#9c6b3f', width: 2 },
    border: { color: 'rgba(62, 48, 37, 0.7)', width: 1.4 },
    stripe: { enabled: true, width: 2.5, contrast: 0.35 },
    labels: {
      default: {
        family:
          'Georgia, "Times New Roman", "Songti SC", STSong, SimSun, "Noto Serif CJK SC", serif',
        size: 13,
        color: '#4a3728',
        halo: 'rgba(242, 232, 213, 0.8)',
      },
    },
  },
];

export function styleById(id: string): StyleSet {
  return PRESET_STYLES.find((s) => s.id === id) ?? PRESET_STYLES[0];
}


