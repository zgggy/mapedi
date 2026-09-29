# 归档文档（不要再参考）

本目录内所有文档为 **历史稿 / 已过时 / 易误导**，**仅作考古**，不得作为实现依据。

| 文件 | 为何归档 |
|------|----------|
| `ARCHITECTURE.md` | 旧架构描述，与 `core/ring/*`、拓扑单源现状不一致 |
| `DESIGN_CELL.md` / `DESIGN_LAYERS.md` / `DESIGN_SPEC.md` | 设计稿，实现已走 `RENDER_LOGIC.md` 契约 |
| `DEVELOPMENT_PLAN.md` / `REVIEW.md` | 过期计划/评审 |
| `OPTIMIZATION.md` / `NEXT_ROUND_OPTIMIZATION.md` | 旧性能笔记，已被 rev + 凸包 Delaunay + 静态合成取代 |
| `REQUIREMENTS.md` / `RESEARCH_AND_CALIBRATION.md` / `UI_ARCHITECTURE.md` | 旧需求/校准/UI 架构，易与现实冲突 |
| `wasm-core/README.md` | WASM 路线未采用 |
| **`DESIGN_ENTITIES.md`**（2026-09-29 移入） | v0.9 世界观实体设计稿（未实施）；被新的「双模式叙事编辑器」需求评估取代（见 `docs/ARCH_REVIEW_2026-09-29.md` §5 透镜与对话结论：先 schema 后 UI、事件溯源时间模型）。若重启世界观实体，从此稿考古，但须重新拍板 |
| `canvas2d-shadow/` | 阴影 + Canvas2D 后端归档（**永不做**，代码已物理删除） |

**现行文档（分层与更新规则见 `AGENTS.md` §9）：**

- `README.md` — 入口与文档地图
- `AGENTS.md` — 协作规则与红线
- `RENDER_LOGIC.md` — 显示契约与模块边界
- `ROADMAP.md` — 产品功能缺口与状态
- `ROADMAP_REFACTOR.md` — 还债路线与已知问题
- `HANDOFF.md` — 交接指路（最近 1-2 轮）
- `docs/ARCH_REVIEW_2026-09-29.md` — 评审快照（冻结，依据）

**另见**：`docs/history/`（旧交接日志 59 轮，冻结）、`docs/ARCH_REVIEW_2026-09-29.md`（评审证据）。
