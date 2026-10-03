/**
 * 图层树遍历单源（2026-10-03 HIERARCHY O2）。
 *
 * 此前四个消费者各写一遍 parent/children walk：
 * commandService.layerDisplayList（组织缩进/提升）、LayersPanel.rows（渲染）、
 * LayersPanel.chainOf（面包屑，2026-10-02 新增后达第四处）、
 * regionOps.childLayerIdOf（WD 子层展开等 6 处）——语义必须一致的不变量散落多处。
 *
 * 不变量（唯一定义处）：
 * - 兄弟序 = layers 数组出现序；前序 DFS（父必在子前）= 面板自上而下 =
 *   组织模式「视觉上一行」推理的锚点；
 * - parentLayerId 指向不存在的层 → 视为根（parentId null）；
 *   循环父子链不可从根达 → 不出现在结果里（与旧行为一致，禁环为设计约束）；
 * - chain = 祖先链面包屑（根在前、含直接父、不含自身，' › ' 连接，'' = 顶层）。
 */
import type { LayerDef, World } from '../types';

export interface LayerTreeRow {
  id: string;
  /** 有效父；根或父指向失效 → null */
  parentId: string | null;
  depth: number;
  /** 祖先链面包屑（根在前，含直接父，不含自身；'' = 顶层） */
  chain: string;
}

/** 图层树前序 DFS（一次 walk 产出 parentId/depth/chain 三个派生） */
export function layerTreeOf(
  world: Pick<World, 'layers'> | undefined | null,
): LayerTreeRow[] {
  const layers = world?.layers ?? [];
  const exists = new Set<string>(layers.map((l) => l.id));
  const children = new Map<string | null, LayerDef[]>();
  for (const l of layers) {
    const key = l.parentLayerId && exists.has(l.parentLayerId) ? l.parentLayerId : null;
    let arr = children.get(key);
    if (!arr) children.set(key, (arr = []));
    arr.push(l);
  }
  const out: LayerTreeRow[] = [];
  /** chainOfPid = walk(pid) 入参链（含 pid 自身名）；子行 chain 即此链 */
  const walk = (pid: string | null, depth: number, chainOfPid: string) => {
    for (const l of children.get(pid) ?? []) {
      out.push({ id: l.id, parentId: pid, depth, chain: chainOfPid });
      const own = l.name || l.id;
      walk(l.id, depth + 1, chainOfPid ? `${chainOfPid} › ${own}` : own);
    }
  };
  walk(null, 0, '');
  return out;
}

/** 该层的第一个子层（数组序；无 → null）。原 regionOps.childLayerIdOf 收编。 */
export function childLayerIdOf(
  world: Pick<World, 'layers'>,
  layerId: string,
): string | null {
  return world.layers.find((l) => l.parentLayerId === layerId)?.id ?? null;
}
