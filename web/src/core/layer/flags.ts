/**
 * 层身份标志位的唯一读取口（2026-10-02 图层名标志位包）。
 *
 * 目标：消费点禁止再写 `layerId === 'height'` 这类身份字符串比较——
 * 语义（生成策略 / 生成后聚焦 / 高度域 / 网格底图）声明在 LayerDef 上，
 * 本模块提供缺省与查找；内置层的字段值由 builtinLayers 定义、
 * ensureBuiltinLayers 对旧档回填。
 */
import type { GenStrategy, LayerDef, LayerId, World } from '../types';

/** 焦点层缺省回落 = 网格底图层（产品默认视图：地块 cells，AGENTS §6） */
export const DEFAULT_FOCUS_LAYER_ID: LayerId = 'cells';

function layersOf(world: Pick<World, 'layers'> | undefined | null): LayerDef[] | undefined {
  return world?.layers;
}

/** 本层生成策略；未声明/未知层 = 'elements'（通用布局） */
export function genStrategyOf(
  world: Pick<World, 'layers'> | undefined | null,
  layerId: LayerId,
): GenStrategy {
  return layersOf(world)?.find((l) => l.id === layerId)?.genStrategy ?? 'elements';
}

/** 本层域是否为 cell 高度（区间元素、高度笔刷、overlay 高度标签） */
export function editsHeightAt(
  world: Pick<World, 'layers'> | undefined | null,
  layerId: LayerId,
): boolean {
  return layersOf(world)?.find((l) => l.id === layerId)?.editsHeight === true;
}

/** 焦点层缺省回落：网格底图层（baseMesh）→ 'cells' 兜底（与初始 focusLayer 同值） */
export function defaultFocusLayerId(
  world: Pick<World, 'layers'> | undefined | null,
): LayerId {
  return layersOf(world)?.find((l) => l.baseMesh)?.id ?? DEFAULT_FOCUS_LAYER_ID;
}

/**
 * heightmap 策略层的 id（worldShape ≡ 该层 profile 参数的类型化视图）。
 * 调用方保证传入含内置层的列表（world.layers 经 ensureBuiltinLayers 恒含 height；
 * 无 world 时传 builtinLayers()）——`?? 'height'` 仅作类型收窄。
 */
export function heightmapLayerId(layers: LayerDef[] | undefined): LayerId {
  return layers?.find((l) => l.genStrategy === 'heightmap')?.id ?? 'height';
}

/**
 * editsHeight 域层的 id（`__height__` 笔刷协议 → 所属层的显隐守卫等）。
 * 内置保证 height 层带此标志——`?? 'height'` 仅作类型收窄。
 */
export function editsHeightLayerId(layers: LayerDef[] | undefined): LayerId {
  return layers?.find((l) => l.editsHeight)?.id ?? 'height';
}
