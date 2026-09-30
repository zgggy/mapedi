/**
 * 抬起式拖动模型（图层 / 工作区共用）——单列网格，行高统一：
 * - 长按解锁后整个 ItemButton 被拿起来（浮动件跟指针）；其原位空槽闭合（紧凑布局）；
 * - 指针上方中心数 = 插入位 p；该格与下方元素整体下让一格（净位移 + 过渡动画）；
 * - 松手按最终顺序触发重排重算。
 */

/** 默认行高 40 + 行距 4 = 一格；行高随内容自适应时由面板传入实际格距 */
export const SLOT = 44;

export type FlatRow = { id: string; parentId: string | null };

export type RowRect = { idx: number; top: number; bottom: number };

export type DropPlan =
  | { kind: 'gap'; afterId: string | null; parentId: string | null; highlightParentId: string | null }
  | { kind: 'nest-first'; targetId: string };

/**
 * 抬起后每行的 Y 位移（px，相对原 DOM 格）。
 * 其余行排「紧凑 + 目标格 p 开口」：紧凑序 j = i - (i > d)；
 * 视觉格 = j < p ? j : j + 1。被拖行 d 不位移（原位由邻行覆盖，内容隐藏）。
 */
export function liftTransforms(n: number, d: number, p: number, slot = SLOT): number[] {
  const out = new Array<number>(n).fill(0);
  if (d < 0 || d >= n) return out;
  const pos = Math.max(0, Math.min(n - 1, p));
  for (let i = 0; i < n; i++) {
    if (i === d) continue;
    const j = i - (i > d ? 1 : 0);
    out[i] = ((j < pos ? j : j + 1) - i) * slot;
  }
  return out;
}

/**
 * 插入位 p（0..n-1）：指针上方的行中心数。
 * rects = 已渲染行的**拖动开始时**缓存矩形（不随让位动画漂移）；
 * windowStart = 首个已渲染行的绝对下标（虚拟窗口之前的行必在指针上方）。
 */
export function insertIndex(
  rects: RowRect[],
  dragIdx: number,
  windowStart: number,
  clientY: number,
): number {
  let p = Math.max(0, windowStart - (dragIdx < windowStart ? 1 : 0));
  for (const r of rects) {
    if (r.idx === dragIdx) continue;
    if (clientY > (r.top + r.bottom) / 2) p++;
  }
  return p;
}

/**
 * 统一行高：取所有行内容的最大高度（名称可换行完整显示），全列表等高。
 * 返回格距（行高 + 行距 SLOT_GAP）。
 */
export const SLOT_GAP = 4;

export function measureSlot(listEl: HTMLElement | undefined): number {
  if (!listEl) return SLOT;
  // 26 起步（第九轮：与把手行高精确相等——把手 = txt14 + padding12 = 26；名称换行由测量撑高）
  let need = 26;
  for (const b of listEl.querySelectorAll<HTMLElement>('.ibtn')) {
    const t = b.querySelector<HTMLElement>('.txt');
    const h = (t ? t.scrollHeight : 0) + 12;
    if (h > need) need = h;
  }
  need = Math.min(need, 120);
  listEl.style.setProperty('--ibtn-h', `${need}px`);
  return need + SLOT_GAP;
}

/**
 * 释放后的插入语义（扁平可见行序）：
 * - 落在某父展开行与其首子之间 → 作为该父的首子（nest-first）；
 * - 否则 → 插到 prev 之后（gap，同父兄弟语义）。
 */
export function insertPlan(rows: FlatRow[], d: number, k: number): DropPlan {
  const others = rows.filter((_, i) => i !== d);
  const pos = Math.max(0, Math.min(others.length, k));
  const prev = pos > 0 ? others[pos - 1] : null;
  const next = pos < others.length ? others[pos] : null;
  if (prev && next && next.parentId === prev.id) {
    return { kind: 'nest-first', targetId: prev.id };
  }
  const parentId = prev ? prev.parentId : next ? next.parentId : null;
  return {
    kind: 'gap',
    afterId: prev ? prev.id : null,
    parentId,
    highlightParentId: parentId,
  };
}
