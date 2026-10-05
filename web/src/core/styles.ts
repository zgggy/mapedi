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
    ocean: '#a9c0b7',
    landBase: '#e4d5b0',
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


