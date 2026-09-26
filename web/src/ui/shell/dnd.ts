/**
 * 指针拖放：不依赖 HTML5 Drag-and-Drop（部分浏览器从 button 起拖无效）。
 * 列表行 pointerdown → 位移超阈值 → 计算缝/nest hint → pointerup 提交。
 */

export type DropHint =
  | { kind: 'gap'; afterId: string | null; parentId: string | null; highlightParentId: string | null }
  | { kind: 'nest-first'; targetId: string }
  | { kind: 'nest'; targetId: string }
  | { kind: 'promote' };

export type RowMeta = {
  id: string;
  depth: number;
  parentId: string | null;
  nestable: boolean;
};

export type RowRect = { id: string; top: number; bottom: number; left: number; right: number };

export function prevSiblingId(
  rows: { id: string; parentId: string | null }[],
  rowId: string,
): string | null {
  const row = rows.find((r) => r.id === rowId);
  if (!row) return null;
  const pid = row.parentId ?? null;
  let prev: string | null = null;
  for (const r of rows) {
    if (r.id === rowId) break;
    if ((r.parentId ?? null) === pid) prev = r.id;
  }
  return prev;
}

export function hintForRow(
  clientY: number,
  rect: { top: number; height: number },
  row: RowMeta,
  prevSibling: string | null,
): DropHint {
  const y = clientY - rect.top;
  const h = Math.max(rect.height, 1);
  const t = y / h;
  if (t < 0.32) {
    return {
      kind: 'gap',
      afterId: prevSibling,
      parentId: row.parentId,
      highlightParentId: row.parentId,
    };
  }
  if (t > 0.68) {
    return {
      kind: 'gap',
      afterId: row.id,
      parentId: row.parentId,
      highlightParentId: row.parentId,
    };
  }
  if (row.nestable) return { kind: 'nest', targetId: row.id };
  return {
    kind: 'gap',
    afterId: row.id,
    parentId: row.parentId,
    highlightParentId: row.parentId,
  };
}

export function hintForShell(
  hint: DropHint | null,
  rowId: string,
  rows: RowMeta[],
): null | { kind: 'gap-top' | 'gap-bottom' | 'nest'; targetId: string; parentId: string | null } {
  if (!hint) return null;
  if (hint.kind === 'nest' || hint.kind === 'nest-first') {
    return hint.targetId === rowId
      ? { kind: 'nest', targetId: rowId, parentId: null }
      : null;
  }
  if (hint.kind !== 'gap') return null;
  const row = rows.find((r) => r.id === rowId);
  if (!row) return null;
  const pid = row.parentId ?? null;

  if (hint.afterId === rowId) {
    return { kind: 'gap-bottom', targetId: rowId, parentId: hint.parentId };
  }
  if (hint.afterId !== null) {
    const after = rows.find((r) => r.id === hint.afterId);
    if (after && (after.parentId ?? null) === pid) {
      const sibs = rows.filter((r) => (r.parentId ?? null) === pid);
      const ai = sibs.findIndex((r) => r.id === hint.afterId);
      const ci = sibs.findIndex((r) => r.id === rowId);
      if (ai >= 0 && ci === ai + 1) {
        return { kind: 'gap-top', targetId: rowId, parentId: hint.parentId };
      }
    }
    return null;
  }
  if (hint.afterId === null) {
    const sibs = rows.filter((r) => (r.parentId ?? null) === pid);
    if (sibs[0]?.id === rowId) {
      return { kind: 'gap-top', targetId: rowId, parentId: hint.parentId };
    }
  }
  return null;
}

/** 根据指针 Y 与行矩形列表，找到命中行并生成 hint */
export function hintAtPoint(
  clientY: number,
  rects: RowRect[],
  rows: RowMeta[],
): DropHint | null {
  let hit: RowRect | null = null;
  for (const r of rects) {
    if (clientY >= r.top && clientY <= r.bottom) {
      hit = r;
      break;
    }
  }
  if (!hit) {
    // 列表末端：插到最后一个同父兄弟之后
    if (!rects.length || !rows.length) return null;
    const lastId = rects[rects.length - 1].id;
    const last = rows.find((r) => r.id === lastId);
    if (!last) return null;
    return {
      kind: 'gap',
      afterId: lastId,
      parentId: last.parentId,
      highlightParentId: last.parentId,
    };
  }
  const row = rows.find((r) => r.id === hit!.id);
  if (!row) return null;
  return hintForRow(clientY, { top: hit.top, height: hit.bottom - hit.top }, row, prevSiblingId(rows, row.id));
}

export const DRAG_THRESHOLD = 6;
