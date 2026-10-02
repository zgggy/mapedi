/** UI 壳（2026-09-30 第六轮终稿：顶栏 + 左栏三块——胶囊行 / 图层面板 / 工作区面板） */
/**
 * 视图模式（顶栏模式胶囊，两档）：
 * - view-globe 球面展示（**默认**；纯展示无绘制；重新生成后回到此模式）
 * - view-2d 平面编辑（2026-09-30 更名，避免与工作区「绘制模式」撞词）
 * 未来加模式 = 胶囊加档位（离散多档天然扩展）。
 */
export type ViewMode = 'view-2d' | 'view-globe';

/**
 * 工作区任务模式（左栏顶三档胶囊，2026-09-30 拍板）：
 * - check 检查：展开区 = 信息/显示参数
 * - gen 生成：展开区 = 生成参数
 * - draw 绘制：展开区 = 绘制参数；**展开的元素 = 选中并被绘制**（全收起 = 无绘制能力）
 * - organize 组织：展开区 = 上移/下移/缩进/提升（树结构调整；拖动排序已退役，2026-09-30）
 * 球面视图锁定 check（纯展示契约）。
 */
export type WsMode = 'check' | 'gen' | 'draw' | 'organize';

/** UI 偏好持久化命名空间（设计稿 §7：mapedi.ui.*） */
const UI_NS = 'mapedi.ui';

function readBool(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? dflt : v === '1';
  } catch {
    // 无 localStorage（隐私模式/沙箱）：用缺省值，不影响功能
    return dflt;
  }
}

function writeBool(key: string, v: boolean): void {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    /* 写不进就不持久化 */
  }
}

/** 左栏两面板开合（2026-09-30 终稿：图层/工作区各自收起为一行；替代 railOpen） */
/**
 * 空白点击守卫（两面板**统一语义**，2026-10-02 收敛单源）：
 * 落在「行内（含其展开体 [data-row-id]）或交互控件」上的点击不算空白，不得收起/清选。
 * 背景：此前图层面板带 [data-row-id] 守卫、元素面板只挡 button/input——点元素展开区
 * 里的文字/标签/chip 会直接把选中清掉（面板闪没），两面板行为不一致（用户指出）。
 */
export function isRowOrControlClick(e: { target: EventTarget | null }): boolean {
  const t = e.target as HTMLElement | null;
  return !!(t?.closest?.('[data-row-id]') || t?.closest?.('button,input,select,textarea'));
}

export function persistPanelOpen(which: 'layers' | 'ws', v: boolean): void {
  writeBool(`${UI_NS}.panel.${which}`, v);
}
export function readPanelOpen(which: 'layers' | 'ws', dflt: boolean): boolean {
  return readBool(`${UI_NS}.panel.${which}`, dflt);
}

export function persistWsMode(v: WsMode): void {
  try {
    localStorage.setItem(`${UI_NS}.wsMode`, v);
  } catch {
    /* 不持久化 */
  }
}

export function readWsMode(): WsMode {
  try {
    const v = localStorage.getItem(`${UI_NS}.wsMode`);
    return v === 'gen' || v === 'draw' || v === 'organize' ? v : 'check';
  } catch {
    return 'check';
  }
}

export interface ShellState {
  viewMode: ViewMode;
  /** 工作区三模式（球面锁定 check，切换由 App effect 强制） */
  wsMode: WsMode;
  /* 第七轮：左栏宽度 = max-content 实测回传（LeftRail ResizeObserver），固定 leftW/rightW 退役 */
}

export function initialShell(): ShellState {
  return {
    viewMode: 'view-globe',
    wsMode: readWsMode(),
  };
}

/** 顶栏视图模式两档（ModeCapsule items；2026-09-30 通用化） */
export const VIEW_MODE_ITEMS = [
  { id: 'view-globe', icon: '🌐', label: '球面展示' },
  { id: 'view-2d', icon: '✏️', label: '平面编辑' },
];

/** 左栏工作区三模式三档（检查 / 生成 / 绘制；2026-09-30 E 系拍板） */
export const WS_MODE_ITEMS = [
  { id: 'check', icon: '🔍', label: '检查' },
  { id: 'gen', icon: '🎲', label: '生成' },
  { id: 'draw', icon: '✏️', label: '绘制' },
  { id: 'organize', icon: '🗂', label: '组织' },
];
