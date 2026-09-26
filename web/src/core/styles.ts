export interface StrokeStyle {
  color: string;
  width: number;
  dash?: number[];
}

export interface FontSpec {
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
    /** 元素名称默认字体（装饰层统一使用） */
    default: FontSpec;
    country: FontSpec;
    city: FontSpec;
    continent: FontSpec;
    biome: FontSpec;
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
      default: { family: 'sans-serif', size: 13, color: '#f5f0e6', halo: 'rgba(0,0,0,0.65)' },
      country: { family: 'sans-serif', size: 13, color: '#f5f0e6', halo: 'rgba(0,0,0,0.65)' },
      city: { family: 'sans-serif', size: 11, color: '#ffe6a8', halo: 'rgba(0,0,0,0.7)' },
      continent: { family: 'sans-serif', size: 16, color: 'rgba(255,255,255,0.55)', halo: 'rgba(0,0,0,0.4)' },
      biome: { family: 'sans-serif', size: 10, color: 'rgba(220,230,220,0.75)', halo: 'rgba(0,0,0,0.5)' },
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
      default: { family: 'serif', size: 13, color: '#3b2a14', halo: 'rgba(255,250,230,0.75)' },
      country: { family: 'serif', size: 13, color: '#3b2a14', halo: 'rgba(255,250,230,0.75)' },
      city: { family: 'serif', size: 11, color: '#5a3010', halo: 'rgba(255,250,230,0.8)' },
      continent: { family: 'serif', size: 17, color: 'rgba(70,45,20,0.55)', halo: 'rgba(255,248,220,0.5)' },
      biome: { family: 'serif', size: 10, color: 'rgba(60,45,25,0.7)', halo: 'rgba(255,248,220,0.6)' },
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
      default: { family: 'monospace', size: 12, color: '#b8f0ff', halo: 'rgba(0,20,40,0.8)' },
      country: { family: 'monospace', size: 12, color: '#b8f0ff', halo: 'rgba(0,20,40,0.8)' },
      city: { family: 'monospace', size: 10, color: '#ffe080', halo: 'rgba(0,20,40,0.8)' },
      continent: { family: 'monospace', size: 15, color: 'rgba(120,220,255,0.5)', halo: 'rgba(0,10,30,0.6)' },
      biome: { family: 'monospace', size: 9, color: 'rgba(140,230,255,0.7)', halo: 'rgba(0,10,30,0.7)' },
    },
  },
];

export function styleById(id: string): StyleSet {
  return PRESET_STYLES.find((s) => s.id === id) ?? PRESET_STYLES[0];
}


