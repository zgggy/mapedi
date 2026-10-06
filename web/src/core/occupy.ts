/**
 * 占据写入器（2026-10-06 包 C · 北极星对齐）：`Region.cells` 的**唯一写入入口**。
 *
 * 只有三件事（**记账点，不是管家**）：
 * - **COW 写**：`region.cells = next`——`next` 必须是调用方独占的新数组（`$state.raw` 下原地改
 *   不触发响应链；undo 快照-diff 依赖引用比对，原地改会漏副作用）。
 * - **Δ 记账**：`opts.delta` 已知差直用（热路径零额外扫描，数组借用、只读契约），否则自算 diff。
 * - **审计钩子**：`setOccupyObserver`（默认 null = 生产零开销；探针/测试用）。
 *
 * **不做**（职责边界，写进契约）：
 * - 失效分发——绘制域失效时机在 commit（`DrawController.commitStroke` 快照-diff + 定向失效），
 *   写点顺带失效会回到「写一半就失效」的老坑；cause→touch 表化归包 F。
 * - 物化（父=子并集）——`materializeBackPropagate` 是**调用者**，自身也经本写入器。
 * - 校验拦截——`setOccupyGuard` 是包 E 预留的**拒名单**闸（返回非 null = 这些 added 不落写），
 *   默认 null 不拦截。
 *
 * 不变量：① 集合无增无减（仅顺序变）→ 仍写、但 Δ 记账返回 null；
 * ② `next === region.cells`（同引用）→ 完全无操作；
 * ③ 生成器的「创建字面量」不经此（对象构造，不是对既有归属的改写）。
 */
import type { CellId, Region } from './types';

export type OccupyCause = 'paint' | 'height' | 'materialize' | 'generate' | 'undo' | 'repair';

export interface CellsDelta {
  regionId: string;
  layerId: string;
  /** 借用（调用方数组，只读契约） */
  added: readonly CellId[];
  removed: readonly CellId[];
}

export type OccupyObserver = (delta: CellsDelta, cause: OccupyCause) => void;
/** 拒名单闸（包 E 预留；默认 null=不拦截）：返回非 null = 这些 added 不落写 */
export type OccupyGuard = (region: Region, added: readonly CellId[], cause: OccupyCause) => CellId[] | null;

let observer: OccupyObserver | null = null;
let guard: OccupyGuard | null = null;

export function setOccupyObserver(fn: OccupyObserver | null): void {
  observer = fn;
}
export function setOccupyGuard(fn: OccupyGuard | null): void {
  guard = fn;
}

/** 唯一写入器：COW 写 + Δ 记账 + 审计。集合无变化时仍写（换引用），但返回 null。 */
export function writeCells(
  region: Region,
  next: CellId[],
  cause: OccupyCause,
  opts?: { delta?: { added: CellId[]; removed: CellId[] } },
): CellsDelta | null {
  if (next === region.cells) return null;
  let added: readonly CellId[];
  let removed: readonly CellId[];
  if (opts?.delta) {
    added = opts.delta.added;
    removed = opts.delta.removed;
  } else {
    const oldSet = new Set(region.cells);
    const newSet = new Set(next);
    const a: CellId[] = [];
    const r: CellId[] = [];
    for (const id of newSet) if (!oldSet.has(id)) a.push(id);
    for (const id of oldSet) if (!newSet.has(id)) r.push(id);
    added = a;
    removed = r;
  }
  let target = next;
  if (guard && added.length) {
    const rejected = guard(region, added, cause);
    if (rejected?.length) {
      const drop = new Set(rejected);
      target = next.filter((id) => !drop.has(id));
      added = added.filter((id) => !drop.has(id));
    }
  }
  region.cells = target;
  if (!added.length && !removed.length) return null;
  const delta: CellsDelta = { regionId: region.id, layerId: region.layerId, added, removed };
  observer?.(delta, cause);
  return delta;
}
