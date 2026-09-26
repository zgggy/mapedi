/** 球面真相：一切持久化几何以经纬度为准 */
import type { StarSystem } from './astro';

export type LonLat = { lon: number; lat: number };
export type Vec2 = { x: number; y: number };
export type CellId = number;
export type RegionId = string;
export type LayerId = string;

export type LayerKind =
  | 'height'
  | 'environment'
  | 'vegetation'
  | 'fauna'
  | 'race'
  | 'cultural'
  | 'religious'
  | 'political'
  | 'road'
  | 'route'
  | 'river'
  | 'military'
  | 'custom';

export type LayerMode = 'view' | 'edit';

export interface Cell {
  id: CellId;
  /** 闭合环，逆时针，[lon,lat] 度；不重复首点 */
  polygon: LonLat[];
  center: LonLat;
  neighbors: CellId[];
  isOcean: boolean;
  /** 整数高度：陆地 1..64，海洋 -63..0（见 heightIntervals 的 12 档） */
  height: number;
  area: number;
  /** 大陆分组派生缓存（笔刷多数票用）；真相 = landsea 层 continent Region 顺序 */
  continentId?: number;
}

/**
 * 陆海判定（唯一谓词）。
 * **只在生成/绘制阶段使用**——判定完后元素（大陆/湖泊/海洋）已持有 Region.cells，
 * 渲染阶段只读元素，不再读高度。
 */
export function isLand(cell: Pick<Cell, 'height'>): boolean {
  return cell.height > 0;
}
export function isOcean(cell: Pick<Cell, 'height'>): boolean {
  return cell.height <= 0;
}

export interface EdgeKey {
  a: CellId;
  b: CellId;
}

export interface RiverEdge {
  a: CellId;
  b: CellId;
  widthFactor: number;
  order: number;
}

/** 核心地块标记形状（渲染层读取，数据层只存 coreCellId） */
export type CoreSymbol = 'star' | 'square' | 'circle' | 'none';
/** 逐 cell 装饰（植物树点等） */
export type CellSymbol = 'tree' | 'none';
/** 元素名称显示模式 */
export type LabelMode = 'none' | 'name' | 'coreLabel';
/** cell 级标记 */
export type CellMarker = 'none' | 'id' | 'height';

export interface LayerDef {
  id: LayerId;
  name: string;
  kind: LayerKind;
  modeDefault: LayerMode;
  /** 显示父子（仅合成绘制，不做包含校验） */
  parentLayerId?: LayerId;
  /** 显示开关；缺省见 displayCompose.defaultLayerVisible */
  visible?: boolean;
  /** 叠加透明度 0–1；缺省按树深度 */
  opacity?: number;
  /** 核心地块符号（本层元素的 coreCellId 处画什么） */
  coreSymbol?: CoreSymbol;
  /** 逐 cell 装饰（本层元素的每个 cell 处画什么） */
  cellSymbol?: CellSymbol;
  /** 元素名称显示（name=元素名，coreLabel=核心标签） */
  labelMode?: LabelMode;
  /** cell 级标记（id/高度等） */
  cellMarker?: CellMarker;
  /** 纯网格底图层：不进语义叠画（如地块网格） */
  baseMesh?: boolean;
  allowOverlap: boolean;
  requireAdjacency: boolean;
  requireCenter: boolean;
  centerLabel?: string;
  styleSetId: string;
}

/** 元素名显示位置与参数（标签跟图层） */
export interface NamePlacement {
  cellId?: CellId;
  lon?: number;
  lat?: number;
  dx?: number;
  dy?: number;
  rotateDeg?: number;
  fontSize?: number;
  visible?: boolean;
}

/** 重叠关系：两元素共享地块（大重叠只记 count，sharedCells 可空） */
export interface ElementOverlap {
  elementId: string;
  type: 'complete' | 'partial';
  /** 大重叠时可为空数组，用 sharedCount */
  sharedCells?: CellId[];
  sharedCount?: number;
}

/**
 * 统一图层元素（= LayerElement）。
 * 所有图层共用同一结构，只是生成配置不同。
 */
export interface Region {
  id: RegionId;
  layerId: LayerId;
  name: string;
  cells: CellId[];
  /** 核心地块：首都 / 省会 / 文化中心 */
  centerCellId?: CellId;
  /** 别名：与 centerCellId 同义，语义更明确 */
  coreCellId?: CellId;
  /** 核心地块标签：「首都」「省会」… */
  coreLabel?: string;
  /** 兼容旧字段 */
  centerLabel?: string;
  /** 名称显示位置 */
  nameStyle?: NamePlacement;
  parentId?: RegionId;
  /** 基本色：与主元素一致；子元素不得单独改基本色 */
  color: string;
  /** 专属色：仅本元素，UI 上以边框内阴影呈现 */
  exclusiveColor?: string;
  attributes: Record<string, unknown>;
  weights?: Map<CellId, number>;
  /** 道路/航线：cellId → 覆盖端点（球面）；拖出多边形时清除归属 */
  endpointOverrides?: Map<CellId, LonLat>;
  /** 相邻元素 id（共享边） */
  adjacentElementIds?: Set<string>;
  /** 重叠关系（complete/partial + sharedCells） */
  overlaps?: ElementOverlap[];
}

export interface WorldMeta {
  seed: number;
  cellCount: number;
  formatVersion: number;
  createdAt: number;
}

/** 行星/气候参数（可调，影响环境/植物/动物生成） */
export interface ClimateParams {
  /** 黄赤交角（度） */
  axialTiltDeg: number;
  /** 自转周期（小时）——影响风带强度 */
  rotationHours: number;
  /** 顺行 true / 逆行 false → 信风/西风方向 */
  rotationPrograde: boolean;
  /** 含氧量 0.5–1.5，影响动物多样性 */
  oxygenLevel: number;
  /** 赤道海平面基准均温 ℃ */
  baseTemperatureC: number;
  /** 海陆热容：距海降水衰减 */
  oceanHeatCapacity: number;
}

export function defaultClimate(): ClimateParams {
  return {
    axialTiltDeg: 23.4,
    rotationHours: 24,
    rotationPrograde: true,
    oxygenLevel: 1,
    baseTemperatureC: 28,
    oceanHeatCapacity: 1,
  };
}

/** 每 cell 派生气候缓存（可重算，不必当真相持久化；序列化时可选） */
export interface CellClimate {
  temperatureC: number;
  /** 0–1 降水指数 */
  precipitation: number;
  /** 0–1 湿度 */
  humidity: number;
  /** 风向方位角弧度，0=东 */
  windAngle: number;
  /** 相对含氧 0–1.5 */
  oxygen: number;
  /** 海岸距离（度，粗） */
  coastDist: number;
}

export type BiomeId =
  | 'ocean'
  | 'coast'
  | 'ice'
  | 'snow'
  | 'tundra'
  | 'taiga'
  | 'temperate_forest'
  | 'grassland'
  | 'desert'
  | 'savanna'
  | 'rainforest'
  | 'wetland'
  | 'mountain';

/**
 * 道路/航线/河流：与 cell 无关的过点曲线。
 * points = 曲线上必过的控制点（≥2）；渲染用 Catmull-Rom 插值。
 */
export interface PathFeature {
  id: string;
  layerId: 'road' | 'route' | 'river';
  name: string;
  points: LonLat[];
  color: string;
  widthStart?: number;
  widthEnd?: number;
  attributes?: Record<string, unknown>;
}

/** @deprecated 旧结构，反序列化时迁移 */
export type BezierPath = PathFeature;

/** 元素样式：仅边界 / 内阴影 / 填充（三通道） */
import { defaultElementStyle } from './layer/style';
import { defaultStyleForLayer } from './layer/config';
export type { ElementStyle, ElementStylePatch } from './layer/style';
export {
  defaultElementStyle,
  normalizeStyle,
  patchElementStyle,
  clampElementStyle,
} from './layer/style';

/** 存档里的逐层样式（已归一为 ElementStyle） */
export type LayerRenderConfig = import('./layer/style').ElementStyle;
export type LayerStyle = import('./layer/style').ElementStyle;
export function defaultLayerStyle(layerId: string): import('./layer/style').ElementStyle {
  return defaultStyleForLayer(layerId);
}
export function defaultLayerRenderConfig(): import('./layer/style').ElementStyle {
  return defaultElementStyle();
}
export function defaultLayerStyleFor(layerId: string): import('./layer/style').ElementStyle {
  return defaultLayerStyle(layerId);
}

export interface World {
  meta: WorldMeta;
  cells: Cell[];
  /** 归一化无向边 key "a-b" (a<b) */
  rivers: Map<string, RiverEdge>;
  layers: LayerDef[];
  regions: Region[];
  /** 道路·航线·河流：过点曲线，与 cell 无关 */
  paths?: PathFeature[];
  climate: ClimateParams;
  /** cellId → 气候派生（与 cells 对齐的稀疏表） */
  cellClimate?: Map<CellId, CellClimate>;
  /** cellId → 群系 */
  biome?: Map<CellId, BiomeId>;
  /** 邻接 cell 对 "i-j"(i<j) → 共享 Voronoi 边两端 lonlat */
  sharedEdges?: Map<string, [LonLat, LonLat]>;
  /** 逐层渲染配置 */
  layerRenderConfig?: Map<LayerId, LayerRenderConfig>;
  /** 恒星系统 / 本星轨道与卫星（球面 3D 可视化） */
  astro?: StarSystem;
}
