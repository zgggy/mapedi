# Mapedi

球面奇幻地图编辑器（跑团 / 桌游 / 世界观设定 / 小说）——Voronoi 球面拓扑 + WebGL 直绘，10 万地块基准。

```bash
cd web
npm install
npm run dev        # 开发
npm test && npm run build   # 测试与构建（仅在明确要求测试时跑）
```

**当前能力**：Voronoi 地块、大陆高度地形（Perlin+FBM，八旋钮生成参数）、河流、国家/行省生成、13 类图层与嵌套工作台、6 种投影（含罗宾森）、球面纯展示浮雕视图。自动保存在浏览器 IndexedDB；项目文件 `.mapedi.json(.gz)` 往返导入导出；无法恢复的自动存档会保留并提示，不当空存档覆盖。PNG 导出需在平面视图使用。

## 文档地图（按需读，别全读）

| 我要… | 读 |
|---|---|
| 开始协作 / 了解规则与红线 | [`AGENTS.md`](AGENTS.md) — 六层定位模型、根因流程、硬规则、反例清单、测试纪律 |
| 了解显示怎么工作 | [`RENDER_LOGIC.md`](RENDER_LOGIC.md) — 显示契约与模块边界 |
| 看产品还缺什么 | [`ROADMAP.md`](ROADMAP.md) — 功能缺口与状态 |
| 看技术债与已知问题 | [`ROADMAP_REFACTOR.md`](ROADMAP_REFACTOR.md) — 还债七步（证据见下方评审快照） |
| 接续上一轮工作 | [`HANDOFF.md`](HANDOFF.md) — 交接指路与最近轮次 |
| 了解债务为什么这么排 | [`docs/ARCH_REVIEW_2026-09-29.md`](docs/ARCH_REVIEW_2026-09-29.md) — 全库评审快照（冻结） |

**归档（勿作依据）**：`docs/_archive/`（过时设计稿）、`docs/history/`（旧交接日志 59 轮）、`docs/_archive/canvas2d-shadow/`（阴影与 Canvas2D 后端，已否决）。

文档分层规则（谁变改谁）见 `AGENTS.md` §9。
