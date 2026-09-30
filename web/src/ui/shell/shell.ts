/** UI 壳：顶栏 + 左侧轨 + 底栏（设计稿 docs/UI_REFACTOR_2026-09-29.md） */
/**
 * 模式（顶栏模式胶囊，两档）：
 * - view-globe 球面展示（**默认**，2026-09-30 用户拍板 A；纯展示无绘制；重新生成后回到此模式）
 * - view-2d 平面绘制（墨卡托/罗宾森，投影切换带动画）
 * 未来加模式 = 胶囊加档位（离散多档天然扩展）。
 */
export type ViewMode = 'view-2d' | 'view-globe';

/** UI 偏好持久化命名空间（设计稿 §7：mapedi.ui.*） */
const UI_NS = 'mapedi.ui';

/** 左轨开合（§3.5 收起整轨 → 左上角圆钮；状态持久化） */
const RAIL_KEY = `${UI_NS}.rail`;

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

export interface ShellState {
  /** 左轨整体开合（§3.5，localStorage 持久化） */
  railOpen: boolean;
  projectOpen: boolean;
  viewMode: ViewMode;
  leftW: number;
  rightW: number;
}

export function initialShell(): ShellState {
  return {
    railOpen: readBool(RAIL_KEY, true),
    projectOpen: false,
    viewMode: 'view-globe',
    leftW: 220,
    rightW: 320,
  };
}
