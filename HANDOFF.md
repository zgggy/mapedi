# Mapedi 交接（给下一轮 AI）

工作目录 `/Users/zgy/mapedi`，应用 `web/`（Svelte 5 + TS + GL 直绘，100k cell）。**工作区干净；git log 头 = 第三十三轮 胶囊组件化+选中即显示。**

## 先读

1. `AGENTS.md` — 协作规则与红线（六层定位模型、根因流程、硬规则、测试纪律、文档分层 §9）
2. `RENDER_LOGIC.md` — 显示契约与模块边界
3. `ROADMAP_REFACTOR.md` — 还债路线与已知问题（含证据行号）；产品缺口 → `ROADMAP.md`
4. `docs/ARCH_REVIEW_2026-09-29.md` — 全库评审快照（还债排序依据）
5. `docs/UI_REFACTOR_2026-09-29.md` — UI 九轮迭代规格与决策记录（§9 两表 D/C/E 系拍板 + 第十轮语义解析标注）

`docs/_archive/`、`docs/history/`（59 轮旧日志）**禁止当实现依据**。**注意**：投影动画/模式切换有并发会话线，接手前先 `git log`。


## 当前状态（第三十三轮完成；在案：`36f7773` 步骤7 → `2888b97` 三十一轮标志位 → `e5d4946`+`3d3a9a9` 三十二轮 → `b4995bf`+`3b08fdd` 展开区拍板实施 → 第三十三轮 胶囊+选中即显示）

- **✓ 第三十三轮（2026-10-02 N选1/状态胶囊组件化 + 选中即显示）**：
  - **N 选 1 → ModeCapsule（图标配文字）**：大陆占比四档（○小◎中●大◉特大，无档滑钮隐藏）、地图风格/投影两个 select 换胶囊；顶栏视图/工作区模式本就是胶囊 ✓。
  - **状态 = StateCapsule 新组件**（边框+背景区分状态、图标+状态文字）：视图设置三开关（🧭🟡🔄）、边界/填充显示、检查区显隐胶囊；checkbox 全清零。**修极性 bug**（图层 on 误写 `!visible` → 现场两态复验：海陆=已隐藏、高度=显示中）。
  - **选中即显示（用户原话「选中既显示，不影响显隐状态按钮」）**：`isLayerShown` 读时派生（焦点层强制显示；不写 visible、不动按钮、焦点走完回存储态）；AGENTS/RENDER_LOGIC 契约同步；像素验收=聚焦海陆显出 69.1%、收起缩回 68.8%、稳定 0；页内 compose 三态 `''→sea0 / 'landsea'→sea87`。旧「焦点不改显示」判废除（记录于契约行）。
  - **PlanetParams 孤儿删除**（全库零引用，被 ViewSettingsPopover 取代）；⚙ 位置标记（D6 L0 徽标=「有专属生成面板」状态标，非按钮）。
  - 基线：tsc 0、svelte-check 0 errors；第三十轮剪至 `docs/history/HANDOFF_LOG_2026-10-01.md`。


- **✓ 第三十二轮（2026-10-02 球面手感 + C7 移除 + 展开区方案）**：
  - **惯性**（用户要回）：拖动按事件估速（平滑），释放后指数衰减积分滑行（INERTIA_K=3.0、V_CUT=0.03、抓取清零接管）；验收=释放 400ms 盘面仍变 32.1% → 4.6s 仍转 → 5.2s 归零停稳、台架恒 0.1%。
  - **极点限位**（用户定）：翻转累计绝对角钳 ±90°（极点正对相机即停），固定屏幕水平轴实现，撞墙速度归零。
  - **删 C7 点选镜头对准**（用户拍板不需要）：Viewport reveal 块/railW prop/App 传参/planeCamera 三孤儿导出（bestDrawDxFor·revealCamTarget·startCamTween）全删（−165 行）；点选「腓尼基」回归零错。
  - **交付并实施 `docs/EXPAND_REFACTOR_2026-10-02.md`**（8 格盘点/问题 P1–P9/L0–L3+重要×便捷矩阵/逐格规格；**D1–D8 当日拍板**：D1 折叠✓ D2 涂改归绘制✓ D3 hover✓ **D4 否决** D5 笔刷留行内✓ D6 L0 徽标✓ D7 删相邻✓ D8 隶属跳转✓，实施 `b4995bf`：图层检查 333→226px(-32%)、跳转/徽标/折叠/区间徽章/绘制滑块全验收；剩余包3 生成网格、包5 tokens；父子图层优化项 O1–O8 见 HIERARCHY §11）。
  - 基线：tsc 0、svelte-check 0 errors（第二十五轮已剪入 `docs/history/HANDOFF_LOG_2026-10-01.md`）。

- **✓ 第三十一轮（2026-10-02，步骤7 转包②：图层名标志位）**：
  - **LayerDef 三标志（数据模型级）**：`genStrategy: 'scatter'|'heightmap'|'elements'`（缺省 elements）、`focusAfterGen`、`editsHeight`——cells/height 在 `builtinLayers` 声明，`ensureBuiltinLayers` **旧档回填**（与 kind 同策略强制同步）；读取单源 **`core/layer/flags.ts`**（genStrategyOf/editsHeightAt/defaultFocusLayerId/heightmapLayerId/editsHeightLayerId），消费点禁比 id 字符串。
  - **landsea 身份收进 landSea 模块**（选标志位而非标志——模块本职）：`landSeaLayerRegions`/`landSeaContinentRegions`/`isLandSeaLayer` 选择器单源；`displayCompose.isFreeLayerId` = kind 版 lookup（Viewport/WD/DisplayStylePanel 三处 id 三连比较收编，DisplayName 面板补 world prop）。
  - **迁移 ~35 处**：生成三分支（GenerateSection strategy prop/unified/generationService）、生成后聚焦（focusAfterGen，整链+单层）、worldShape 参数视图、showCellMesh（baseMesh）、高度域 UI（App 选中=区间、Viewport overlay 标签×2、WD canCreate+区间 ensure 收编 heightIntervalRegions）、flush diff/大陆中心/手动分割（选择器）、默认焦点回落（replaceWorld/删层回落=defaultFocusLayerId）、commandService 建层路径分支（isFreeLayerDef(meta)）；死码 `genLabel`/`isPath` 删；`types.ts` opacity 过时注释修正。**判定保留（注释说明）**：模块本域 id（political/heightElements/landSea 内部）、SVG 导出描边（storage 导出呈现域）、`__height__` 笔刷协议（区间元素属性驱动）。
  - **验收**：tsc 0 / svelte-check 0 errors（5 warning 存量）；浏览器=**旧档回填读证**（恢复档 cells gs=scatter、height 三标志齐、focus=cells）+ 生成三分支面板逐一命中（撒点/生成高度图/重新生成「国家」）+ height regen（status「已重新生成：height」、焦点与 visible=focusAfterGen 路径）+ 高度层创建行禁用留搜索框 + 球面↔平面往返零错（**会话1 左轨 viewMode bug 未复现**）、`lastError` 空。**未跑测试**（纪律）。
  - **插单批（同轮用户点名，四件）**：① 球面半圆弧竖转 90°=地球仪弯支架 → 二修定稿=**绘制另一半（镜像凸右）+ 方位实时锁定**：挂 `arcHolder` 世界组（**不挂相机**，用户定）、每帧 `rotation.y=atan2(dx,dz)` 对准相机——左右拖动弧在屏幕上纹丝不动、上下拖动照常透视旋转（竖向中点恒在正对屏幕的竖直平面内）；像素验收=横拖盘面变 49.7% 而弧统计逐位不变、竖拖 yExtent 670→617→544、洋红描点证凸右；② **球面南北极翻转对齐平面「北在上」**（根因=`core/sphere.ts` 沿用已归档 Canvas2D 时代 +y 向下约定→成对翻正 `eb88373`；`sphereOrient` 测试业务规则同步更新=用户方向即新契约；northY 探针=+1）；③ 检查展开区紧凑化（身份行内联+KV 流式+样式表头并显隐开关+嵌入去 padding，`8882c6e`——**544→333px/-39%** 信息不减、新增元素「隶属」行、图层计数标签改「元素」）。⑤ **球面交互终稿·实物地球仪模型（四修，用户「不能让星球自己转吗」点醒换模型根治）**：**相机固定**（滚轮缩放=手写（精确验证 2.384→1.4754=e^−0.48），OrbitControls 退役）；**左右拖=星球绕自转轴自转**（轴/赤道/支架=台架不随转——横拖不摆回归 ✓）、**上下拖=星球系统绕屏幕水平轴翻转**（黄道 standGroup 永不转恒水平 ✓）；三轮「环绕轴 vs 屏幕姿态」互斥死结由**转物体不转相机**溶解；弧三规格在实物模型下全部成立（横拖不摆✓俯仰=刚体翻转✓默认机位中点∈屏面✓）；验收=横拖内环20.2%/台架0.4%、竖拖内环21.1%+弧像素230→21（随架翻出带）、滚轮单事件数学精确、lastError 空（合成指针 setPointerCapture 包 try 根治污染）。lastError 空。**验证法教训：截图尺寸会中途变化（1280×720→1410×1134），像素分析必须先读 w/h 且排除顶栏/状态栏青蓝 UI（否则 bbox 被钉死在框边）；1px 细线被设备像素比稀释，颜色阈值要松+细线+暗邻域三重过滤，必要时洋红描红定位；近距机位弧超扫描带→bbox 指标饱和失真（换像素计数/带内比例）；**合成 PointerEvent 在 OrbitControls setPointerCapture 处必抛（No active pointer）→ 拖动验证只能用 CUA 真指针**；连续 reload 后 viewMemory 为 null=回默认机位（可利用做确定性 A/B）**。⑥ 高度档「高平原」→「高原」：`heightIntervals.NAMES` 改表 + `normalizeHeightIntervalElements` 载入时**名称随表单源**同步（区间=派生结构数据；边界：曾手动改过的档名会被表默认覆盖）。存量进度：容差 ✓ / 图层名标志位 **✓** / as-unknown ☐。

- **◐ 第二十九轮（2026-10-01，还债步骤 7 大扫除：死码/孤儿/两修复全清）**：
  - **七项死码按当日现状复核**：cellIndex **整文件删**（索引零读者，invalidate 无读者=无效失效）+ rebuildNeighborsFromSharedVerts + NamePlacement/nameStyle + cellsLayer 空桩出双管线；centerLabel/PathFeature.name 判**活**保留；Viewport 旧注释已随重构漂移无存。
  - **孤儿链全删（外部零调用实证）**：store（applyNature/regenPolitical/regenNetworks/applyHeightmap/measureClick）、CommandService（rename/recolorSelected）、DrawController（roadBreaks）、GenerationService（applyGenPreset/toggleProfile）；**nature.ts 整文件删**+biomes 瘦至 83 行活核+climate.test 删 nature 两案+networks/perf 夹具换 computeBiomes；SOFT_MAX_DENSITY 死导出删；store **888→803**。
  - **修复①路网**：校验先于清空（roads+routes）——合成探针双分支 verdict=true（早退保留/正常清空）。
  - **修复②撤销父残留**：undo/redo 补物化 + materializeParentCells 改**精确派生（父≡∪子）**——6/7 对恒等、唯一 extra=历史残留→**自愈 extraNow=[]**、撤销 unrestored=[] 逐位还原。**语义注**：从空重建的前提=「父 cells≡∪子」实测成立（AGENTS §3 字面语义）；若未来出现父直接持有子外 cell 的合法流程，需回看此假设。
  - **转独立小包三项存量**：容差字面量 65 处 / 图层名硬编码 30 处（=LayerDef 标志位数据模型级）/ as unknown 25 处 11 文件——详见 ROADMAP 步骤7。
  - 基线：tsc 0、svelte-check 0 errors；冒烟=四次模式切换+建层撤销零错。
  - 进度：**1 ✓ 2 ✓ 3 ✓ 4 ✓ 5 ◐（剩 shell 协调+两小包）6 ◐ 7 ◐（三项存量转包）**。


- **◐ 第二十八轮（2026-10-01，还债 5-c 首批：App 转发器瘦身）**：
  - **审计**：双向比对 39 个 on* 赋值**零死转发**（前轮已清 canPaint/onMoveLayer 类）。
  - **首批三件（不碰 shell prop 面）**：① Viewport 四纯转发下沉（paint/radius/endpoint/strokeend → 直调 editor，路径编辑同先例）——真指针笔画验收：61→撤销精确回 10、栈 1；alt+滚轮 1.5→1.65；② `organize` 下沉 CommandService+门面（indent 翻转+回弹 ✓）；③ 死 CSS `.gen-pending` 删。App 532→509、Viewport 1437→1423、tsc/svelte-check 0。
  - **☐ 剩余 ~35 个 shell 转发待 UI 重构线协调**：TopBar 12（rename/export/import/style/projection/globe×5/switchView…）、WorkspaceDrawer 11、LayersPanel 7、GenerateSection 4、LeftRail 4——**勿单方面删改**；届时按「组件直连 editor 或收进 UI 状态模块」两路处理。
  - 子包进度：5-a ✓ 5-b1~5-b5 ✓ **5-c ◐（首批）** / 步骤 7 ☐。

- **✓ 第二十七轮（2026-10-01，还债 5-b5：CommandService 命令 CRUD 出库）**：
  - `app/commandService.ts`（814 行）：undo/redo+类型分发/删·复制·吞并/图层树缩进·提升·移序/样式·显隐·透明度/路径快照执行器+拖动会话/字段快照执行器/新建·重命名·换色全量出库——**方法体原样搬运**（`this.*` 经类内代理映射 Ctx，零改写，diff 安全）；选中类留 store（App 直连）。store **2045→888**。
  - **验收（八组门面回归）**：建层/元素复制/删除层/缩进提升/显隐/样式/withPaths/patchRegions 全经 facade 生效+撤销回滚；样式真值 border.width 0.8→4.2→0.8；栈归零、IDB 15 层清净（测试层无残留）、零 console 错；tsc/svelte-check 0、孤儿 import 29 项清。
  - **验证教训（入 quirks）**：undo 换 world 身份后**数组长度断言读旧引用=假阴**（曾把八组里六组误判失败）——对象字段级断言 + `history.depth` 栈计数 + IDB 实读三口径才可信。
  - 子包进度：5-a ✓ 5-b1 ✓ 5-b2 ✓ 5-b3 ✓ 反馈四件 ✓ 5-b4 ✓ **5-b5 ✓** / 5-c App 回调瘦身 ☐ / 步骤 7 ☐。

- **✓ 第二十六轮（2026-10-01，还债 5-b4：DrawController 绘制会话出库——今天收工批）**：
  - `app/drawController.ts`（400 行）：会话启停（成员/高度/道路）+ 笔刷命中 + **笔画快照-diff 入栈**（undo 腐蚀采集端）+ 洪水填充/设中心/道路端点；paintDirty/strokeSnap/高度样本/区间选择随类迁移；Ctx 注入选中/状态/失效族（$state 写留 store 闭包）；store 六段 facade 零调用点改动（**1686→1462**）。
  - **验收**：高度三态=画 17/17/4 → 撤销全 0 → 重做全 0（干净栈 stack0=0）；成员笔画=无主地 +17 收编 → **被画子层撤销精确还原 du=0**、depth=0；drawGuard 行省隐藏警示正常；tsc/svelte-check 0。
  - **预存缺口登记**：撤销后**父层物化残留**（父 cells=子并集，undo 只 touchWorld 不重物化→父多出 cells 残留到下次 touchRegions）——终证 +16 残留实测，代码同构推定预存，已入 ROADMAP 已知问题（修法=undo 后补物化，注意频率成本）。
  - **环境插曲**：vite 开发服务器中途死亡（5173 拒连）→ 已后台重启（`npm run dev`，日志 /tmp/vite-dev.log）；测试间歇污染（残留笔画栈/已涂状态）靠 reload 清栈 + 自适应涂改值化解。
  - 子包进度：5-a ✓ 5-b1 ✓ 5-b2 ✓ 5-b3 ✓ 反馈四件 ✓ **5-b4 ✓** / 5-b5 CommandService ☐ / 5-c ☐。

> 更早轮次（第十一~十七轮、1-b 路径包、渲染错乱根因、还债步骤 2/3/6、速修包、冻结 P0、第十一/十二轮）已剪至 `docs/history/HANDOFF_LOG_2026-10-01.md`（冻结）。

- **✓ 插单（2026-10-01 用户点名）：球面轴⟂赤道 + 下弦弧**：轴线补 `rotation.z=-tilt`（原漏倾斜）；下弦弧=世界系 XZ 平面 r=1.30（>星球>赤道）青色细线同赤道款、只画朝相机前半、挂 overlay 不随自转随拖动转、随⚙「轴」开关。**验收（stash A/B 同机位逐行扫）**：轴 A 恒 x=639.5 → B 斜率 -0.438≈-tan23.4°；弧 759 新青像素全在下方、尖端 x±239 超赤道、A 基线 0。验证坑（默认机位轴尖出画/重载丢 viewMemory）入 quirks memory。

- **✓ 第二十四轮（2026-10-01，还债 5-b3：相机运算出库 `ui/planeCamera.ts`）**：
  - 勘察结论：**MapTransform 原语早已成形**（`render/space.ts`/`map2d.ts`），抽的是手势运算与 C7 反解：`zoomCamAt`（锚点缩放）/`panCam`/`contentPanDeltaX`/`bestDrawDxFor`（可见副本挑选）/`revealCamTarget`（遮挡反解）/`startCamTween`（180ms easeOut）——145 行纯函数独立可测；手势监听与绘制状态机留 Viewport。Viewport 1483→1437。
  - **验收**：缩放 ratio=1.331=1.1³、锚点世界点误差 1.6e-16；右键内容 +0.563、中键 dx=-80/319·dy=+40/319 精确；**C7 露出端到端**=华夏拖至 sx137（轨下）→点行→补间 camDx=-2.059→sx794 入可见区、仅越界轴修正 dy=0；tsc/svelte-check 0。
  - **环境坑（入 quirks）**：失焦页 rAF 冻结（0 帧）→ 补间类验证全假阴——**连拍 `tab.screenshot()` 泵 BeginFrame 即恢复**（4s/54 帧），泵帧后再读结果。
  - 子包进度：5-a ✓ 5-b1 ✓ 5-b2 ✓ 插单 ✓ **5-b3 ✓** / 5-b4 ☐（Command/Draw）/ 5-c ☐。

- **✓ 第二十三轮（2026-10-01，还债 5-b2：GenerationService 生成编排出库）**：
  - `app/generationService.ts`（239 行）：Worker/主线程双路+regenLayer+profiles·worldShape·预设·开关出库；**generationSeq 模块化**（与 tryRestore/import 共享互斥闸）；store 六门面调用点零改动；store 1810→1686。
  - **修预存静默缺陷**：profileParams 直传 ui=$state 深代理 → Worker postMessage DataCloneError → **生成一直无声回退主线程**（旧 catch 吞错，本批加 console.warn 才暴露）；修=params `{...p.params}` 平面化 → 实测「100000 地块 · Worker」11.2s 零 warn。
  - **验收**：参数三件快照-还原逐位一致（toggle/setProfileParam/预设 landRatio 0.12）；3k Worker 路径 status「地块 · Worker」；regenLayer 回显；tsc/svelte-check 0。
  - **⚠ 事故（诚实记录）**：真点生成的 invalidate 保护法**失手**——3k 测试世界写进 autosave（唯一键）覆盖用户 100k 旧档；已默认参数重生成 100k（seed=页面草稿 188943080）落盘恢复。**教训：保护法用 IDB 快照（先读 json 留底、测后回写），invalidate 不保险**（见 generation-harness memory）。
  - 子包进度：5-a ✓/5-b1 ✓/**5-b2 ✓**/5-b3 ☐（MapTransform/ViewportController）/5-b4 ☐（Command/Draw，UI 态耦合最重殿后）/5-c ☐。

- **✓ 第二十二轮（2026-10-01，还债 5-b1：自动保存机械出库）**：
  - **`app/autosaveService.ts`（新 ~140 行）**：2s 防抖+epoch 作废+Worker 派发（busy/latest-wins）+DataCloneError 平面化重试+同步降级链+drain 等待器整体出库；Ctx={world/snapPaths/autosaveAt/status}（**$state 写仍走 store 闭包**）；Worker URL `../persist/saveWorker.ts` 从 app/ 出发同深度不变。
  - **store**：删 saveTimer/saveEpoch/saveQueue/saveWorker* 七字段 + scheduleAutosave/saveDrain/releaseSaveWaiters/ensureSaveWorker/dispatchSave/saveSync 六方法体；留 `scheduleAutosave()` 门面；`replaceWorld/clearAutosave` 改 `autosave.invalidate()/drainQueue()/drain()`；孤儿 import（idbSave/serializeWorld）清。store 1900→1810。
  - **验收**：显隐触碰→防抖 2s→Worker→回显 3:51:36→3:51:59；**IDB 实读** at 新鲜/cells=100000/regions=162/无 cellClimate/biome（步骤4 回归✓）；Ctrl+Z 复原；tsc/svelte-check 0。**注**：clearAutosave 未实跑（删用户存档=破坏性，机械移植+tsc 兜底）；DataCloneError 重试=1-b 已验收逻辑原样搬运。
  - **步骤 5 子包进度**：5-a ✓ / **5-b1 ✓** / 5-b2 ☐（CommandService/Generation/DrawController）/ 5-b3 ☐（MapTransform/ViewportController）/ 5-c ☐。

- **✓ 第二十一轮（2026-10-01，还债步骤 5-a：失效管线与队列出库 + 失联清账）**：
  - **`app/changePipeline.ts`（183 行新模块）**：touch* 七方法 + markHeightDirty/flushHeightRegions + 高度脏状态出库；`PipelineCtx` 注入 world/setWorld/notify/scheduleAutosave（**$state 写入留在 store 文件内闭包**——Svelte 按声明文件编译状态写）；store 留同名薄门面=调用点零改动；删死字段 heightNotifyQueued。
  - **`render/patchQueues.ts`（73 行新模块）**：三队列+同键合成=模块单例（rev.ts 先例）；Viewport 3 处 `editor.consume*` → 模块导入（**渲染不再反向 import store 私有队列**=步骤5 验收项）；store 定向失效改 `queuePieceInvalidation`。
  - **失联清账**：canPaint 死 prop 全删（App 从未传）、panningMode 'cam' 死成员删、onpaint 丢参=第十四轮已修（闭合）。
  - **验收**：显隐经新管线翻转+撤销回弹零错；高度笔画 61→-10→撤销 61；**队列 E2E=同步窥探 deltas8/patches3（消费后原样还回防污染）→让帧→队列排空**；tsc/svelte-check 0；store 2045→1900。
  - **步骤 5 子包化**：5-a ✓ / 5-b ☐（CommandService/Generation/Persistence/DrawController+MapTransform/ViewportController）/ 5-c ☐（App ~75 回调瘦身，与 UI 重构线协调）——见 ROADMAP。

- **✓ 第二十轮（2026-10-01，还债步骤 4：cellClimate/biome 真相归位 P0，A 案）**：
  - **实况比评审更空**：现行 unifiedGenerate 管线根本不产两字段（活世界恒空）、唯一写入口=孤儿 applyNature、消费者全 `?.`/fallback 静默降级——评审"存档带进下次会话"的过期问题实为**身份混乱**（有的档带有的不带）。
  - **落地**：serialize/deserialize 删两字段（legacy 档字段被忽略、下次保存消失）；`rev.heightRev()` getter（原来只有 bump）；`ensureClimate`（缺席或 `computedAtRev≠heightRev` 才算，`computeClimate` 直算自动刷戳）；`biomes` 拆 `computeBiomes`（纯分类）/`generateBiomes`（+env 区域同步，签名不变）/`ensureBiome`；消费接入两处：`generateRoads` 入口、`exportGeoJson` 入口（biome 不再恒 null）。契约注释改「运行时真缓存不落盘」。
  - **验收**：三态语义 mountain/-37.4° → 画-10 → ocean/2° → 撤销 → 精确回基线；首算115ms/命中0ms/变更重算111ms sameMap=false；serialize 顶层无两字段；legacy 注入兼容；road 入口自回填 207ms；tsc/svelte-check 0。
  - **两注**：仅改河流不翻 heightRev（partial regen UI 不可达，±0.15 边界）；**探针直调 generateRoads 把原 1 个 road 区域清成 0**（首都不连通全 skip=预存行为，已登记已知问题表——biome 只做正系数缩放不碰连通闸，与本改无关）。

## 遗留清单（按优先级）

1. ~~1-b~~ **已收口（第十八轮）**：路径✓（`43ff5d1`）/顺序✓/复制·删除·死码✓；判定残余=climate/astro（孤儿归步骤 7）、道路端点 `endpointOverrides`（region 域归 1-c 后核对→已随 1-c 收口记录）。
2. ~~1-c~~ **已收口（第十九轮）**：闭包清零、undo/redo 返回命令+store 类型分发；残余=Set/Map 载荷 JSON 编解码（历史面板持久化时补）+ 高度撤销 continentId 标签漂移（预存已登记）。
3. 还债步骤 **1 ✓ / 2 ✓ / 3 ✓ / 4 ✓ / 5 ◐（5-a ✓ 5-b1 ✓ 5-b2 ✓，剩 5-b3 Viewport 变换、5-b4 命令/绘制、5-c App 回调）/ 6 ◐**、步骤 7 大扫除（顺带判 climate/astro 孤儿 + nature.ts 死码 + 路网再生成设计）。
4. ~~两面板创建行共用 newName~~ **已拆**（第十二轮：各面板局部 text 独立过滤）；全局 newName 现只服务子级 CreateBox。
5. 同类 stale 潜力点按 view 快照模式逐步收编（DisplayStylePanel 内部直读 style 的模板等——见 ROADMAP_REFACTOR 已知问题表）。
6. **专属色/外交 = UI 已删、数据层 legacy 保留**：`Region.exclusiveColor`、`core/diplomacy.ts`、piece 传递与 regionOps 自动填充仍在（无 UI 入口）——若要"概念彻底消失"需动渲染/序列化，待用户拍板再清。

## 验证方法论（本会话累积的坑，务必沿用）

- **给 svelte 内部打桩（冻结诊断）三层缓存坑**：① `.vite/deps/*.js` 是 immutable(`max-age=31536000`)——改输出文件浏览器永不重取；② vite 进程对 `?v=` URL 有内存态；③ `v=` 哈希由 lockfile 锚定、re-optimize 会弹回。**可行路径=改 svelte 源码 → rm `_metadata.json` → 重启 vite → 用全新 origin 端口（5176/5177…）**（内容哈希文件名会变，入口 client.js 名字不变所以必须换 origin）。**用完必须撤桩**：`npm install` 对已满足版本是 no-op，要 `rm -rf node_modules/svelte && npm install` 才真还原。
- **共享环形日志不能逐条驱逐**：`splice(0,N)` 会把计数污染成假象（曾把 PROC-OUT 全"删"成 0 误判挂起）——要么不截断、要么另设永不丢的计数器。
- **WebGL 上下文属性 = 首次 getContext 调用者决定**：任何 `canvas.getContext('webgl2')` 都必须由持有完整参数的创建方发起（renderer 首调）；探针/判活一律走 renderer.isLost() 或复用已有 context——无参 probe 曾把 stencil 打成 false（渲染错乱根因）。
- **像素 A/B 必须等沉降**：渐现/warm 期间画面持续变化（曾把 3.5s 时点的明暗差误判为代码差异；连续两张不为 0 = 未沉降）→ 采样前先「连续两张 diff=0」再对比；同理 `tab.screenshot()` 偶发 30s 超时 → 三次重试包装。
- **正则/字符串锚点别撞调用点**：给函数插代码时锚「函数定义」而非函数名（`touchLayerView()` 首个匹配是调用点 → 曾误植 scheduleAutosave 到别的函数）；插完必须 grep 落点逐个核对。
- **`$state.raw` 无深代理**：模板/派生直读其对象的可变属性（`layer.visible`/`region.name`…）**不被追踪**，中间派生输出同引用会截断失效链（身份换了也白换）→ 展示值一律走「rev+world 键控的快照派生（输出新对象）」；判定法=三态时序读（点前/点后/再点后 对比 数据值 与 界面文本 是否同步翻转）。
- **`locator.fill("")` 在本 runtime 不触发 input**（清空假象：value 不回写状态）→ 清空/设值用原生路径：`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inp,v); inp.dispatchEvent(new Event('input',{bubbles:true}))`。
- **页面模块活实例探针**：`performance.getEntriesByType('resource')` 取带 `?t=` 的真实 URL 再 `new Function('u','return import(u)')(url)` ——直接拼裸 URL 会拿到**分裂的新实例**（world=null/plane=null 假阴性）；可读 `store.editor`、`viewMemory.plane.cam`（相机/对准的硬证据）。
- **像素对比验收**：`tab.screenshot()` PNG → `/tmp/pngutil.mjs`（zlib inflate+unfilter 解码）→ 网格采样量化4bit → diff%；遮掉左栏(x<330)/状态栏(y>650)；先测 diffStable=0 排除渲染噪声；合成 PointerEvent 可驱动右键内容平移（`canvas[1]`、button:2/buttons:2 序列）。
- **CUA scroll/domCuaScroll 本会话 30s 整体超时** → 测原生滚动用可信键盘：`locator.press('PageDown')`（CDP 真实键事件，触发滚动容器原生滚动，实测 0→220.5/0→126）。合成 `dispatchEvent(WheelEvent)` **不会**滚（untrusted 不触发默认行为）。
- **活性检测器必须与代码版本无关**：A/B stash 实验里用「创建行输入=过滤器」判冻结，在基线（搜索行未并入）上必假阳性——判定冻结用**模式胶囊切换**（任何版本都由状态驱动）。
- **Svelte 冻结诊断**：`const dyn=new Function('u','return import(u)'); const rt=await dyn('http://localhost:5173/node_modules/.vite/deps/runtime-*.js?v=...')` → 读导出 live binding `rt.n`（=active_reaction）、`ar.deps[].label`、`ar.deps[0].v.length`（数组长度可辨认是哪个列表）。
- **点击后必须断言生效**（如 `li.open .nm`）再进入下一步，否则整轮假阴性（顶峰未选中那次）。
- **git stash/pop 会触发 vite 整页重载**：`window.__errs` 等页面探针会丢，A/B 中段的「冻结/未冻结」读数可能被重载污染——判定前后先验探针存活。
- **evaluate 派发 `.click()` 可靠**；role=radio 的 BUTTON 走 Playwright click 会 actionability 超时（本项目胶囊/行按钮普遍）→ 一律 evaluate 派发。
- **CUA 组合键（Control+z）会整轮失灵** → 页内 `window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))` 直发，可靠。
- 状态栏文案在 `.pill .zone`（`.st` 不存在）；**error 会盖住 status**（隐藏层红字）→ 先开眼再验。
- `createRegion` 自动选中新元素 → 紧接着点行 = toggle 取消（单开互斥）→ 验证要探针式点到选中为止。
- 改名撤销的判定读**列表行文本**（EntityInfoBody 输入框是本地副本不随 undo 刷新，读它会误判）。
- 眼睛/行按钮常 **hover 才可见**（Playwright 可见性等待会超时）→ `evaluate` 派发 click。
- 元素行是**单层** `.ws .acc`（不是 `.acc .acc`）；聚焦在地块层时元素列表为空（空态提示=正常）。
- 改 `.svelte/.ts` 后 Edit 工具会因 mtime 报 "modified since read" → 重新 Read 再 Edit；**批量并行 Edit 可能吞掉主调用**（回执缺失）→ 执行后 grep 验证落盘。
- 验证批次开头要**记录当前模式/开合态**（reload 默认球面、面板开合持久化），否则断言全建在污染状态上。

## 交接纪律

1. 每次交付在"当前状态"追加一轮小节（≤15 行），并刷新在途/基线；**本文件 <150 行**，历史轮积 ~20 时整体剪到 `docs/history/HANDOFF_LOG_<日期>.md`。
2. 契约变更落 AGENTS（写日期+用户原话语义）；状态落 ROADMAP 系；交接只放轮次摘要与教训。
3. 交付说明 = 问题/原理/预期效果；整包交付；**不主动跑测试**；显示不打折；先根因后表现。

## 下一轮候选

- **默认下一包 = 三小包③ as-unknown 收敛（25 处/11 文件）**；或用户点名历史面板/功能包/5-c 剩余。
- 用户点名才动：功能包（比例尺/指南针/测量/搜索跳转/历史面板）；待复核：海陆案 A（产品级删层）、**全新父子层级系统设计 `docs/HIERARCHY_DESIGN_2026-10-02.md`（2026-10-02 交付，D1–D8 待拍板，吸收生成引擎包）**、专属色数据层清理。
