/** UI 壳：左上图层 + 右侧工作区 + 顶栏项目区 */
export type ViewMode = 'view-2d' | 'view-globe';

export interface ShellState {
  layersOpen: boolean;
  workspaceOpen: boolean;
  projectOpen: boolean;
  settingsOpen: boolean;
  viewMode: ViewMode;
  leftW: number;
  rightW: number;
}

export function initialShell(): ShellState {
  return {
    layersOpen: true,
    workspaceOpen: false,
    projectOpen: false,
    settingsOpen: false,
    viewMode: 'view-2d',
    leftW: 200,
    rightW: 320,
  };
}
