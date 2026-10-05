# 元素名称注记与核心符号 · 需求细化与调研（2026-10-04）

> 规划层文档。用户议题：地图上国家/行省/文化等**元素名**的样式、弯曲、字号、面内放置（崎岖多边形也要尽量居中且在最宽阔处）、父子区分、核心地块（首都/省会/文化中心）与特殊地块的符号标注、尺寸与核心选取规则。
> 本文 = ①本项目现状盘点（带 file:line 证据）②外部调研结论（带来源）③细化后的需求条目 ④待拍板清单 ⑤分期建议。**尚未开工。**

---

## 4.5 交付状态（滚动）

- **☑ 包1「放置与可读性」已完成（2026-10-04，本机验收通过）** ——P1 / P8 第一步 / R1 / R2 / R8 / R13 / R19 / R20 落地：
  - 新增 `core/ring/labelPlace.ts`（397 行）：吃**实绘环**（`preparePieces` 同一份，含 unwrap/框闭合/frameFlip 框环），evenodd 奇偶判定与填充同源；外环组件建网格 chamfer 距离场 → 取最宽阔格为候选（= polylabel 网格近似），候选 `d` 是**到边界的可靠下界**（chamfer 网格路长 − 半格对角线），据此做可证明的快判：`d < 半字高` 必放不下（免 16 点奇偶）、`hypot(半宽,半高) ≤ d` 必放得下（也免奇偶），两者之间才走 16 点精确奇偶（走廊形面仍能过）。
  - `render/layers.ts` 装饰层重构：①**跨层碰撞表**（屏幕网格，名称与核心符号共用；符号先占位、名称避让、符号最后画在最上）②**逐候选轮换**（候选被挡换下一个最宽阔处，而不是直接省略）③降级链 = 候选轮换 → **省略名称保留符号**（不缩字号）④放置优先级 = 焦点层 → 层深度（父层先于子层）→ 列表序（与叠放同源）⑤halo 宽度 = 字号/4（原为定值 3px）⑥视口判定按几何 bbox（世界 y 向上）⑦一元素多片取最大片；冷件等渐现补热。
  - **验收读数**（100k 世界，四国家 + 16 行省）：缩放 ×1 → **已放置 13、放不下省略 14**（小面的名字不硬塞）；**放大 ×3 → 省略降到 1**（放不下就先不画、放大才出现）；点标签中心反选命中本元素 **13/13**（+ 前一轮 4/4，累计 17/17）；`hidCollide` 归因可用（候选被核心符号挡住时会换位而不是隐藏）；注记段耗时 **1.2–3.5 ms/帧**（`__labelMs`，含全部世界副本 pass），`__restMs` 2.7–4.3、`__drawMs` 4.4–5.9。
  - **观测**：`globalThis.__labelStat`（placed / hid / hidNoFit / hidCollide / noPiece / cold / off + items[≤16] + view 视口盒 + geom 构建归因）、`__labelMs`（注记段单帧耗时），帧令牌 = `__drawCount`。
  - **排障沉淀**：装饰层是 `repeat` 层**按世界副本逐 pass 重入**——任何帧级统计都要按帧号累加，否则被「屏内无物的远副本 pass」覆盖（本次踩过）；视口盒 `vT` 是世界坐标**上**边界（y 向上），上下反写会让全部标签被判「视口外」。
  - **留白（后续包）**：字号层级表/中文排版（包2）、核心符号族与符号-名称相对位置（包3）、沿长轴弯曲与重复注记（包4）、用户自定义标记与配置面（包5）、面外引导线与显示门槛降级（P8 后段）。

- **☑ 包2「层级样式与父子区分」已完成（2026-10-04，本机验收通过）** ——P3 / P4 / R6 / R7 / R14 落地，**中英文并重**（用户 2026-10-04 追加：「中英文排版都要有，要和地图上那种似的」）：
  - 新增 `core/layer/labelStyle.ts` = **排版单源**：四档表 `LABEL_TIERS`——primary 15px/600/0.16em/大写/α1/minScale55、secondary 13/500/0.10em/大写/α0.9/75、tertiary 12/400/0.05em/正体/α0.8/95、minor 10/400/0.02em/正体/α0.68/125（相邻档差 ≥2px）。档位 = `layer.labelTier` ?? **按层深度**推导（父层 primary、子层 secondary……与叠放/注记优先级同一棵树）；`labelSpecOf` = 档位 × 主题（family/基准色/halo）× 层覆盖（`labelTier`/`labelMinScale`/`labelSize` 三个新字段，UI 配置面归包5）。
  - **中英并重**：拉丁 = 西文惯例**大写 + 疏排**（`upper` 档对整串 `toUpperCase()`，汉字不受大小写影响，混排 "dynasty"→"DYNASTY" 正是地图常见样）；中文 = 无大小写可用 → 层级靠**字号 + 字重 + 字距 + 灰阶**，**不用斜体**（伪斜体小字号可读性差）。字体栈随主题换：dark = `"Helvetica Neue"… + PingFang SC/雅黑/Noto Sans CJK`、parchment = `Georgia/宋体`、neon = `SF Mono/等宽`——浏览器逐字体回退，拉丁命中新西文、汉字落到中文字体。
  - **灰阶叠主题**：档位只给 alpha，`withAlpha` 叠在 `style.labels.default.color` 上 → 换预设（羊皮纸深字）层级对比自动跟随。
  - **R14 缩放阶梯**（替代 `cam.scale<90` 一刀切）：名称按本层 `minScale` 分档出现；**核心符号 = 名称门槛 + 20 → 缩小过程中符号先消失**；cell 级装饰（树/id 标记，调试性质）保留旧 90 地板。
  - **收编死字段**：`StyleSet.labels` 的 `country/city/continent/biome` 三预设共 12 个 FontSpec 全库零消费 → 删除，`labels` 只留 `default`（family/基准色/halo 归主题）。
  - **验收读数**：档位推导正确（国家=primary、行省=secondary）；`letterSpacing` 实测生效（EN 51.7→63.7px、CJK 30→34.8px @15px/0.16em）；英文小写名渲染为 `DYNASTY` 且仍在面内；**缩放阶梯** scale50 全门槛拦截（placed=0/noFit=0，连 primary 都不进评估）、scale60 只有 primary 参与（noFit 25 ≈ 4 国 × 6 副本 pass，secondary 被 75 门槛过滤）、scale180 两档齐出；`syms` 随缩放归零（符号门槛+20 生效）；`hidCollide=0`；注记段 **0.6–1.2ms/帧**。
  - **排障坑**：`$state` 深改字段（如 `region.name`）**不触发重绘**（渲染 effect 只 void world 引用）——验证改名必须顺手戳一帧（cam.scale 微调）；**缩太小时几何判定先于门槛接管**（文字盒按 px 固定、缩放变小即放不下 → 不画），所以 `minScale` 是「提前止损」而非显示保证，这与制图的「面积下限」惯例一致。
  - **留白**：每层覆盖的 UI 配置面（包5）、符号-名称相对位置与符号族扩充（包3）、弯曲与重复注记（包4）。

- **☑ 包3「核心符号与核心地块」已完成（2026-10-04，本机验收通过）** ——P6 / P7 / R15 / R16 落地：
  - **符号族扩为五种**（`CoreSymbol`）：`star` 实心星=国家首都、`hollowStar` 空心星=省会（CIA 图例实测语义）、`ring` 同心圆 ⊙=文化/宗教中心（OSM 首都样式）、`square`/`circle`=一般中心。内置预设同步：国家 ★ / 行省 ☆ / 文化·宗教 ⊙；**旧档经 `ensureBuiltinLayers` 回填**（coreSymbol 与 labelTier 均无 UI 入口 → 按「与内置一致」策略强制同步，与 cellMarker 同先例）。
  - **尺寸随字号**（R15，替换固定 1.1px——旧值画出来直径只有 2px，图上几乎看不见）：`coreSymbolRadiusPx` = 字号 × 倍率（星 0.5 / ⊙ 0.35 / 方 0.3 / 圆 0.28）× 主题 `symbols.scale`；**占位盒与实绘同源**（同一函数），符号先占位、名称避让。
  - **绘制顺序修正**：星/方改为**先描边后填充**——描边居中，正序时 0.36R 宽的深色轮廓会向内吞掉细长星臂的亮色填充。
  - **档位预设显式化（包2 的修正）**：按层深度推导时**文化/宗教（顶层）会拿到国家级排版** → 内置层显式 `labelTier`（文化/宗教/高度=tertiary，环境·植物·动物·种族·军队·道路·河流·地块=minor），深度推导只作**自定义层兜底**。
  - **R16 核心地块选取**：新增 `core/regionCenter.ts`（`selectCoreCell` 单源搬迁 + 新 `visualCenter` = **面内到边界最远的格**：Voronoi 边=中垂线 → 边界格种子 `|pq|/2`，内部格多源 Dijkstra 传播，mercator 空间=投影无关）；**生成默认**国家/行省=`visualCenter`（文化=高处/宗教=低处的语义选择保留）；**检查区两个入口**：「📍 视觉中心」一键可撤销、「📍 点选」模态（画布单击设核心、Esc 取消、设完自动退出），只在 `requireCenter` 层显示。
  - **顺带修掉两处根因**：① `SetCenterCommand` 只写 `centerCellId` 而渲染优先读 `coreCellId` → **设中心从来不生效**（半成品所以没暴露）——**双真相收敛**：删 `Region.coreCellId` 别名（生成双写改单写、渲染读唯一字段，旧档多余属性无害），并删 `brush.setCenter` 同一写的死导出；② 半成品 `setCenterAt` 走 `touchWorld`（bump geomRev 全件环重建=闪屏）→ 收进 `commandService.setCoreCell` 用 `touchRegions`，逻辑一处。
  - **验收读数**：符号预设 ✓（国家 star / 行省 hollowStar / 文化·宗教 ring，旧档回填生效）；**像素级独立实测**（画完即时取样）：star 亮像素 4→**47**、中心 `245,240,230`（修复前中心是灰的=被描边吃掉）；hollowStar 亮 122、中心=元素色 `197,32,76`（空心 ✓）；ring 亮 59–73、中心=亮圆心 ✓；设中心三条断言全过（视觉中心=**内部格**且撤销还原 77553、点选生效且模态自动清、Esc 取消且格子未变）；检查区两个按钮 DOM 存在；`defaultGenConfig(country/province).coreSelector === 'visualCenter'`。
  - **坑**：**先填充后描边会吃掉细长形状的填充**（星形只剩 4 个亮像素的事故）——形状细长时必须先描边后填充，让描边只留外半。

- **☑ 包4「沿轴重复与弯曲」已完成（2026-10-04，本机验收通过）** ——R4 / R5 / P2 / P9 落地：
  - **几何地基（构建期算、随 `proj|件键` 缓存，与缩放无关）**：`pcaAxis`（协方差主特征向量求长轴）→ 长宽比 `elongation`；≥2.5（R4 阈值）时建 **中轴折线** `spine`——沿主轴等距 7 节点、每节点法向 9 档采样取「面内且 `radiusAt` 最大」的点（= 局部最宽处连线 ≈ 骨架），存弧长 `spineLen`。
  - **布局选择（铺展优先级 重复 > 弯曲 > 水平**，调研结论：OS 宁可重复也不硬塞）：`pickLabelLayout`——非狭长只走现状水平直排（行为零变化）；狭长则 ①沿中轴**重复**（节点间距 ≥ 文字宽 + 2×余量，≥2 个才算成功；只剩 1 个也用轴向版）→ ②**逐字弯曲**（整串沿弧长排开、相邻字转角**滑动窗口 ≤25°**（窗口=3/5 字高，MapLibre 同款）、投影角 |θ|>90° 即拒=不倒置、逐字 `fitsRot` 在面内）→ ③退回水平 → ④省略。
  - **渲染**：屏幕角用 `toScreen(锚点)` 与 `toScreen(锚点+方向)` **两点 atan2** 求得（天然吸收投影形变与 y 翻转，不用解析导数）；旋转绘制 `translate→rotate→fill/stroke`；逐字模式临时把 `letterSpacing` 归零（字距已由弧长推进承担）；屏幕角归一 (-90°,90°] 防倒置（PCA 主轴方向任意）。
  - **观测**：`__labelStat.items` 增 `mode`（flat/repeat/curve）、`angle`（度）、`el`（长宽比）、`n`（件数/字数）。
  - **验收读数**：本世界就有真·狭长元素——经纬度**独立核算** 罗马 7.3:1、丙州 7.25:1、埃及 360°×62°（横跨整圈），与 PCA 结果 6.3 / 4.39 / 2.54 方向一致（投影 y 压缩）✓；模式分布 **flat 7 / repeat 6 / curve 1**；规则断言 0 违规（el≥2.5 必非 flat、el<2.5 必 flat、|angle|≤42°≤90）；**反选 13/13**（点旋转 16° / 弯曲 -13° 的标签中心仍选中本元素）；帧预算 drawMs 7–9ms（labelMs 4–6，60fps 内）；零运行时错误。
  - **坑（实测）**：PCA 输入必须**截断 `virtualFrom` 之后的框补段**——否则主轴被人工框边拉到「横跨地图」，普通元素误判成狭长（首测时埃及被判狭长就是这个）。
  - **留白（已知优化路径，当前预算够用暂不做）**：把「几何排布（可缓存）」与「碰撞（逐帧）」拆开——现在 repeat/curve 的 `fitsRot` 每帧重算，是 labelMs 从 1.2→6ms 的主因；标签更密时再拆。

---

## 0. 现状盘点（本项目地基）

全部注记在 2D 装饰层 `decorationsLayer`（[layers.ts:683](../web/src/render/layers.ts)），Canvas2D、屏幕空间绘制（字号不随缩放）。

| 能力 | 现状 | 证据 |
|
> **2026-10-04 用户拍板修订（包4）**：**不要重复注记**——重复改为「**一个名字 + 字距拉伸**」沿长轴铺开（`stretch` 模式，拉伸上限中文 1×字大 / 西文 0.5em，阶梯回落保证拿到"能放下的最大拉伸"）；**字体重新调研**：国家名=图集衬线（Georgia/宋体/思源宋）、其余=主题无衬线栈（西文在前、CJK 在后，OSM fonts.mss 原则）——依据见调研纪要「字体与字距拉伸」批注。重复注记代码已删（ArcGIS `Repeat` 语义保留为文档参考）。


> **2026-10-04 核心两形态（用户拍板 6.1 选项1）已落地**：`Region.coreRegionId`（核心=下级子元素）与 `centerCellId`（核心=本层地块）**互斥**，单源取值 `core/regionCenter.coreCellOf()`（渲染、路网首都、校验全走它）；**两种形态的交互统一为「地图点格」**（检查区「📍 点格」「📍 点子元素」，点到哪格就设哪格/哪个子元素），外加「📍 视觉中心」一键；6.2 **抢占开关**在绘制面板 = `replace`/`emptyOnly` 映射 `draw.addMode`。


> **2026-10-04 包5 前半已交付（图层注记配置面）**：检查区图层展开 → 样式面板「注记」分组 = 名称 / 档位 / 符号 / 格标 四组**分段按钮** + 字号 / 门槛两个数值项（占位=档位默认）+ 摘要行回显；写入走 `setLayerDecor`（`LayerFieldsCommand` 一条可撤销、失效域 `touchLayerView`）。**后半已完成（`cellMarks` 自定义地块标记）**：`World.cellMarks?`（★/●/◆ + 可选色）→ `serializeWorld` **显式白名单**字段 + deserialize 悬空过滤 → `CellMarksCommand` 整表快照可撤销 → 绘制模式「点标记」单击格子循环 ★→●→◆→无（模态保持可连打、Esc 退出）→ 渲染复用符号占位/绘制链（`CoreSymbol` 新增 `diamond`）。**同批修正**：核心选择（地块/子元素/视觉中心）迁到**绘制模式联排胶囊**（`.seg-group`：首左圆角、中全直角、末右圆角），检查区只保留父子/隶属跳转；**Viewport 点选模态优先于笔画**（会话 active 时画布点击原被笔画劫持，模态收不到）。


---|---|---|
| 名称放置点 | **cell 中心的算术平均**（凹形/狭长面会偏、可能出界） | `regionCenter()`，layers.ts:749-766 |
| 放不放得下 | **无判定**：文字可压过边界；只有同层 bbox 互斥 | layers.ts:793-810（`occupied` 每层重置 → **跨层不避让**） |
| 字号 | 全局单值 `style.labels.default.size`，**无层级差** | layers.ts:769、styles.ts:41 |
| 描边 halo | `lineWidth = 3` **定值**（规范上限 = 字号/4，12px 字最多 3px，当前对小字过粗） | layers.ts:801 |
| 弯曲/沿轴 | 无（永远水平直线） | — |
| 缩放门槛 | 一刀切 `cam.scale < 90 不画全部装饰`（名称/符号/标记混在一起） | layers.ts:692 |
| 跨层优先级 | 无（按 `world.layers` 数组序逐层画，后画盖前画） | layers.ts:724 起 |
| 核心符号 | `coreSymbol: star/square/circle/none`，画在 `centerCellId ?? coreCellId`，尺寸 `1.1×scale/cam.scale`（≈屏幕 1.1px×scale） | types.ts:64、layers.ts:815-826、605-652 |
| 核心地块选取 | 生成期 `selectCoreCell`：random/centermost/highElevation/lowElevation/nearBoundary；**设中心命令引擎有、UI 无按钮** | unified.ts:96-145、history.ts:160、OPTIMIZE_REVIEW §6 |
| 名称内容 | `labelMode: none/name/coreLabel`（coreLabel = 用 `coreLabel/centerLabel` 如"首都"） | types.ts:68、layers.ts:777 |
| 配置面 | **UI 完全没有** labelMode/coreSymbol/cellMarker 的设置入口；只有 4 个内置层预设写死 | world.ts:88-128（文化/宗教 circle、国家 star、行省 square）；`grep labelMode src/ui` = 0 |
| 球面 | **零文字**（GlobeView 无 fillText） | grep fillText GlobeView = 0 |
| 失效/缓存 | `regionCenterCache`（键 `dataRev\|id\|cells.length`）、`labelWidthCache`（键 `字号\|字体\|名字`） | layers.ts:751-767、788-795 |

**结论**：引擎有"名称 + 核心符号 + cell 标记"三层雏形，但**没有排版系统**——无层级字号、无面内最优放置、无放得下判定、无跨层避让、无弯曲、无缩放阶梯，且用户碰不到配置。

---

## 1. 外部调研结论（可执行参数 + 来源）

### 1.1 面内放置位置

- **首选最大内接圆（pole of inaccessibility / polylabel），不是质心**：质心对凹形可能落到面外，point-on-surface 只保证在面内不保证居中。polylabel = 网格 + 优先队列逼近"到边界最远的内部点"，在给定 precision 内保证全局最优，README 明言 "not to be confused with centroid"。([polylabel](https://github.com/mapbox/polylabel))
- **多部件/破碎面 → 先取面积最大的部件**再取代表点（QGIS `LabelLargestPartOnly`、OSM Carto 同款 SQL）。([QGIS](https://docs.qgis.org/3.44/en/docs/user_manual/style_library/label_settings.html)、[OSM Carto](https://github.com/openstreetmap-carto/openstreetmap-carto/blob/master/project.mml))
- **狭长面**：沿长轴/中轴放，或把内接圆拉成椭圆适配"宽>高"的文字（osm2pgsql PR 实测按 bbox 长宽比缩放"时好时坏"，属调参）。([osm2pgsql#1822](https://github.com/osm2pgsql-dev/osm2pgsql/pull/1822)、[ArcGIS medial axis](https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/labels-for-polygon-features.html))
- **超大面 → 改沿边界重复注记**：OSM Carto 国名 z11+ 转 `text-placement: line`，spacing 750px / repeat 250px。([style/admin.mss](https://github.com/openstreetmap-carto/openstreetmap-carto/blob/master/style/admin.mss))
- **面积窗口（实测值）**：国家 1000–360000 px²、省 3000–196000、县 12000–196000、水体 3000–768000；低于下限不画，高于上限改线注记或放弃。([project.mml](https://github.com/openstreetmap-carto/openstreetmap-carto/blob/master/project.mml))

### 1.2 直线 vs 弯曲

- **默认水平（north-up）**，全图一致；弯曲只用于线状要素与**明显狭长**的面（长轴/中轴）。([OS Guide to cartography](https://docs.os.uk/more-than-maps/geographic-data-visualisation/guide-to-cartography/text-on-maps)、[ArcGIS](https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/labels-for-polygon-features.html))
- **曲率硬上限**（相邻字符转角）：QGIS 默认 **25°**、Mapnik 默认 **22.5°**、Mapbox/MapLibre `text-max-angle` 默认 **45°**、OSM Carto 对水体收紧到 **15°**；MapLibre 实现是**滑动窗口累计角**（窗口 ≈ 3/5 字高），超限整个锚点作废。推荐 **20–25°**。([qgspallabeling.cpp](https://github.com/qgis/QGIS/blob/master/src/core/labeling/qgspallabeling.cpp)、[mapnik text_properties.hpp](https://github.com/mapnik/mapnik/blob/master/include/mapnik/text/text_properties.hpp)、[check_max_angle.ts](https://github.com/maplibre/maplibre-gl-js/blob/main/src/symbol/check_max_angle.ts))
- **不倒置**（文字"翻倒"读不出即弃）、避免复杂曲线；铺展优先用**字距**（0.05–0.1em），其次**重复注记**，最后才是弯曲。([OS 文档](https://docs.os.uk/more-than-maps/geographic-data-visualisation/guide-to-cartography/text-on-maps))
- Canvas 实现 = **逐字符 `translate+rotate` 沿弧长排字**（等价 SVG `textPath method=align`），字形本身不弯曲；弧长累加用累计距离表（MapLibre `PathInterpolator` 做法）。([MDN textPath](https://developer.mozilla.org/en-US/docs/Web/SVG/Element/textPath)、[SVG1.1 §10.13](https://www.w3.org/TR/SVG11/text.html))

### 1.3 字号层级与排版

- **生产底图实测 px**：Positron 国名 10→14（z3→z8）、州 12→14、城市 14→22（z8→z14）、镇 10→15、村 9→13；OSM Carto 国/省/县/城 10→15 档、首府 11→15。层级在不同 zoom **交接**（低 zoom 国名最大，高 zoom 城市反超）。([positron style](https://basemaps.cartocdn.com/gl/positron-gl-style/style.json)、[placenames.mss](https://github.com/openstreetmap-carto/openstreetmap-carto/blob/master/style/placenames.mss))
- **相邻层级字号差 ≥ 15–20%（≥2pt）**，否则不可辨；字号不是唯一手段（字重/颜色/位置要补足）。([Axis Maps](https://www.axismaps.com/guide/labeling)、[Colorado Pressbooks](https://colorado.pressbooks.pub/makingmaps/chapter/typography/))
- **面状要素用全大写 + 加大字距**（0.05–0.1em）；**水域用斜体 + 蓝色**是跨来源硬惯例；斜体小字号可读性差（OSM Carto 社区争议 issue #2380）。([Axis Maps](https://www.axismaps.com/guide/labeling)、[Minnesota 无障碍指南](https://mn.gov/mnit/assets/Accessibility%20-%20map-design-guide%20(updated)_tcm38-565153.pdf))
- 屏幕可读下限 9–10px（≈12–13px 更稳）；多行行距 1.2–1.5×；对比度字色对底图 4.5:1（大字 3:1）。([Axis Maps](https://www.axismaps.com/guide/labeling)、[WCAG via MN](https://mn.gov/mnit/assets/Accessibility%20Guide%20for%20Interactive%20Web%20Maps_tcm38-403564.pdf))

> **⚠ 本项目中文化改译**：调研全部基于拉丁文字。"全大写"对中文**无效**；"斜体"在中文里是伪斜体、可读性差。中文等价手段 = **字号档差 + 字距（国名 0.1–0.2em，中文方块字加字距效果显著）+ 字重（bold）+ 灰阶层级**。这条必须写进需求，否则照抄西文惯例会做无用功。

### 1.4 可读性（halo）与崎岖/破碎面

- halo 是默认手段但**是双刃剑**：优先提高文字/底色对比度，其次才加 halo；**halo 宽度 ≤ 字号的 1/4**（Mapbox/MapLibre 硬限制），常用 1–1.5px、白 50–60% alpha。([mapbox v8.json](https://github.com/mapbox/mapbox-gl-js/blob/main/src/style-spec/reference/v8.json)、[OSM Carto style.mss](https://github.com/openstreetmap-carto/openstreetmap-carto/blob/master/style/style.mss)、[data.europa halo 指南](https://data.europa.eu/apps/data-visualisation-guide/text-halos))
- **禁止为"塞进多边形"而缩小字号**（会暗示该要素等级不同）→ 必须走降级链而不是缩字号。([Colorado](https://colorado.pressbooks.pub/makingmaps/chapter/typography/))
- 降级链（官方机制拼装）：**候选位轮换 → 点符号/去文字（`text-optional`）→ 移到面外 + 引导线（leader line）→ 提高显示缩放门槛 → 放弃**。([Mapbox 文档](https://docs.mapbox.com/help/troubleshooting/optimize-map-label-placement/)、[MapServer MINFEATURESIZE](https://mapserver.org/mapfile/label.html))

### 1.5 碰撞与优先级

- 通用原则：**先放者占位，后放者避让**；`symbol-sort-key` 升序 = 优先放置。([MapLibre style spec](https://maplibre.org/maplibre-style-spec/layers/))
- 数值化优先级：QGIS `Priority 0–10`、MapServer `PRIORITY 1–10`；层间"越靠后的图层越优先"。([QGIS](https://docs.qgis.org/3.44/en/docs/user_manual/style_library/label_settings.html)、[MapServer](https://mapserver.org/mapfile/label.html))
- 碰撞盒 = 文字 bbox + padding（Mapbox `text-padding` 默认 2px；OSM Carto `text-margin` 0.7em）；实现用**网格哈希**（MapLibre `GridIndex` cell=25px，仅同 cell 才做精确比对；每帧放置预算 2ms，超时下帧续）。([grid_index.ts](https://github.com/maplibre/maplibre-gl-js/blob/main/src/symbol/grid_index.ts)、[pauseable_placement.ts](https://github.com/maplibre/maplibre-gl-js/blob/main/src/style/pauseable_placement.ts))
- **城市/首府点注记优先于行政面注记**（OSM Carto issue #1391："admin_level should always try hard to allow admin_centre name to appear"）。([issue #1391](https://github.com/openstreetmap-carto/openstreetmap-carto/issues/1391))

### 1.6 父子（嵌套）层级的样式区分

实测（OSM Carto + OpenFreeMap Liberty 源码）：

| 维度 | 父级（国家/省） | 子级（城市/县） |
|---|---|---|
| 字号 | 档差 ≥2px；国家 10→15 | 首府 11→15、城市 10→15，高 zoom 反超 |
| 字重 | Regular + 加字距 | 首府 **Bold**（Liberty 三重冗余：字号+1~2px、Bold、图标大 25%） |
| 字形 | 州/县用 oblique 斜体（拉丁惯例） | 正体纯黑 |
| 字距/大写 | `character-spacing 0.5px` / `uppercase` | — |
| 颜色 | 去饱和灰（#333~#777）、z14 起次级降灰 + 白 halo | 纯黑 #000/#222 |

- **父子不互斥显示**：正确做法是"共存 + 层级差异 + 避让优先级"，不是二选一。([placenames.mss](https://github.com/openstreetmap-carto/openstreetmap-carto/blob/master/style/placenames.mss)、[Liberty](https://tiles.openfreemap.org/styles/liberty))
- 父级可当 **background label**（先放置，可被子级压）；子级给 label buffer（0.15–0.3× 字号）；子级 Never remove、父级可省略。([ArcGIS 背景标签](https://pro.arcgis.com/en/pro-app/latest/help/mapping/text/set-labels-as-background-labels.htm)、[权重规则](https://pro.arcgis.com/en/pro-app/latest/help/mapping/text/weight-labels-and-features.htm))
- **父子在同一次排布里**：MapLibre 实现 = 层序（顶层先放）→ 层内 `symbol-sort-key` 升序 → 瓦片去重；"先放的赢"。所以父子差异**只需一个数值化的优先级，不需要任何层级特判**（符合本项目"叠放无图层名特例"红线）。([pauseable_placement.ts](https://github.com/maplibre/maplibre-gl-js/blob/main/src/style/pauseable_placement.ts))
- **缩放阶梯**：父级先出现、后消失；符号先于文字消失（OSM 首都符号 z7 起、z8 起只留文字）。Natural Earth 用 `scaleRank/labelRank` 把"何时显示"做成数据字段。([placenames.mss](https://github.com/openstreetmap-carto/openstreetmap-carto/blob/master/style/placenames.mss)、[NE scaleRank](https://www.naturalearthdata.com/forums/topic/label-ranks/))

### 1.7 核心符号与核心地块

- **符号语义（CIA World Factbook 官方图例，从官方矢量 PDF 提取核实）**：**实心五角星 ★ = National capital，空心五角星 ☆ = Other capital**；符号在文字**左侧**，间隙 ≈0.6×字号，符号 ≈0.8–1.05× 字号。([CIA PDF](https://upload.wikimedia.org/wikipedia/commons/6/6a/CIA_WorldFactBook-Political_world.pdf))
- **OSM 系用同心圆 ⊙ 而非星**：首都 6→8px 环+心，一般城市 4→6px 圆；文字偏移 ≈0.5×字号，尝试顺序 `S,N,E,W`（文字优先放符号下方）。z8 起符号消失只留文字。([placenames.mss](https://github.com/openstreetmap-carto/openstreetmap-carto/blob/master/style/placenames.mss)、[place-capital-8.svg](https://cdn.jsdelivr.net/gh/gravitystorm/openstreetmap-carto@master/symbols/place/place-capital-8.svg))
- **USGS 无"首都星"**（符号表全文无 capital 条目）→ "军用手册首都=星"是流行说法、未证实。([USGS PDF](https://pubs.usgs.gov/gip/TopographicMapSymbols/topomapsymbols.pdf))
- **尺寸层级（可抄表）**：

  | 对象 | 符号直径 | 文字 |
  |---|---|---|
  | 首府 | 0.8–1.1 × 文字字号 | 13–15px、Bold |
  | 省会/中心城市 | 0.5–0.7 × 字号 | 11–13px |
  | 一般城市 | 0.36–0.5 × 字号 | 10–12px |
  | 相邻档差 | — | ≥2px |

- **选取规则**：数据优先（OSM `capital=*`/`admin_centre` 显式给，不是算出来的）；其次才是"重要性多因子"（Natural Earth：不纯按人口/行政）；**名称落位**用 polylabel 视觉中心，符号锚点用核心 cell；**符号不在几何中心时用引导线（callout，直线/折线/曲线/气泡）**。([OSM wiki](https://wiki.openstreetmap.org/wiki/Key:capital)、[NE label ranks](https://www.naturalearthdata.com/forums/topic/label-ranks/)、[QGIS Callouts](https://docs.qgis.org/3.44/en/docs/user_manual/style_library/label_settings.html))
- **自定义标记**：形状族必须与行政符号**分开**（图钉/旗/菱形，禁止再用星/同心圆）；pin 类 20–41px（Leaflet 默认 25×41），小符号类 0.9–1.1× 首府符号；用**色相**抢视觉重量而不是尺寸。([Leaflet 源码](https://unpkg.com/leaflet@1.9.4/dist/leaflet-src.js)、[Google Symbols](https://developers.google.com/maps/documentation/javascript/markers))

---

## 2. 细化后的需求（相对原始议题的增量已标 ★）

### A. 名称放置（面内）

- **R1 放置点 = 显示环上的最大内接点**，不再用 cell 质心平均。★
  - **必须基于元素的显示环**（本项目元素边界 = 过边中点的 Hermite 环，见 RENDER_LOGIC），不能用 cell 贴角多边形——否则"文字在面内"与实际画出来的面不一致。
  - **投影相关**：内接圆在投影后才成立（罗宾森/墨卡托形变不同）→ 放置点缓存键必须含 `projKey`，同 `ringCacheKey` 的纪律（不含内容指纹、O(1) 失效）。
  - 多片显示件（高度区间元素、被投影拆分的副本）→ **只在面积最大的片上放**（LabelLargestPartOnly）。
- **R2 放得下判定**：文字墨迹盒（`measureText().actualBoundingBox*`）居中于放置点，外接半径 ≤ 该点到环的最小距离（= 内接圆半径）；不满足则触发降级链。★
- **R3 降级链（顺序需拍板 P10）**：候选位轮换 → 移到最宽处的另一候选点 → 只显示核心符号+省略名称 → 面外+引导线 → 提高显示缩放门槛 → 放弃。**禁止为塞进面内而缩字号**（会破坏层级语义）。★
- **R4 狭长元素 = 沿长轴排字 + 重复注记**：长宽比超过阈值（建议 2.5–3:1）时，沿中轴取 2–N 个放置点，间距 ≥ 文字宽度 + 2×margin；同名重复视为正常（国家狭长地带的通行做法）。★
- **R5 弯曲（二期，P2）**：沿中轴/长轴逐字 `translate+rotate`，相邻字符累计转角 ≤ 25°（滑动窗口，窗口长 ≈ 3/5 字高），不倒置；放不下时不弯曲硬塞。★

### B. 排版与样式

- **R6 字号层级表**（全局档位，每层可覆盖）：建议 4 档——国家 15px / 行省 13px / 文化·宗教等语义层 12px / 次级或密集 10–11px；相邻档差 ≥2px。屏幕下限 10px。★
- **R7 中文排版适配**：**不做全大写、不做斜体**；用「字距 + 字重 + 灰阶」实现层级——国名 0.15em 字距 + Bold，行省 0.05em，语义层常规；子级纯黑、父级去饱和灰。★（西文惯例的中文化改译，调研原样照抄会做无用功）
- **R8 halo**：`lineWidth = max(1, round(size/4))`、颜色随底图（白 55% / 黑 70% 二选一，按层固定）；先调字色对比度、再调 halo。替换现在的定值 3。★
- **R9 核心符号与名称的相对位置**：符号在左、名称在右，间隙 0.5–0.6×字号；或文字在符号下方（OSM 序 `S,N,E,W`）。二者作为**一个整体**进碰撞盒。★
- **R10 标签文本来源**：`labelMode = name`（元素名）/ `coreLabel`（如"首都"标记在核心点旁）/ 组合（元素名 + 下方小字 coreLabel）。

### C. 层级与父子区分

- **R11 父子共存 + 差异编码**：字号档差、字重、字距、灰阶四维区分；**不做互斥隐藏**。★
- **R12 优先级单源**：一次排布内按「叠放序 + 层级 rank」的数值 sortKey，先放者占位——**优先级必须与 §5 叠放顺序同源**（焦点层 > 非焦点层、父 > 子、选中元素最顶），禁止另起一套图层名特判。★
- **R13 跨层碰撞**：`occupied` 从"每层重置"改为**全局一份**（网格哈希，cell≈25px），名称/符号/选中高亮共用一张表。★
- **R14 缩放阶梯**：按层配置 `minScale`（名称门槛）与符号门槛，符号先消失、名称后消失；替代现有 `cam.scale<90` 一刀切。★

### D. 核心地块与特殊地块

- **R15 核心符号体系**：`star`（实心星=首都/最高级）、`hollowStar`（空心星=其他首府）、`ring`（同心圆=文化/宗教中心）、`square`、`circle`（一般中心）。尺寸 = 首府 0.9×字号起、其余 0.5×；符号与名称整体参与碰撞。★（现状三种，缺空心星/同心圆，且尺寸与字号无关）
- **R16 核心地块选取**：三档——①**用户指定**（已有 `SetCenterCommand`，补 UI 按钮）②生成期 `selectCoreCell`（已有 5 种 selector）③新增 **`visualCenter` = polylabel 视觉中心**（与名称落位同源）。默认建议 `centermost` → 用户可改。★
- **R17 特殊地块（用户自定义标记）**：新数据结构 `cellMarkers: { cellId, symbol: 'pin'|'flag'|'diamond'|'star', color?, label? }`（世界级表，随存档走、可撤销），图层配置开关；形状族与行政符号分离、颜色用高饱和强调色。★（当前 `cellMarker` 只有 id/height 两种调试标记）
- **R18 配置面**：图层样式面板补「名称（关/元素名/核心标签）· 核心符号 · 字号档 · minScale」四项——现在引擎有、UI 全无，用户根本碰不到。

### E. 性能、失效与范围

- **R19 失效纪律**：放置点缓存键 = `projKey|元素显示件键|字号档`（`dataRev` 变则重算，禁止 O(n) 指纹）；文字宽度缓存已有（`字体|字号|文本`）。★
- **R20 预算**：装饰层每帧 O(可见元素数)，放置计算只在失效后算一次；碰撞查询走网格哈希，避免 O(n²)。★
- **R21 范围（P11）**：一期只做**平面视图**；球面 GlobeView 当前零文字，是否纳入二期需拍板；导出 PNG 应含注记（SVG 需单独排版，成本另计）。★

---

## 3. 待拍板清单（选项 + 推荐）

| # | 问题 | 选项 | 推荐 |
|---|---|---|---|
| P1 | 放置点算法 | A 质心（现状） B point-on-surface C **polylabel 最大内接** | **C**（配 R1 显示环 + projKey 缓存）；质心对凹面会出界，必须换 |
| P2 | 弯曲做不做、何时做 | A 一期就做 B **二期做**（一期先直线+重复注记） C 永不做 | **B**——中文名多为 2–4 字，面内直线已够；狭长面先用"沿长轴 + 重复"解决 |
| P3 | 字号体系 | A 全局单值（现状） B **全局 4 档层级表 + 每层覆盖** C 每层各自随意填 | **B**——档差是层级可辨的硬要求，全局表保证父子关系一眼可读 |
| P4 | 中文层级手段 | A 照抄西文（大写+斜体） B **字距+字重+灰阶** | **B**——中文无大写，伪斜体可读性差（调研原文明示斜体小字号难读） |
| P5 | 父子显示策略 | A 父级仅在子级未显示时出现 B **共存 + 差异 + 优先级** | **B**（OSM/Liberty 实测均共存；A 会丢掉"大国名"这个最重要的信息） |
| P6 | 核心符号形状 | A 沿用 star/square/circle B **扩为 star/hollowStar/ring/square/circle**（实心星=首都、空心星=其他首府、同心圆=文化/宗教中心） | **B**——CIA 官方图例实测可直接照抄，且与现有 circle 预设兼容 |
| P7 | 核心地块默认选取 | A random（现状多数层） B centermost C **visualCenter（polylabel）** D 用户手点 | **C 为默认 + D 为修正手段**——名称与符号同源落位，视觉上才"居中"；`SetCenterCommand` 补按钮（OPTIMIZE §6 半成品） |
| P8 | 放不下时的降级顺序 | A 缩字号 B **候选位 → 省略名只留符号 → 面外引导线 → 提高门槛** | **B**（缩字号违反制图惯例，会暗示等级不同）；引导线成本高，可放最后 |
| P9 | 狭长面 | A 只放一次 B **沿长轴重复 2–N 次** C 弯曲 | **B**（一期）；C 归 P2 二期 |
| P10 | 优先级单源 | A 装饰层自成一套 B **复用叠放顺序 + 层级 rank** | **B**（红线：叠放无图层名特判；两套顺序迟早打架） |
| P11 | 球面/导出 | A 一期含球面 B **一期只平面，球面二期**；导出 PNG 含注记 | **B** + PNG 含注记（球面是纯展示契约，且零文字现状是既成事实） |
| P12 | 特殊地块标记 | A 不做 B **世界级 `cellMarkers` 表 + 图层开关** | **B**（你点名要的"用户自定义五角星/圆点"需要持久化数据结构，不是显示层开关能解决的） |

---

## 4. 分期建议（每包可独立验收）

- **包1 放置与可读性**（P1/P8）：polylabel on 显示环（projKey 缓存）→ 放得下判定 → 降级链 → 全局碰撞网格（跨层）→ halo 按字号算。
- **包2 层级样式**（P3/P4/P5/P10）：字号 4 档表 + 中文排版（字距/字重/灰阶）+ 优先级单源（叠放序）+ 缩放阶梯（R14）。
- **包3 核心符号与核心地块**（P6/P7）：符号族扩充 + 尺寸随字号 + 符号/名称整体碰撞 + `visualCenter` 选取 + 设中心按钮。
- **包4 弯曲与重复**（P2/P9）：中轴折线 + 逐字旋转（25° 窗口上限）+ 沿轴重复注记。
- **包5 特殊地块 + 配置面**（P12/R18）：`cellMarkers` 数据结构 + 图层样式面板四项配置。

---

## 附：主要来源

面内放置/字号/避让：[polylabel](https://github.com/mapbox/polylabel) · [OSM Carto placenames.mss](https://github.com/openstreetmap-carto/openstreetmap-carto/blob/master/style/placenames.mss) · [Positron style](https://basemaps.cartocdn.com/gl/positron-gl-style/style.json) · [ArcGIS labels for polygon features](https://doc.esri.com/en/arcgis-pro/latest/help/mapping/text/labels-for-polygon-features.html) · [QGIS label settings](https://docs.qgis.org/3.44/en/docs/user_manual/style_library/label_settings.html) · [Axis Maps labeling](https://www.axismaps.com/guide/labeling) · [Colorado typography](https://colorado.pressbooks.pub/makingmaps/chapter/typography/) · [OS guide to cartography](https://docs.os.uk/more-than-maps/geographic-data-visualisation/guide-to-cartography/text-on-maps)
弯曲/算法实现：[SVG1.1 textPath](https://www.w3.org/TR/SVG11/text.html) · [MapLibre check_max_angle.ts](https://github.com/maplibre/maplibre-gl-js/blob/main/src/symbol/check_max_angle.ts) · [Mapnik TextSymbolizer](https://github.com/mapnik/mapnik/wiki/TextSymbolizer) · [QGIS qgspallabeling.cpp](https://github.com/qgis/QGIS/blob/master/src/core/labeling/qgspallabeling.cpp)
碰撞/优先级：[MapLibre style spec](https://maplibre.org/maplibre-style-spec/layers/) · [grid_index.ts](https://github.com/maplibre/maplibre-gl-js/blob/main/src/symbol/grid_index.ts) · [ArcGIS background labels](https://pro.arcgis.com/en/pro-app/latest/help/mapping/text/set-labels-as-background-labels.htm) · [MapServer label](https://mapserver.org/mapfile/label.html) · [OSM Carto #1391](https://github.com/openstreetmap-carto/openstreetmap-carto/issues/1391)
符号：[CIA World Factbook PDF](https://upload.wikimedia.org/wikipedia/commons/6/6a/CIA_WorldFactBook-Political_world.pdf) · [USGS topographic map symbols](https://pubs.usgs.gov/gip/TopographicMapSymbols/topomapsymbols.pdf) · [OSM capital wiki](https://wiki.openstreetmap.org/wiki/Key:capital) · [Natural Earth label ranks](https://www.naturalearthdata.com/forums/topic/label-ranks/) · [Google markers](https://developers.google.com/maps/documentation/javascript/markers)
