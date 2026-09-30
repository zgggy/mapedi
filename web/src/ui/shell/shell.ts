/** UI 壳：顶栏 + 左侧轨 + 底栏（设计稿 docs/UI_REFACTOR_2026-09-29.md） */
/**
 * 模式（顶栏模式胶囊，两档）：
 * - view-globe 球面展示（**默认**，2026-09-30 用户拍板 A；纯展示无绘制；重新生成后回到此模式）
 * - view-2d 平面绘制（墨卡托/罗宾森，投影切换带动画）
 * 未来加模式 = 胶囊加档位（离散多档天然扩展）。
 */
export type ViewMode = 'view-2d' | 'view-globe';

export interface ShellState {
  layersOpen: boolean;
  workspaceOpen: boolean;
  projectOpen: boolean;
  viewMode: ViewMode;
  leftW: number;
  rightW: number;
  /** 顶栏世界名菜单（瞬态，body 级挂载避免被面板 overflow 截断） */
  worldMenuOpen: boolean;
  /** 顶栏 ⚙ 视图设置 popover（瞬态） */
  viewSettingsOpen: boolean;
}

export function initialShell(): ShellState {
  return {
    layersOpen: true,
    workspaceOpen: false,
    projectOpen: false,
    viewMode: 'view-globe',
    leftW: 200,
    rightW: 320,
    worldMenuOpen: false,
    viewSettingsOpen: false,
  };
}
