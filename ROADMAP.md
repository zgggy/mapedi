# Mapedi 路线图 · 不完善项与优先级

> 更新：2026-09-25 · 本文件记录**尚未完成**的功能、架构债、已知问题。
> 已完成的内容见 `HANDOFF.md`；显示契约见 `RENDER_LOGIC.md`；开发规则见 `AGENTS.md`。

---

## 一、产品功能缺口

### P0 — 地图基本要素

| 功能 | 形态 | 说明 |
|---|---|---|
| 📏 比例尺 | **独立悬浮 panel**（右下角），非图层 | 随投影/缩放动态计算 |
| 🧭 指南针 | **独立悬浮 panel**（右下角），非图层 | 固定装饰，可跟图框 |
| 🖨️ 成图排版 | 导出排版 | 图框、标题、图例框的成图导出（打印/出版）；需要设计 |
| 📋 图例 | ~~独立~~ **已含在工作区** | 颜色/元素含义在工作区面板可查 |

### P1 — 世界观设定

| 功能 | 形态 | 说明 |
|---|---|---|
| 📝 文字标注 | `custom` 图层 | 自由文本注释（地名释义、历史事件） |
| 🖼️ 图片图层 | `custom` 图层 | 参考图/装饰图；需要仿射变换 |
| 🌐 经纬网 | **特殊图层**：不依赖地块、不需要绘制 | lat/long 网格叠加；纯渲染层（类似 `cellsMesh` 的 baseMesh 性质，但画的是坐标网格） |
| ⚔️ 军队层 | 普通图层 | 元素 + 标记；暂按标准 `Region` 图层走 |

### P2 — 交互与编辑

| 功能 | 状态 | 说明 |
|---|---|---|
| 元素搜索 | 有 `searchHits` 骨架 | 需要补全 UI 与跳转 |
| 测量工具 | 有 `measuring` 骨架 | 距离/面积测量 |
| 多选/框选 | 无 | 批量编辑元素 |
| 撤销/重做 UI | `history.ts` 已有命令模式 | 缺快捷键与历史面板 |

---

## 二、显示体系重设计（符号/标记/名称）

**现状问题**：`symbolsLayer`（核心地块符号 + 逐 cell 装饰）和 `labelsLayer`（元素名）是两套独立实现，显示规则、层级关系、缩放策略没有统一框架。用户要求「一套合理的架构和规则」。

**需要覆盖的显示类型**：

| 类型 | 数据来源 | 当前实现 |
|---|---|---|
| 元素填充 | `Region.color` + `ElementStyle.fill` | ✅ `elementsLayer` |
| 元素边界 | `ElementStyle.border` | ✅ `elementsLayer` |
| 元素内阴影 | `ElementStyle.shadow` | ✅ `elementsLayer` |
| 元素名称 | `Region.name` / `Region.nameStyle` | `labelsLayer`（独立实现） |
| 核心地块标记 | `Region.coreCellId` + `LayerDef.coreSymbol` | `symbolsLayer`（独立实现） |
| 逐 cell 装饰 | `LayerDef.cellSymbol` | `symbolsLayer`（独立实现） |
| cell 级标记 | `Cell.id` / `Cell.height` 等 | **无** |
| 路径/曲线 | `World.paths` | ✅ `pathsLayer` |
| 网格（地块/经纬） | cell 边 / 坐标 | `cellsMeshLayer` |

**设计方向**（待细化）：
1. **显示配置统一**：`LayerDisplayConfig` 一个结构描述「这层显示什么、怎么显示」（fill/border/shadow/label/coreSymbol/cellSymbol/cellMarker 等）
2. **渲染原语统一**：把 fill/border/label/marker/decoration 归一为有序 `DisplayPrimitive` 列表，一个 renderer 按 z 序消费
3. **规则统一**：缩放阈值、显隐条件（`isLayerShown`）、跨层联动（父子）全部走同一套规则
4. **cell 级标记**：支持在任意 cell 上显示标记（ID、高度、归属元素等），为世界观标注服务

---

## 三、架构债

### P0 — 性能（需尽快）

| 项 | 现状 | 目标 |
|---|---|---|
| **拖动 / 绘制卡顿** | 包 1（失效域拆分）✅ 已落地；包 2/3/4 见 HANDOFF「最近在处理的问题 0」 | 按包推进；红线：不抽稀、不关阴影、不降 smooth、**终态 1:1（用户否决手势瞬态）** |
| **100k 级 cell 目标** | 可行性已评估：平移/绘制/选中/悬停/编辑 CPU 包 1-4 可达标；**缩放动画达标唯一路径 = GPU 后端**（CPU 全质量重光栅 100k 数百 ms/次） | GPU 后端立项（RegionMesh/WebGL 设计下一轮出）；GPU 落地前缩放维持逐格全质量（慢但不糊） |
| **笔刷区间重建** | `flushHeightRegions` 拓扑变化时 `rebuildLandSeaRegions` 全量；非拓扑走 `updateHeightIntervalElements` 增量 ✓ | 归入卡顿包 2（脏矩形重烘焙）一并处理 |
| **getProjCache 首次重建** | 已改 key 失效 ✓；端点拖动反复触发已消除（包 1）✓；首次 O(N) 30000 cell ≈ 591ms（100k ~2s，一次性） | 可 Worker 化 |
| **GPU 后端** | 离屏填充通道接线已通（map2d 转发补全），但 `ensureGpuFill` 现有 `return null` 测量门（先量 Canvas2D 基线）；架构不对 | **升级为 100k 达标路径**：RegionMesh（三角化缓存 + per-vertex 属性）→ WebGL 批量；填充/描边/阴影全走 GPU，保 RENDER_LOGIC z 序 |

### P1 — 架构一致性

**已全部清完（2026-09-26）**：`world.continents` 第二真相已删（真相 = landsea continent Region.cells）；`layer.ts` 的 GenConfig 移入 `layer/genTypes.ts`、别名已删；heightRegions 三表并入 heightIntervals 单源；TS 存量错误清零（svelte-check / tsc 均 0 errors）。细节见 HANDOFF 第十一次。

---

## 四、已知行为

| 项 | 说明 |
|---|---|
| 缩放重烘焙顿挫 | 约 100ms 量级；**暂接受**，归入卡顿包 2（手势延迟烘焙） |
| 深海/远海配色 | 深海（-63~-55）= 最暗 ✅ 已确认正确 |
| 测试覆盖 | 29 文件 / 147 用例 **全绿**（2026-09-26）；覆盖跨日界线/极区反例；**无 UI/渲染集成测试** |

---

## 五、验证清单（每次改动后过一遍）

见 `AGENTS.md` §7.2 反例清单 + §10 自检清单。重点：

1. 普通情况 · 地图边界附近 · 跨越边界 · 极端纬度 · 极点附近
2. 很小的 cell · 很大的 polygon · 几何恰好落在边界上
3. 同一数据在不同投影/视口下
4. 绘制/撤销/重做后显示一致
5. 缩放/平移不糊、不闪
