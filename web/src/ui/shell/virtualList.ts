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
