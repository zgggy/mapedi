/** UI 壳：左上图层 + 右侧工作区 + 顶栏项目区 */
/**
 * 模式（顶栏视图区三格）：
 * - view-globe 球面展示（**默认**；纯展示无绘制；重新生成后回到此模式）
 * - view-2d 平面绘制（墨卡托/罗宾森，投影切换带动画）
 * - 第三格预留空占位（暂不接线）
 */
export type ViewMode = 'view-2d' | 'view-globe';

export interface ShellState {
  layersOpen: boolean;
  workspaceOpen: boolean;
  projectOpen: boolean;
  viewMode: ViewMode;
  leftW: number;
  rightW: number;
}

export function initialShell(): ShellState {
  return {
    layersOpen: true,
    workspaceOpen: false,
    projectOpen: false,
    viewMode: 'view-2d', // 默认平面绘制（用户定 2026-09-29：调试缝隙用；球面展示仍可手动切换）
    leftW: 200,
    rightW: 320,
  };
}
