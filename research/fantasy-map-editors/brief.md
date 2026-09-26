# Research brief: Mapedi 竞品功能差距

> date: 2026-09-23 · depth: standard · slug: fantasy-map-editors

## Refined question

同类奇幻/世界构建地图编辑器（桌面与 Web）通常有哪些核心与进阶功能？Mapedi（球面 Voronoi 架空地图编辑器）相对还缺什么？哪些缺口最值得优先做，哪些可以明确不做？

## Scope

**In**
- 桌面/商业/开源奇幻世界地图编辑器与世界构建工具的功能清单
- 导出、VTT/跑团集成、标签/标注、程序生成、笔刷/路径编辑、图层与对象模型
- 用户论坛/评测里反复提到的痛点与“必备功能”
- 与 Mapedi 现状对照后的缺口与优先级建议

**Out**
- 纯 GIS 商业软件（ArcGIS 等）的深度对比
- 美术素材商店商业模式细节
- Mapedi 代码实现细节（本地已有 REQUIREMENTS / NEXT_ROUND_OPTIMIZATION）

## Mapedi 现状（对照基线，来自本地文档）

- 球面真相 + 2D 墨卡托 + 球面 3D 预览
- Voronoi cell 语义层：高度/环境/植物/动物/种族/文化/宗教/国家/行省/军队
- free 层：道路/航线/河流（Catmull-Rom 过点曲线）
- 笔刷/填充/权重/中心/吞并；附庸/敌对/同盟
- 图层父子、工作区元素树、指针拖放
- 导出 PNG/SVG/GeoJSON/高度图；性能缓存与列表虚拟化

## Assumptions

- 受众：继续做产品的开发者（中文报告）
- 时间框：当前市场功能（2024–2026）
- 决策：下一轮功能路线（做什么 / 不做什么）

## Angles

1. **主流商业/桌面奇幻地图编辑器功能面** — Inkarnate、Wonderdraft、Dungeondraft、Campaign Cartographer、Worldographer 等官方功能与版本说明
2. **开源/程序生成与 Web 工具** — Azgaar Fantasy Map Generator、d3-geo 类工具、其他开源 world generator 的对象模型与导出
3. **跑团/世界构建集成** — World Anvil、LegendKeeper、Foundry VTT、Roll20 地图需求；标签、笔记、徽记、战争迷雾
4. **用户痛点与“必备清单”** — Reddit/论坛/评测里地图编辑器功能请求与吐槽
5. **导出/互操作/性能标准** — VTT 尺寸、SVG 分层、瓦片、打印 DPI、协作与版本

## Budget

standard · 4–5 sub-agents · 1 follow-up round · 15+ sources
