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
 * 球面视图锁定 check（纯展示契约）。
 */
export type WsMode = 'check' | 'gen' | 'draw';

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
    return v === 'gen' || v === 'draw' ? v : 'check';
  } catch {
    return 'check';
  }
}

export interface ShellState {
  viewMode: ViewMode;
  /** 工作区三模式（球面锁定 check，切换由 App effect 强制） */
  wsMode: WsMode;
  leftW: number;
  rightW: number;
}

export function initialShell(): ShellState {
  return {
    viewMode: 'view-globe',
    wsMode: readWsMode(),
    leftW: 220,
    rightW: 320,
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
];
