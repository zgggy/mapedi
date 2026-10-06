/**
 * 派生层规则运行器（2026-10-06 包 D · 北极星对齐）：preset + 参数集 → **普通 Region**。
 *
 * 公理落地：「图层 = 元素集合 × 规则」——规则（cell 属性 → 占据）属生成/重算期产线；
 * 运行产物就是普通 `Region.cells`（照常存储/渲染/存档/撤销语义与它层一致）。
 * 规则 = **内置 preset + 参数**（禁用户表达式——北极星原文 §8「不写代码、不解析谓词」）；
 * 新增一种规则 = 在 PRESETS 加一个条目，不动存储/渲染（判据 #2）。
 *
 * 触发 = 显式「运行派生」（生成面板 → generationService.regenLayer 的 derived 分支）；
 * **不做自动跟随重算**（高度改动后不自动重跑——全局重算红线）。
 * 不走 registry/Worker：一次高度扫描、主线程直跑（便宜）。
 *
 * 幂等：同高度同 spec → 同结果；重跑替换本层元素（id 稳定 `${layerId}-a`/`-b`）。
 * 元素为**创建**（工厂），按包 C 契约不经 occupy.writeCells（创建字面量 ≠ 改写既有归属）。
 */
import type { CellId, DerivationSpec, Region, World } from '../types';

/** 派生层默认规则（建层时写进 LayerDef.derivation；用户可在生成面板改参数） */
export const DEFAULT_DERIVATION: DerivationSpec = {
  preset: 'heightThreshold',
  params: { threshold: 0 },
};

/** 单个派生元素的形状声明（preset 输出） */
interface DerivedElementSpec {
  /** id 后缀（稳定 → 重跑幂等） */
  key: string;
  name: string;
  color: string;
  /** cell 是否属于本元素（**首个命中即停**，preset 内应互斥完备） */
  test: (h: number) => boolean;
}

/** preset 表：新增规则只加条目（参数集随 preset 自带，不做表达式解析） */
const PRESETS: Record<DerivationSpec['preset'], (spec: DerivationSpec) => DerivedElementSpec[]> = {
  /** 用户例（2026-10-06 公理讨论）：「高度大于零=陆地，否则=海洋」——界点归属：等于界 → B 侧 */
  heightThreshold: (spec) => {
    const t = Math.round(spec.params.threshold ?? 0);
    return [
      {
        key: 'a',
        name: spec.params.aname?.trim() || '陆地',
        color: '#4a7a3a',
        test: (h) => h > t,
      },
      {
        key: 'b',
        name: spec.params.bname?.trim() || '海洋',
        color: '#2a6a9b',
        test: () => true, // 兜底（A 未命中即 B）
      },
    ];
  },
};

/** 运行派生规则：重建本层元素（返回新元素；world.regions 已替换本层部分） */
export function runDerivation(world: World, layerId: string, spec: DerivationSpec): Region[] {
  const make = PRESETS[spec.preset] ?? PRESETS.heightThreshold;
  const defs = make(spec);
  const buckets: CellId[][] = defs.map(() => []);
  for (const c of world.cells) {
    const h = Math.round(c.height);
    for (let i = 0; i < defs.length; i++) {
      if (defs[i].test(h)) {
        buckets[i].push(c.id);
        break;
      }
    }
  }
  const els: Region[] = defs.map((d, i) => ({
    id: `${layerId}-${d.key}`,
    layerId,
    name: d.name,
    cells: buckets[i],
    color: d.color,
    attributes: { derived: spec.preset },
  }));
  world.regions = world.regions.filter((r) => r.layerId !== layerId).concat(els);
  return els;
}
