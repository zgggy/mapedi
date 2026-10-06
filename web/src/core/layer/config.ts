/**
 * 图层 = 配置实例（不是子类）。
 * 能力差异全部落在参数：placement / style（生成侧=core/layer.ts defaultGenConfig + GenStrategy）。
 * 2026-10-06 包 D 词汇收编：删 `splitPolicy`（无实现、无人声明、零测试）、`elementSource`
 * 与 `workspace`（零消费者）、`gen`（零读取者，其 country coreSelector 还与活配置漂移）。
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

export type LandSeaRule = 'landOnly' | 'oceanOnly' | 'any' | 'noCrossLandSea';

export interface PlacementRule {
  landSea: LandSeaRule;
  heightMin?: number;
  heightMax?: number;
}

export interface LayerConfig {
  id: LayerId;
  name: string;
  kind: LayerKind;
  placement: PlacementRule;
  style: ElementStyle;
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

export function defaultLayerConfigs(): LayerConfig[] {
  return [
    {
      id: 'cells',
      name: '地块',
      kind: 'custom',
      placement: { landSea: 'any' },
      style: style({
        border: { enabled: true, width: 0.8, color: '#ffffff', smooth: 0 },
        fill: { enabled: false, alpha: 0, color: '#C4A882' },
      }),
    },
    {
      id: 'height',
      name: '高度',
      kind: 'height',
      placement: { landSea: 'any' },
      style: style({
        border: { enabled: true, width: 1.0, color: '#ffffff', smooth: 1 },
        fill: { enabled: true, alpha: 0.9, color: '#888888' },
      }),
      fixedElements: true,
    },
    {
      id: 'province',
      name: '行省',
      kind: 'political',
      placement: { landSea: 'noCrossLandSea' },
      style: style(),
    },
    {
      id: 'country',
      name: '国家',
      kind: 'political',
      placement: { landSea: 'landOnly' },
      style: style(),
    },
    {
      id: 'ecosystem',
      name: '生态',
      kind: 'ecosystem',
      placement: { landSea: 'landOnly' },
      style: style(),
    },
    {
      id: 'race',
      name: '种族',
      kind: 'race',
      placement: { landSea: 'landOnly' },
      style: style(),
    },
    {
      id: 'culture',
      name: '文化',
      kind: 'cultural',
      placement: { landSea: 'any' },
      style: style(),
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
