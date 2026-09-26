# Mapedi

球面奇幻地图编辑器（跑团 / 桌游 / 世界观设定）。

**请读**：`AGENTS.md` · `RENDER_LOGIC.md` · `HANDOFF.md`  
**归档（勿参考）**：`docs/_archive/`  


星球级架空地图编辑器（开发中）。

- 当前显示契约：`RENDER_LOGIC.md`
- 世界观实体设计（未实施）：`DESIGN_ENTITIES.md`
- 应用：`web/`

```bash
cd web
npm install
npm run dev
```

```bash
cd web && npm test && npm run build
```

当前可运行：Voronoi 地块、不规则大陆高度、河流、国家/行省生成、焦点图层、嵌套盒工作台、悬浮面板壳。

项目自动保存在浏览器 IndexedDB。项目文件支持 `.mapedi.json` 和 `.mapedi.json.gz` 往返导入导出；无法恢复的自动存档会保留并提示错误，不会当作空存档覆盖。图层样式与逐地块气候随项目保存；更换世界后焦点回到地块、旧选择和绘制会话清空。PNG 导出需在平面视图中使用。
