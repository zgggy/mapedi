/**
 * 面板长列表虚拟化：固定估算行高 + overscan。
 * 拖放用合成 rect（未挂载行也有几何）。
 */
export const ROW_EST = 40;
export const VIRTUAL_MIN = 72;

export type ListWindow = {
  start: number;
  end: number;
  padTop: number;
  padBottom: number;
  total: number;
};

export function listWindow(
  count: number,
  scrollTop: number,
  viewportH: number,
  rowH = ROW_EST,
  overscan = 8,
): ListWindow {
  if (count <= 0) return { start: 0, end: 0, padTop: 0, padBottom: 0, total: 0 };
  const total = count * rowH;
  const start = Math.max(0, Math.floor(Math.max(0, scrollTop) / rowH) - overscan);
  const end = Math.min(count, Math.ceil((Math.max(0, scrollTop) + Math.max(viewportH, rowH)) / rowH) + overscan);
  return {
    start,
    end,
    padTop: start * rowH,
    padBottom: Math.max(0, (count - end) * rowH),
    total,
  };
}

export type SynthRect = { id: string; top: number; bottom: number; left: number; right: number };

/** 测试/预览助手：按 id 序合成行矩形（可跳过被拖行），行高 rowH 自 startTop 起排 */
export function syntheticRowRects(
  ids: string[],
  startTop: number,
  rowH: number,
  skipId?: string,
): SynthRect[] {
  const out: SynthRect[] = [];
  let top = startTop;
  for (const id of ids) {
    if (id === skipId) continue;
    out.push({ id, top, bottom: top + rowH, left: 0, right: 100 });
    top += rowH;
  }
  return out;
}
