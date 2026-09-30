/**
 * 列表行高统一（2026-09-30 第十轮：**抬起式拖动已退役**，由组织模式
 * （上移/下移/缩进/提升）替代——liftTransforms/insertIndex/insertPlan/FlatRow 已删）。
 * 本文件只保留等高测量：所有行按头部 .txt 取最大高度，全列表等高。
 */

/** 默认行高 26 + 行距 4 = 一格；行高随内容自适应时由面板传入实际格距 */
export const SLOT = 30;

export const SLOT_GAP = 4;

export function measureSlot(listEl: HTMLElement | undefined): number {
  if (!listEl) return SLOT;
  // 26 起步（与把手行高精确相等——把手 = txt14 + padding12 = 26；名称换行由测量撑高）
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
