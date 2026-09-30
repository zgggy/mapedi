/** UI 壳：顶栏 + 左侧轨 + 底栏（设计稿 docs/UI_REFACTOR_2026-09-29.md） */
/**
 * 视图模式（顶栏模式胶囊，两档）：
 * - view-globe 球面展示（**默认**，2026-09-30 用户拍板 A；纯展示无绘制；重新生成后回到此模式）
 * - view-2d 平面编辑（2026-09-30 更名，避免与工作区「绘制模式」撞词；墨卡托/罗宾森，投影切换带动画）
 * 未来加模式 = 胶囊加档位（离散多档天然扩展）。
 */
export type ViewMode = 'view-2d' | 'view-globe';

/**
 * 工作区任务模式（左面板顶三段 tab，2026-09-30 用户拍板）：
 * - check 检查：展开区 = 信息/显示参数
 * - gen 生成：展开区 = 生成参数（图层/元素）
 * - draw 绘制：展开区 = 绘制参数；**展开的元素 = 选中并被绘制**（全收起 = 无绘制能力）
 * 球面视图锁定 check（纯展示契约）。持久化在平面视图间记忆。
 */
export type WsMode = 'check' | 'gen' | 'draw';

/** UI 偏好持久化命名空间（设计稿 §7：mapedi.ui.*） */
const UI_NS = 'mapedi.ui';

/** 左轨开合（§3.5 收起整轨 → 左上角圆钮；状态持久化） */
const RAIL_KEY = `${UI_NS}.rail`;
/** 工作区模式（平面视图内记忆；球面强制 check） */
const WSMODE_KEY = `${UI_NS}.wsMode`;

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
    /* 同上：写不进就不持久化 */
  }
}

export function persistRailOpen(v: boolean): void {
  writeBool(RAIL_KEY, v);
}

export function persistWsMode(v: WsMode): void {
  try {
    localStorage.setItem(WSMODE_KEY, v);
  } catch {
    /* 不持久化 */
  }
}

export function readWsMode(): WsMode {
  try {
    const v = localStorage.getItem(WSMODE_KEY);
    return v === 'gen' || v === 'draw' ? v : 'check';
  } catch {
    return 'check';
  }
}

export interface ShellState {
  /** 左轨整体开合（§3.5，localStorage 持久化） */
  railOpen: boolean;
  viewMode: ViewMode;
  /** 工作区三模式（球面锁定 check，切换由 App effect 强制） */
  wsMode: WsMode;
  leftW: number;
  rightW: number;
}

export function initialShell(): ShellState {
  return {
    railOpen: readBool(RAIL_KEY, true),
    viewMode: 'view-globe',
    wsMode: readWsMode(),
    leftW: 220,
    rightW: 320,
  };
}
