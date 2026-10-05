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
    ocean: '#c5d4e0',
    landBase: '#e8dcc4',
    symbols: { vegetation: true, capital: true, scale: 1 },
    hillshade: true,
    cellStroke: { color: 'rgba(90,70,40,0.12)', width: 0.4 },
    regionStroke: { color: 'rgba(80,50,20,0.35)', width: 1 },
    continentStroke: { color: 'rgba(60,40,15,0.55)', width: 1.8 },
    coast: { color: 'rgba(70,100,130,0.75)', width: 1.2 },
    river: { color: '#6a9ec0', width: 1.1 },
    road: { color: '#8b5a2b', width: 2 },
    border: { color: 'rgba(70,40,15,0.65)', width: 1.4 },
    stripe: { enabled: true, width: 2.5, contrast: 0.4 },
    labels: {
      default: {
        family:
          'Georgia, "Times New Roman", "Songti SC", STSong, SimSun, "Noto Serif CJK SC", serif',
        size: 13,
        color: '#3b2a14',
        halo: 'rgba(255,250,230,0.75)',
      },
    },
  },
  {
    id: 'neon',
    name: '科幻',
    ocean: '#0a1020',
    landBase: '#1a2838',
    symbols: { vegetation: true, capital: true, scale: 1 },
    hillshade: false,
    cellStroke: { color: 'rgba(80,200,255,0.08)', width: 0.4 },
    regionStroke: { color: 'rgba(80,220,255,0.35)', width: 1 },
    continentStroke: { color: 'rgba(120,240,255,0.55)', width: 1.6 },
    coast: { color: 'rgba(180,250,255,0.85)', width: 1.5 },
    river: { color: '#40e0ff', width: 1.3 },
    road: { color: '#ffcc40', width: 2 },
    border: { color: 'rgba(180,240,255,0.7)', width: 1.5 },
    stripe: { enabled: true, width: 3.5, contrast: 0.55 },
    labels: {
      default: {
        family: '"SF Mono", Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace',
        size: 12,
        color: '#b8f0ff',
        halo: 'rgba(0,20,40,0.8)',
      },
    },
  },
];

export function styleById(id: string): StyleSet {
  return PRESET_STYLES.find((s) => s.id === id) ?? PRESET_STYLES[0];
}


