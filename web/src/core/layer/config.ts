/**
 * 图层 = 配置实例（不是子类）。
 * 能力差异全部落在参数：placement / splitPolicy / style / workspace / gen。
 */
import type { LayerId, LayerKind, World } from '../types';
import { isLand } from '../types';
import type { ElementStyle, ElementStylePatch } from './style';
import {
  cloneElementStyle,
  defaultElementStyle,
  normalizeStyle,
  patchElementStyle,
} from './style';
import type { GenMethod, GenScope, GenPattern, CoreSelector } from './genTypes';

export type SplitPolicy = 'newElement' | 'keepEnclave' | 'reject';
export type LandSeaRule = 'landOnly' | 'oceanOnly' | 'any' | 'noCrossLandSea';
export type ElementSource = 'explicit' | 'derivedFromHeight' | 'onePerCell';

export interface PlacementRule {
  landSea: LandSeaRule;
  heightMin?: number;
  heightMax?: number;
}

export interface LayerGenParams {
  method: GenMethod;
  scope: GenScope;
  pattern: GenPattern;
  coreSelector: CoreSelector;
  count: number;
  fromLayerCount?: number;
  /** 海国等：勾选才生成海上元素 */
  allowOcean: boolean;
  diffusion?: { falloff: number; radius: number; roughness: number; peakHeight: number };
}

export interface LayerConfig {
  id: LayerId;
  name: string;
  kind: LayerKind;
  elementSource: ElementSource;
  splitPolicy: SplitPolicy;
  placement: PlacementRule;
  gen: LayerGenParams;
  style: ElementStyle;
  workspace: {
    listElements: boolean;
  };
  /** 高度层 12 区间等固定元素，生成不增删 */
  fixedElements?: boolean;
}

function style(
  patch: Partial<ElementStyle> = {},
): ElementStyle {
  const s = defaultElementStyle();
  return {
    border: { ...s.border, ...(patch.border ?? {}) },
    fill: { ...s.fill, ...(patch.fill ?? {}) },
  };
}

function genBase(count: number): LayerGenParams {
  return {
    method: 'randomConnected',
    scope: 'unlimited',
    pattern: 'scattered',
    coreSelector: 'random',
    count,
    allowOcean: false,
  };
}

export function defaultLayerConfigs(): LayerConfig[] {
  return [
    {
      id: 'cells',
      name: '地块',
      kind: 'custom',
      elementSource: 'onePerCell',
      splitPolicy: 'reject',
      placement: { landSea: 'any' },
      // 性能参数：关阴影/填充——是配置
      gen: { ...genBase(0), method: 'randomConnected' },
      style: style({
        border: { enabled: true, width: 0.8, color: '#ffffff', smooth: 0 },
        fill: { enabled: false, alpha: 0, color: '#C4A882' },
      }),
      workspace: { listElements: false },
    },
    {
      id: 'height',
      name: '高度',
      kind: 'height',
      elementSource: 'derivedFromHeight',
      splitPolicy: 'keepEnclave',
      placement: { landSea: 'any' },
      gen: {
        ...genBase(6),
        method: 'diffusion',
        scope: 'unlimited',
        pattern: 'cluster',
        diffusion: { falloff: 2, radius: 0.6, roughness: 0.8, peakHeight: 0.8 },
      },
      style: style({
        border: { enabled: true, width: 1.0, color: '#ffffff', smooth: 1 },
        fill: { enabled: true, alpha: 0.9, color: '#888888' },
      }),
      workspace: { listElements: true },
      fixedElements: true,
    },
    {
      id: 'province',
      name: '行省',
      kind: 'political',
      elementSource: 'explicit',
      splitPolicy: 'keepEnclave',
      placement: { landSea: 'noCrossLandSea' },
      gen: {
        ...genBase(15),
        scope: 'noCrossLandSea',
        pattern: 'partitionLand',
      },
      style: style(),
      workspace: { listElements: true },
    },
    {
      id: 'country',
      name: '国家',
      kind: 'political',
      elementSource: 'explicit',
      splitPolicy: 'keepEnclave',
      placement: { landSea: 'landOnly' },
      gen: {
        ...genBase(8),
        method: 'fromLayer',
        scope: 'landOnly',
        pattern: 'partitionLand',
        coreSelector: 'centermost',
        fromLayerCount: 3,
        allowOcean: false,
      },
      style: style(),
      workspace: { listElements: true },
    },
    {
      id: 'ecosystem',
      name: '生态',
      kind: 'ecosystem',
      elementSource: 'explicit',
      splitPolicy: 'keepEnclave',
      placement: { landSea: 'landOnly' },
      gen: { ...genBase(12), scope: 'landOnly', pattern: 'cluster' },
      style: style(),
      workspace: { listElements: true },
    },
    {
      id: 'race',
      name: '种族',
      kind: 'race',
      elementSource: 'explicit',
      splitPolicy: 'keepEnclave',
      placement: { landSea: 'landOnly' },
      gen: { ...genBase(5), scope: 'landOnly', pattern: 'partitionLand' },
      style: style(),
      workspace: { listElements: true },
    },
    {
      id: 'culture',
      name: '文化',
      kind: 'cultural',
      elementSource: 'explicit',
      splitPolicy: 'keepEnclave',
      placement: { landSea: 'any' },
      gen: {
        ...genBase(8),
        scope: 'landOnly',
        pattern: 'cluster',
        coreSelector: 'highElevation',
        allowOcean: false,
      },
      style: style(),
      workspace: { listElements: true },
    },
  ];
}

export function defaultLayerConfig(id: LayerId): LayerConfig {
  const list = defaultLayerConfigs();
  return (
    list.find((c) => c.id === id) ?? {
      ...list[0],
      id,
      name: id,
      style: cloneElementStyle(list[0].style),
    }
  );
}

/** 本层默认样式（height 阴影默认关等） */
export function defaultStyleForLayer(id: LayerId): ElementStyle {
  return cloneElementStyle(defaultLayerConfig(id).style);
}

/**
 * 合并**视图覆盖**与存档覆盖 → 完整样式（唯一入口，渲染/面板共用）。
 * 链 = 静态默认 → 视图级默认（StyleSet.layerStyles，2026-10-06 架构：不同视图下各图层
 * 颜色集与默认显示参数不同）→ 存档覆盖（存档优先：用户显式调过的不被视图压掉）。
 * **写入侧不吃视图层**（setLayerStyle 走无 style 的数据基线）——存档零污染、切视图不残留。
 */
export function resolveLayerStyle(
  world: { layerRenderConfig?: Map<string, unknown> } | null | undefined,
  id: LayerId,
  style?: { layerStyles?: Record<string, ElementStylePatch> } | null,
): ElementStyle {
  let base = defaultStyleForLayer(id);
  const viewPatch = style?.layerStyles?.[id];
  if (viewPatch) base = patchElementStyle(base, viewPatch);
  const stored = world?.layerRenderConfig?.get(id);
  if (!stored) return base;
  return patchElementStyle(base, normalizeStyle(stored) as ElementStylePatch);
}

/** placement 闸门：绘制/生成能否落在该 cell */
export function placementAllows(
  world: World,
  rule: PlacementRule,
  cellId: number,
): boolean {
  const c = world.cells[cellId];
  if (!c) return false;
  const land = isLand(c);
  switch (rule.landSea) {
    case 'landOnly':
      if (!land) return false;
      break;
    case 'oceanOnly':
      if (land) return false;
      break;
    case 'noCrossLandSea':
    case 'any':
      break;
  }
  if (rule.heightMin !== undefined && c.height < rule.heightMin) return false;
  if (rule.heightMax !== undefined && c.height > rule.heightMax) return false;
  return true;
}
