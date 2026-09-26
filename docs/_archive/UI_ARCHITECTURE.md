# UI 架构（v2 壳层）

旧 FloatingPanel / 角点收纳 **已废弃**，主路径只保留本壳。

## 状态

```ts
ShellState {
  left: 'none' | 'layers'
  right: 'none' | 'settings' | 'workspace'
  settingsTab: 'generate' | 'view' | 'project'
  viewMode: 'view-2d' | 'view-globe'
}
```

开合规则：

- **同一侧**：点已开 → 关；点同侧另一钮 → **切换**  
- **左侧** 只有「图层」  
- **右侧**「设置」与「工作区」互斥切换  
- 顶栏不再做独立页签（生成/视图/项目收进 **设置抽屉** 内）

## 布局

```
┌──┬──────────────────────────────┬──┐
│📚│        MAP VIEWPORT          │⚙│
│左│                              │右│
│栏│                              │栏│
│  │                              │🛠│
├──┴──────────────────────────────┴──┤
│ 左下状态条          底部半透明笔刷HUD │
└─────────────────────────────────────┘
```

- 抽屉：**顶到底全高**，紧贴对应竖栏内侧  
- 绘制 HUD：底部居中、半透明  

## 文件

| 文件 | 职责 |
|------|------|
| `ui/shell/shell.ts` | 状态与 toggle 纯函数 |
| `ui/shell/Rail.svelte` | 竖栏按钮 |
| `ui/shell/SideDrawer.svelte` | 全高抽屉壳 |
| `ui/shell/LayersDrawer.svelte` | 图层列表 |
| `ui/shell/SettingsDrawer.svelte` | 生成/视图/项目 |
| `ui/shell/WorkspaceDrawer.svelte` | 工具+元素列表 |
| `ui/shell/StatusBar.svelte` | 左下状态 |
| `ui/shell/BrushHud.svelte` | 绘制 HUD |
| `App.svelte` | 视口 + 壳接线 |

业务状态仍在 `app/store.svelte.ts`（EditorStore）。
