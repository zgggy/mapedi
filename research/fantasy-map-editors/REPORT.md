# Mapedi 与同类奇幻地图编辑器的功能差距与路线建议

> Generated 2026-09-23 · depth: standard · sources: 35 · workspace: research/fantasy-map-editors/

## Executive summary

- **Mapedi 的核心差异是真实存在的**：球面 + Voronoi + 高度/文化/宗教/国家等语义层作为一等可编辑数据，在 2024–2026 商业与开源产品公开功能面中几乎没有直接对标；Worldographer 有文化/宗教生成与子图层级，Fractal Terrains 有 Orthographic 投影，但都不是「球面格网语义编辑器」[1][6][8][11]。
- **最明显的通用缺口是「地图上的文字与图章」**：Inkarnate / Wonderdraft / CC3+ / Worldographer 都把 labels（字体、描边、旋转、多行、预设样式）与 stamps/symbols 当标配 [2][4][8][12]；Mapedi 目前主要是自动区域名 + 简单树/首都符号，缺少用户可摆的文字对象与资产。
- **跑团侧标配是 POI 图钉 + 笔记链接 + 迷雾**：Foundry Map Notes / Fog Exploration、LegendKeeper pin→wiki 是类别基线 [20][21][22][25]；Mapedi 只有 Region description / 附庸敌对属性，没有独立 POI 与玩家可见性。
- **导出天花板很明确**：Inkarnate 宣称 8K 栅格、Wonderdraft 512–8192 px、Dungeondraft universal VTT、Worldographer 图像/PDF/UVTT；标准侧 GeoJSON 必须切日界线、建议 6 位小数，SVG 应用物理单位 + viewBox [2][4][7][11][47][49][50][51]。
- **用户痛点高度集中在标签、图例、导出崩溃、内存、自定义资产**（Azgaar/Wonderdraft/Dungeondraft issues）[30][33][34][36][37][39][40][42]。Mapedi 有 IDB 自动保存与 History，但仍应把「标签/图例不丢、导出不黑、内存可控」当验收线。
- **政治模拟不是「画地图」的标配，但是 Azgaar 的护城河**：国家扩张代价、外交矩阵（含 Vassal/Suzerain/Enemy）、战争 campaign、税制、宗教异端树 [12][13][15]。Mapedi 已有静态附庸/敌对/同盟，若走「世界生成器」路线可再深化；若走「绘图器」路线可停在现状。
- **建议下一轮优先做：文字/标签对象 → 图例/比例尺/指南针 → POI 图钉 → 导出规格（8K/SVG 物理尺寸/GeoJSON 切割与精度）→ 自定义符号导入**；政治模拟、迷雾、多级子图放 P2；完整 VTT 战斗图与万级素材库明确不做。

## Background & scope

Mapedi 是球面真相的架空世界地图编辑器：Voronoi cell 语义层（高度/环境/植物/动物/种族/文化/宗教/国家/行省/军队）+ 自由曲线道路/航线/河流 + 2D 墨卡托与球面预览。本报告对照商业桌面/Web 编辑器、开源程序生成器、VTT/世界构建集成与用户 issue，回答：同类有什么、Mapedi 缺什么、下一轮优先做什么。假设决策是产品路线（做/不做），非代码实现细节。

## 同类产品在做什么

### 商业绘图器：素材 + 笔刷 + 文字 + 导出

主流商业工具的公共面是：**印章/符号库 + 路径 + 标签 + 图层 + 生成器 + 栅格/矢量导出**[13]。

- **Inkarnate**（Web SaaS）：16M+ 地图、23,400+ 素材、线与形状工具、克隆地图库、最高 8K 导出；商用授权绑 Studio 订阅 [1][2][3]。
- **Wonderdraft**（$29.99 买断）：陆块笔刷 + 自动美化海岸线、艺术化河/路、树木山峦散布刷、主题与预设标签；画布 512–8192 px；内容靠 DLC 包 [4][5]。
- **Dungeondraft**（$19.99）：遭遇/地城图（非世界图）——智能铺砖、对象散布、内置光源、地城生成器、对象 tag、打印友好滤镜；护城河是 **universal VTT 导出** 管线 [6][7]。
- **Campaign Cartographer 3+**（£29.95）：CAD 式多尺度——模板自带比例尺/罗盘/边框、900+ 符号、河路林工具、hex/方格、按玩家显隐图层、辉光/阴影特效、图集热链、高分辨率栅格 + CAD 矢量 [8]。
- **Fractal Terrains 3+**：程序星球生成 + 24 种投影（含 Orthographic），但是 **生成器而非球面编辑器** [9]。
- **Worldographer**：六边形多尺度（世界→王国→城→村→地城）+「True Child Maps」父子图双向同步；2025 版有风场/纬度感知植被、道路自动连城、动态地形散布、图层透明度 [10][11]。对象模型是形状（oval/line/curve）+ 标签（预设样式/描边/旋转/多行）+ tag/GM-only/层级可见性 [12]。

### 开源生成器：语义图结构 + 政治模拟

**Azgaar FMG** 与 Mapedi 最像：PackedGraph 每个 Voronoi cell 带 height/biome/culture/religion/state/province/burg 等 id，与 Mapedi 语义层几乎 1:1 [10][11]。差异在深度：

- 国家：Dijkstra 式扩张代价、campaigns（War/Invasion/Crusade…）、外交矩阵含 **Vassal/Suzerain/Enemy**、政体与税制 [12][13]。
- 文化：world/european/highFantasy/darkFantasy 等套装，含精灵/矮人/兽人等族裔与类型相关放置代价 [14]。
- 宗教：Folk/Organized/Cult/Heresy + 14 种命名法 + 异端起源树 [15]。
- 河流：flux 通航阈值、湖出入口、侵蚀 [16]；路线：Urquhart + A*，按 burg 可锁定，不是手绘自由路径 [17]。
- 导出：SVG/PNG/JPEG 分块 + GeoJSON（cells/routes/rivers/markers/zones）+ JSON「API 替代」[18]。

Red Blob mapgen2/mapgen4 代表另一极：**先涂山脉海洋再模拟风雨生成群系/河流**（paint-then-simulate），故意不做国家宗教 [19][20]。Mapedi 的「语义笔刷 + 自动高度归属」更接近这一极，但已有政治层。

### VTT / 世界构建：POI、迷雾、测量、日历

- **Foundry**：一张 Scene 可作世界图或战斗图；网格类型含四种 hex + gridless；**Map Notes** 绑定 Journal 并受迷雾与权限控制；测量分「距离 vs 移动力消耗」；**Scene Regions** 支持困难地形倍率（0–5×）与跨场景传送 [21][22][23][24][25]。
- **LegendKeeper**：明确不做 VTT，做嵌套地图 + pin→wiki + 藏宝隐藏 + 时间线/奇幻日历；200k 创作者、2M+ pins [26][27][28][29]。
- **Roll20**：动态光照/迷雾是核心卖点；Dungeon Scrawl 做免费制图 [30]。
- **Fantasy Calendar**：自定义月/闰日/非 24h 日/多星球日历同步，嵌入 wiki/Discord [31][32]。Mapedi 的 `astro` 日历已有雏形，但未接到「世界时间层」。

### 用户真实痛点（issue 级）

| 主题 | 证据 | 对 Mapedi 的含义 |
|------|------|----------------|
| 标签字体/本地化在升级后丢失 | Azgaar #1824 [33] | 标签样式必须进存档，勿绑 UI 瞬时状态 |
| 标签层级静默消失 | Azgaar #1773/#1771 [34][35] | 默认可见性要可验证 |
| 只有一个图例且会互相顶掉 | Azgaar #1815/#1707 [36][37] | 要 **多图例 + 高程图例** |
| 导出大块黑图 | Azgaar #1882 [38] | 导出必须独立回归测试 |
| 大图 OOM / 丢档 | Dungeondraft #79, Azgaar #787/#1075 [39][40][41] | 内存与自动保存是硬指标 |
| 自定义资产流程打断 | Dungeondraft #80 [42] | 一键导入 PNG |
| 主题/描边色不进存档 | Wonderdraft #34/#31 [43][44] | 样式 token 持久化 |
| 复制粘贴 / 热键 | Wonderdraft #21 [45] | 基础编辑效率 |
| 迷雾 / 选择性揭示 | Azgaar #88 [46] | P2 |
| 批量/无头导出 | Dungeondraft #81 [47] | P2 |

### 导出与互操作底线

- Foundry 常用网格 **70/100/140/200 px**，最低 50 px [48]。
- GeoJSON（RFC 7946）：WGS84 经纬度、**类型不可扩展**（语义进 `properties`/foreign members）、**跨 ±180° 必须切割**、坐标 **6 位小数**可把体积几乎减半 [49][50][51][52][53]。
- SVG：`viewBox` + mm/cm/in 物理单位 → 印刷矢量导出的正确路径 [54][55]。
- OGC 2D TMS：瓦片 (matrix, col, row) 打包，供 WMTS/GeoPackage [56]。

## Mapedi 现状 vs 缺口

| 能力 | 同类基线 | Mapedi 现状 | 差距 |
|------|----------|-------------|------|
| 球面/地球仪 | 少见（FT 仅投影预览） | **原生球面 + 2D** | 优势，保持 |
| Voronoi 语义层 | FMG 最接近 | 高度/环境/文化/宗教/国家/行省… | 优势；缺人口/货物等扩展字段 |
| 自由路径（路/河/航） | Wonderdraft 艺术化河路；FMG 为生成链 | Catmull-Rom 手绘 | 优势；缺 **宽度渐变样式更细、锁定/生成混合** |
| 文字标签对象 | 标配 | 自动区域名 + 简易 labelsLayer | **P0 缺口** |
| 符号/图章/资产库 | 30k / DLC / 900+ | 树/首都简单符号；自定义层在需求里 | **P0–P1 缺口** |
| 图例 / 比例尺 / 指罗盘 | CC3+ 模板标配；用户强需求 | 需求写了 custom 层，未形成导出级组件 | **P1 缺口** |
| POI 图钉 + 笔记链接 | Foundry/LK 核心 | 仅 Region 描述 | **P1 缺口** |
| 附庸/敌对/同盟 | FMG 外交矩阵 | 已有静态关系 | 部分；缺战争/时间线 |
| 程序生成深度 | FMG 文化套装/宗教树/道路网 | 级联生成 + 气候/群系 | 中等；缺族裔套装与路网生成 |
| 迷雾/玩家视图 | Foundry/Roll20/issue | 无 | P2 |
| 测量 | Foundry 双测距；CC3+ 比例尺 | 有大圆距离 | 弱；缺沿线测量/单位体系 |
| Hex / 网格 | CC3+/Foundry/Worldographer | 无 | 明确可选 |
| 多级子图/图集 | Worldographer child maps；CC3+ atlas | 无 | P3 |
| 导出 | 8K、UVTT、SVG/CAD、GeoJSON | PNG/SVG/GeoJSON/高度图 | **规格未达商业天花板** |
| 自动保存/撤销 | 痛点多 | IDB + History（已做 COW） | 基本达标；需导出/内存验收 |
| VTT 战斗图 | Dungeondraft | 无 | **明确不做** |

## 路线建议

### P0 — 让成图「像一张完整地图」

1. **文字/标签对象**（自由文本层）：字体、字号、颜色/描边、旋转、多行、预设样式；可锚定 lon/lat 或屏幕；样式进存档（防 #1824/#1773 类丢失）[33][34][12]。
2. **图例（可多份）+ 高程色标**：按焦点层自动生成图例项，可手动增删；支持同时挂「国家 + 群系 + 高程」[36][37]。
3. **比例尺 + 指南针**：跟随球面/墨卡托正确长度；可开关、可进 SVG/PNG [8]。

### P1 — 制图完整度与互操作

4. **符号/POI**：内置少量树/山/城图章 + **一键导入自定义 PNG**；点放 POI，可挂名称/描述（为 wiki 链接留 schema）[42][22][26]。
5. **导出规格**  
   - PNG 至少 4K–8K，分块渲染防 OOM [2][38][39]  
   - SVG：`viewBox` + `width/height` 用 cm/in，图层 `<g>` 按语义分组 [54][55]  
   - GeoJSON：6 位小数、±180° 切割、语义进 `properties`（id/name/layer/parent/height/…）[49][50][51][52]  
   - 可选 Foundry 预设（100 px 网格对齐的世界图 PNG）[48]
6. **测量工具**：多点测距（大圆 km/度）、可选屏幕比例尺联动。
7. **样式持久化**：labels/symbols/路径描边进 theme 与存档，换风格不丢自定义色 [43][44]。

### P2 — 世界构建加深（可分期）

8. **战争迷雾 / 对玩家隐藏**：按层或按多边形「未揭示」遮罩，导出时可带/不带 [25][30][46]。
9. **政治模拟（可选生成器）**：外交矩阵时间线、政体、税；不必复制 FMG 全套 [12][13][15]。
10. **日历/时间线 UI**：把已有 `astro` 接到事件/纪年（对标 Fantasy Calendar / LK）[28][31][32]。
11. **批量/无头导出** CLI [47]。

### P3 / 明确不做

- **多级子图 / 图集热链**（Worldographer/CC3+）— 工作量大，非绘图器核心 [10][8]。
- **完整 VTT 战斗图**（光源、token、墙）— Dungeondraft 领域 [6][7]。
- **万级素材商店** — 商业 DLC 模式，与「快速画丰富地图」目标不符 [2][5]。
- **CAD 级矢量特效链** — CC3+ 护城河，性价比低 [8]。
- **Hex 全工具链** — 仅当跑团 hex 世界需求明确时再开 [21][8]。

### 性能与稳定性（与 P0/P1 并行）

- 25k cell 浏览/绘制基线（DevTools 录帧）；标签与符号走 overlay/实例化，避免全图重扫。
- 导出管线离屏分块，防止 #38/#39 类黑图/OOM。
- 标签/图例状态 schema 化 + 迁移测试，防止静默丢层 [34][35]。

## 差异化定位（不要丢的）

Mapedi 不应做成「又一个 Wonderdraft」。建议对外一句话：

> **球面语义世界编辑器**：在真实星球上分层画高度、文化、国家，手绘路河，同一数据同时上 2D 与地球仪。

这在公开竞品中仍是空位 [1][6][8][11][13]。绘图完成度（文字/图例/符号）是补短板；政治/日历是加深；VTT/素材库是划界。

## Open questions

- 玩家/客户主场景是「出版级制图」还是「跑团世界管理」？前者抬高 P0 美术工具权重，后者抬高 POI/迷雾/日历。
- 是否需要 **生成-再编辑** 的完整 FMG 式政治模拟，还是仅「可生成 + 可手改关系」即可？（Mapedi 已有附庸/敌对骨架。）
- 导出优先对齐 Foundry 还是印刷海报？二者网格/DPI 策略不同 [48][54]。
- 本轮调研搜索引擎/Reddit/World Anvil 主站大量不可达；Inkarnate 变更日志为 SPA，商业 SaaS 的用户吐槽覆盖不足（见 F4 Dead ends）[33–47]。
- 2024–2026 是否已有产品加入「球面 + Voronoi 语义层」——目前证据仅是官方页缺失，非穷尽搜索 [13]。

## Sources

[1] Inkarnate — https://inkarnate.com/ (accessed 2026-09-23)  
[2] Wonderdraft — https://www.wonderdraft.net/ (accessed 2026-09-23)  
[3] Dungeondraft — https://dungeondraft.net/ (accessed 2026-09-23)  
[4] Campaign Cartographer 3+ — https://www.profantasy.com/products/campaign-cartographer-3 (accessed 2026-09-23)  
[5] Fractal Terrains 3+ — https://www.profantasy.com/products/fractal-terrains-3 (accessed 2026-09-23)  
[6] Worldographer — https://worldographer.com/ (accessed 2026-09-23)  
[7] Worldographer New in 2025 — https://worldographer.com/new-in-2025-version/ (published 2025, accessed 2026-09-23)  
[8] Worldographer Shapes/Labels manual — https://worldographer.com/manual/07e-shapes-labels-drawers/ (accessed 2026-09-23)  
[9] Azgaar FMG README — https://cdn.jsdelivr.net/gh/Azgaar/Fantasy-Map-Generator@master/README.md (accessed 2026-09-23)  
[10] FMG PackedGraph.ts — https://cdn.jsdelivr.net/gh/Azgaar/Fantasy-Map-Generator@master/src/types/PackedGraph.ts (accessed 2026-09-23)  
[11] FMG GIS data export wiki — https://raw.githubusercontent.com/wiki/Azgaar/Fantasy-Map-Generator/GIS-data-export.md (accessed 2026-09-23)  
[12] FMG states-generator.ts — https://cdn.jsdelivr.net/gh/Azgaar/Fantasy-Map-Generator@master/src/generators/states-generator.ts (accessed 2026-09-23)  
[13] FMG cultures-generator.ts — https://cdn.jsdelivr.net/gh/Azgaar/Fantasy-Map-Generator@master/src/generators/cultures-generator.ts (accessed 2026-09-23)  
[14] FMG religions-generator.ts — https://cdn.jsdelivr.net/gh/Azgaar/Fantasy-Map-Generator@master/src/generators/religions-generator.ts (accessed 2026-09-23)  
[15] FMG river-generator.ts — https://cdn.jsdelivr.net/gh/Azgaar/Fantasy-Map-Generator@master/src/generators/river-generator.ts (accessed 2026-09-23)  
[16] FMG routes-generator.ts — https://cdn.jsdelivr.net/gh/Azgaar/Fantasy-Map-Generator@master/src/generators/routes-generator.ts (accessed 2026-09-23)  
[17] Azgaar FMG live app — https://azgaar.github.io/Fantasy-Map-Generator/ (accessed 2026-09-23)  
[18] Red Blob mapgen2 — https://www.redblobgames.com/maps/mapgen2/ (published 2017-09-01, modified 2026-04-28, accessed 2026-09-23)  
[19] Red Blob mapgen4 — https://www.redblobgames.com/maps/mapgen4/ (published 2018-07-20, changelog through 2025-10-13, accessed 2026-09-23)  
[20] Foundry Scenes — https://foundryvtt.com/article/scenes/ (accessed 2026-09-23)  
[21] Foundry Map Notes — https://foundryvtt.com/article/map-notes/ (accessed 2026-09-23)  
[22] Foundry Journal — https://foundryvtt.com/article/journal/ (accessed 2026-09-23)  
[23] Foundry Measurement — https://foundryvtt.com/article/measurement/ (accessed 2026-09-23)  
[24] Foundry Scene Regions — https://foundryvtt.com/article/scene-regions/ (accessed 2026-09-23)  
[25] LegendKeeper — https://www.legendkeeper.com/ (accessed 2026-09-23)  
[26] Roll20 — https://roll20.net/ (accessed 2026-09-23)  
[27] Fantasy Calendar — https://www.fantasy-calendar.com/ (accessed 2026-09-23)  
[28] Notion Wikis — https://www.notion.com/product/wikis (accessed 2026-09-23)  
[29] World Anvil mapmaking blog — https://blog.worldanvil.com/mapmaking/create-great-dd-battle-maps-even-if-you-cant-draw/ (published 2022-12-23, accessed 2026-09-23)  
[30] Azgaar FMG #1824 labels/names — https://github.com/Azgaar/Fantasy-Map-Generator/issues/1824 (published 2026-09-09, accessed 2026-09-23)  
[31] Azgaar FMG #1773 labels not shown — https://github.com/Azgaar/Fantasy-Map-Generator/issues/1773 (published 2026-09-03, accessed 2026-09-23)  
[32] Azgaar FMG #1771 label options — https://github.com/Azgaar/Fantasy-Map-Generator/issues/1771 (published 2026-09-03, accessed 2026-09-23)  
[33] Azgaar FMG #1815 multi-legend — https://github.com/Azgaar/Fantasy-Map-Generator/issues/1815 (published 2026-09-08, accessed 2026-09-23)  
[34] Azgaar FMG #1707 heightmap legend — https://github.com/Azgaar/Fantasy-Map-Generator/issues/1707 (published 2026-09-03, accessed 2026-09-23)  
[35] Azgaar FMG #1882 export black — https://github.com/Azgaar/Fantasy-Map-Generator/issues/1882 (published 2026-09-17, accessed 2026-09-23)  
[36] Dungeondraft #79 memory — https://github.com/Megasploot/Dungeondraft/issues/79 (published 2026-01-07, accessed 2026-09-23)  
[37] Azgaar FMG #787 OOM — https://github.com/Azgaar/Fantasy-Map-Generator/issues/787 (published 2022-04-30, accessed 2026-09-23)  
[38] Azgaar FMG #1075 framerate — https://github.com/Azgaar/Fantasy-Map-Generator/issues/1075 (published 2024-05-17, accessed 2026-09-23)  
[39] Dungeondraft #80 custom assets — https://github.com/Megasploot/Dungeondraft/issues/80 (published 2026-01-14, accessed 2026-09-23)  
[40] Wonderdraft #34 theme text/path — https://github.com/Megasploot/Wonderdraft/issues/34 (published 2024-11-19, accessed 2026-09-23)  
[41] Wonderdraft #31 custom color assets — https://github.com/Megasploot/Wonderdraft/issues/31 (published 2024-05-27, accessed 2026-09-23)  
[42] Wonderdraft #21 copy/paste — https://github.com/Megasploot/Wonderdraft/issues/21 (published 2021-11-30, accessed 2026-09-23)  
[43] Azgaar FMG #88 fog of war — https://github.com/Azgaar/Fantasy-Map-Generator/issues/88 (published 2018-06-24, accessed 2026-09-23)  
[44] Dungeondraft #81 batch export — https://github.com/Megasploot/Dungeondraft/issues/81 (published 2026-02-25, accessed 2026-09-23)  
[45] RFC 7946 GeoJSON — https://www.rfc-editor.org/rfc/rfc7946.html (published 2016-08, accessed 2026-09-23)  
[46] SVG 1.1 Coordinates — https://www.w3.org/TR/SVG11/coords.html (published 2011-08-16, accessed 2026-09-23)  
[47] OGC 2D Tile Matrix Set — https://www.ogc.org/standard/tms/ (accessed 2026-09-23)  
[48] W3C Media Fragments — https://www.w3.org/TR/media-frags/ (published 2012-09-25, accessed 2026-09-23)  

> 注：正文中的 [n] 已按「首次出现」重编号并去重；findings/F1–F5.md 内保留子代理原始编号。Media Fragments [48] 与地图编辑器采纳度仅 medium confidence。
