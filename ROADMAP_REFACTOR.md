# Mapedi 还债路线与已知问题（滚动状态）

> 定位：**行动清单**——做什么、验收标准、当前状态。证据（file:line、失败模式分析）全部在
> `docs/ARCH_REVIEW_2026-09-29.md`，两份文档配套使用：本文件是"待办"，评审是"依据"。
> 状态标记：`☐ 未动` · `◐ 进行中` · `✓ 完成` · `✗ 已否决/不做`
> 更新纪律：状态变了就改这里；证据细节别抄过来（会与评审漂移），指过去即可。

---

## 一、还债七步（按序，每步一个可独立验收的整包）

依据：评审 §6。原则 = AGENTS §6 整包交付；**步骤 1 是后续一切（含未来叙事编辑器第 0 包）的地基**。

### ◐ 1. 变更纪律闭环（P0）——1-a ✓（`3b43698`）、1-b ✓（`4492ba4`→`43ff5d1`→第十八轮）、1-c ✓（第十九轮），2026-10-01

- **内容**：① 修 undo 腐蚀——**✓ 1-a**：笔画快照-diff 多元素补丁（`MultiRegionCommand`）；② 高频直改命令化——**✓ 1-b 已全覆盖**：显隐（3 树连动整批）、样式、建层、保存信息（改名/描述/颜色）、外交三操作（`RegionFields/LayersVisibility/LayerStyle/AddLayer` 四纯数据命令 + `patchRegions` 快照执行器）、顺序（`moveItemStep`）、**路径域（`43ff5d1`）**——`withPaths` 快照执行器 + 控制点拖动会话（begin/commit，一次手势一条命令）+ `PathsCommand`（apply/revert 手动平面拷贝）覆盖 Viewport 六处与 store 五处（**坑：path.points 经 $state 深代理，structuredClone 必炸** → 手动平面拷贝 + `dispatchSave` 规范化重试）、**复制·删除·拖拽死码（第十八轮）**——`copyItem` 层支 `AddLayerCommand`/元素支 `CreateRegionCommand(at)`、`deleteItem` 层支 `DeleteLayerCommand`（ctor 快照层定义+regions+renderCfg，revert 全量恢复）、`dragLayer/dragRegion`/DropHint/`onMoveLayer` 死码删除（十轮拖动退役后零调用）；**判定残余（不阻塞 1-b 收口）**：climate/astro 无 UI 写入口=孤儿归步骤 7 大扫除、道路端点 `endpointOverrides` 属 region 域（独立于 paths，随 1-c 收口核对）；③ 命令纯数据化——**✓ 1-c（第十九轮）**：`PatchRegionsCommand`（死码，store.patchRegions 已用 RegionFieldsCommand）物理删除；`HeightStrokeCommand`（afterApply/afterRevert 闭包）合并入纯数据 `HeightCellsCommand`——**副作用改 store `historyEffect(cmd, dir)` 按命令类型分发**（`History.undo/redo` 返回被执命令或 null；高度笔画必须走 flushHeightRegions：区间/landsea 归属是派生数据，不重算=归属过期）；history.ts 闭包清零、grep 全库无残余。
- **验收**：每类编辑撤销后 world 与改前**逐位一致**（"输出逐位不变法"）；命令可 JSON round-trip；grep 无绕过 history 的 `world.` 直改（生成/导入除外）。1-a/1-b 已验（浏览器干净复测：撤笔画还原/显隐三态/改名列表回滚/建层消失/路径拖点撤销还原、**第十八轮：元素复制 9→8 撤销、图层复制 15→16→15、建层→右键删除→Ctrl+Z 恢复 15→16→15→16，零 error overlay**）。**1-c 已验（第十九轮）**：高度笔画画→Ctrl+Z→Ctrl+Y——cell 高度/海陆旗/区域成员**逐位回滚**（hD/oD/rD=0）、重做全 0、常规建层撤销 15→16→15→16 回归零错误；**stash A/B 证新旧码数字逐位相同**（行为保持）。**两注（诚实边界）**：① JSON round-trip 残余=快照类命令（删除/吞并/多元素）载荷含 Set/Map，编解码在历史面板需要持久化时补（面板会话内只读 label+跳转不需要）；② ~~continentId 标签漂移~~**已随海陆案 A 消解**（2026-10-03 字段整体退役，域外零读者）；region 数组序漂移仍在（分区等价、真值 Region.cells 精确）。

### ✓ 2. GL 恢复路径（P0，单点故障）——2026-10-01 完成

- **内容（已全部落地）**：① renderer `webglcontextlost`（preventDefault + `dead` 标记区分瞬态/致命）+ Viewport 挂 lost/restored 监听**主动 requestRender**（命令式渲染下恢复后无触发 = 画面停到下次交互的坑）；② `ensureMapGl` 分类：上下文丢失=瞬态提示不计失败、活着但实例 failed=2s 冷却重建、连续 3 次失败=致命提示（仍 5s 低频自试）、创建成功即复位；③ `map2d` GL 缺席时铺底色 + **2D 余量层（路径/标注/图框）照画**（cellsLayer 已是空桩，不复活 Canvas2D 地图后端）；④ 双提示条（致命/恢复中）。
- **验收（`WEBGL_lose_context` 实测）**：事件间谍 `["lost","restored"]` 送达；丢失期「恢复中」提示即时出现、rest 管线持续绘制（24→28）、像素 98.5% 切后备底色；恢复后 **diffPrePost=0 像素级自愈**、gpu 恢复自增、提示消失；空闲对照 diff=0。
- **测试坑（记入方法论）**：上下文丢失后 `getExtension` 返回 null——**restoreContext 句柄必须在 loseContext 之前保存**，否则恢复调不出（曾把自己页面卡在丢失态）。

### ✓ 3. 存档链路硬化（P0）——2026-10-01 完成

- **内容（已落地）**：① `deserializeWorld` 结构断言——cell.id 连续性 / polygon≥3 / neighbors 越界 / region.cells 引用越界，全部**明确中文报错**（throw → tryRestore/runWorker 捕获 → 启动错误条，不进渲染；autosave 只写成功序列化的结果，旧档不被覆盖）；② **autosave 挪 Worker**（`persist/saveWorker.ts`：world 结构化克隆 → serialize+idb 全程离主线程；busy/latest-wins 排队；`saveDrain` 供 clearAutosave 等在途；Worker 不可用/DataCloneError → 旧同步链降级 + 可见提示）。
- **验收（浏览器实测）**：坏档四项断言全中（id 连续性/邻居越界/region 引用越界均抛明确信息、好档零误杀）；保存后「已存 HH:MM:SS」正常刷新、无降级/失败提示；**主线程 longtask 峰值 250-330ms/次**（原 2s 级 = Worker 首建一次性；stringify+idb 已离线程）。**残余（诚实记录）**：`postMessage(world)` 的结构化克隆仍在主线程 ~250ms——要归零需世界数据列式化/转移缓冲，另立项。

### ✓ 4. cellClimate / biome 真相归位（P0）——2026-10-01 完成（A 案）

- **内容（A 案落地：真缓存 = 不落盘 + 按需重算）**：① `serializeWorld` 删 `cellClimate`/`biome` 两字段、`deserializeWorld` 不再读（legacy 档旧字段自然被忽略、下次保存消失）；types.ts 契约注释改为「运行时真缓存，不落盘，ensure 入口 + heightRev 失效」；② `rev.ts` 增 `heightRev()`（原只有 bump 无 getter）；③ `climate.ensureClimate(world)`——缓存缺席或 `computedAtRev !== heightRev()` 才 `computeClimate`（`computeClimate` 自身刷新戳，直调方 applyNature/测试同受管）；④ `biomes` 拆分：`computeBiomes`（纯分类写 world.biome，不碰 Region）/`generateBiomes`（=computeBiomes+syncEnvironmentRegions，签名行为不变）/`ensureBiome`（ensureClimate→戳落后即 computeBiomes）；⑤ 两处消费接入：`generateRoads` 入口 `ensureBiome`（森林/沙漠/山地代价按当前地形）、`exportGeoJson` 入口 `ensureBiome`（导出 biome 不再恒 null）。**读方批量前调一次，禁逐 cell 循环内调**（写进两处 doc 注释）。
- **背景（评审 §1.3 的实况比评审更空**：现行生成管线（unifiedGenerate）根本不产 cellClimate/biome——活世界两字段恒空，只有孤儿 applyNature 会算；消费者全靠 `?.`/fallback 静默降级。归位后语义统一：想读就 ensure，永不过期、永不落盘。
- **验收（浏览器实测）**：① 三态语义——cell#1 `mountain/-37.4°C` → 真实笔画画 -10（海）→ ensure 重算 `ocean/2°C` → Ctrl+Z → ensure 回 `mountain/-37.4°C` **精确基线**（撤销失效路径 ✓）；② 缓存机制——首算 115ms / 命中 0ms / 高度变更后重算 111ms 且 `sameMap=false`；③ `serializeWorld` 顶层无 `cellClimate`/`biome`（`climate` 参数保留）；④ legacy 档注入两旧字段 → deserialize 不炸、字段被忽略、世界完整；⑤ `generateRoads` 清空两缓存后直调 → 入口自回填（207ms）零错误；tsc/svelte-check 0。
- **边界（诚实记录）**：① 仅改河流不翻 heightRev（partial river regen 当前 UI 不可达）→ 降水河邻加湿沿用旧值 ±0.15；② biome 依赖的气候参数变更走 applyNature 直算（同步刷新戳）；③ 生产 world 的 `computeBiomes` 覆盖全部 100k cell，`Map.get` 恒有值，`?? null` 仅为类型收窄。

### ◐ 5. store / Viewport 拆分（P1）——5-a ✓（第二十一轮），其余子包待续

> 范围大 → 按 AGENTS §6 拆子包整包交付；原「六模块」总目标不变，子包划分如下。

- **✓ 5-a 失效管线与队列出库（2026-10-01 第二十一轮）**：
  - **`app/changePipeline.ts`（新）**：touch* 家族（World/Regions/View/RegionsIncremental/LayerView/Height/Paint）+ 高度派生 flush（markHeightDirty/flushHeightRegions）+ 高度脏状态整体出库（183 行）——只管失效/派生/换身份，持久化与 UI 经 `PipelineCtx` 注入（`$state` 写入留在 store 文件内的 ctx 闭包）；store 保留同名薄门面，**全部调用点零改动**；顺带删死字段 `heightNotifyQueued`。
  - **`render/patchQueues.ts`（新）**：三队列（pieceInvalidations/heightDeltas/piecePatches）+ 同键 Δ 合成从 store 私有字段抽为模块单例（rev.ts 同款先例）；**Viewport 的 3 处 `editor.consume*` 改直接模块导入 = 渲染不再反向 import store 私有队列**（验收项 ✓）；store 1749 定向失效改 `queuePieceInvalidation`。
  - **三失联清账**：`canPaint` 死 prop 物理删（prop+类型+5 处 `(drawActive || canPaint)`，App 从未传入）；`panningMode` 死成员 `'cam'` 删（只赋过 `'content'/null`）；`onpaint` 丢参**已在第十四轮速修包修复**（本项闭合）。
  - **验收（浏览器实测）**：显隐切换经新管线（👁→🚫 翻转+撤销回弹、零 console 错）；高度笔画画 -10→撤销回 61；**队列 E2E**：commit 同步窥探 deltas=8/patches=3（入列）→ 让帧后队列排空（渲染经模块消费）→ 撤销正常；tsc/svelte-check 0；store 2045→1900 行。
- **✓ 5-b1 Persistence（自动保存机械出库，2026-10-01 第二十二轮）**：`app/autosaveService.ts`（新，~140 行）——2s 防抖+epoch 作废+Worker 派发（busy/latest-wins）+DataCloneError 规范化重试+同步降级链+drain 等待器整体出库；Ctx 注入 world/snapPaths/autosaveAt/status（`$state` 写仍在 store 闭包）；store 留 `scheduleAutosave()` 门面 + `replaceWorld/clearAutosave` 走 `invalidate()/drainQueue()/drain()`。**验收（浏览器实测）**：显隐触碰→2s 防抖→Worker→回显 3:51:36→3:51:59；IDB 实读 at 新鲜/cells 100000/regions 162 **且无 cellClimate/biome**（步骤4 不落盘回归 ✓）；撤销复原零错。**注**：clearAutosave 未实跑（删用户存档=破坏性），机械移植+tsc 兑底。
- **✓ 5-b2 GenerationService（生成编排出库，2026-10-01 第二十三轮）**：`app/generationService.ts`（新 239 行）——整链 Worker（失败回主线程）/单层再生成/profiles·worldShape·预设·开关全量出库；Cts={world/seq/nextSeq/replaceWorld/profiles/status/focus/…}，**世代序 `generationSeq` 模块化**（与 tryRestore/import 共享的换世界互斥闸）；store 留六门面（generate/regenLayer/setProfileParam/worldShape/applyGenPreset/toggleProfile）调用点零改动。**顺带修预存静默缺陷**：`profileParams` 直传 `ui.profiles` 的 $state 深代理 → Worker `postMessage` 必抛 DataCloneError → 生成**一直**无声回退主线程（旧 catch 吞错；本轮加 console.warn 才暴露）——修=params 平面化 `{...p.params}`，修后实测「100000 地块 · Worker」11.2s 零 warn。**验收**：参数三件（toggle/setProfileParam/预设）快照-还原逐位一致；生成 3k Worker 路径 status「地块 · Worker」；regenLayer 状态回显；tsc/svelte-check 0。**⚠ 事故与恢复（诚实记录）**：真点生成的 invalidate 保护法**失手**——测试 3k 世界写进了 autosave（唯一键）覆盖用户 100k 旧档（恢复法见记忆：IDB 快照法才是硬保护）；已用默认参数重新生成 100k（seed=页面草稿种子）落盘恢复，用户旧档的逐位还原不可能（原世界为生成态，种子未留档）。
- **✓ 5-b3 相机运算出库（2026-10-01 第二十四轮）**：勘察结论=**MapTransform 原语早已成形**（`render/space.ts`/`render/map2d.ts`），本轮抽 `ui/planeCamera.ts`（145 行纯函数）：`zoomCamAt`（锚点缩放）/`panCam`/`contentPanDeltaX`/`bestDrawDxFor`（可见副本挑选）/`revealCamTarget`（C7 遮挡反解）/`startCamTween`（180ms easeOut 补间）——手势监听与绘制状态机留 Viewport（事件边界不动）。**验收（浏览器实测）**：缩放 ratio=1.331=1.1³、**锚点世界点误差 1.6e-16**；右键内容平移 +0.563、中键相机 dx=-80/319、dy=+40/319 精确；C7 露出端到端=元素拖至 sx137（轨下）→点行→补间 camDx=-2.059→sx794 入可见区、仅越界轴修正（dy=0）；tsc/svelte-check 0。**环境坑**：失焦页 rAF 冻结（0 帧）→ 补间不跑——**连拍截图泵 BeginFrame 即恢复**（4s/54 帧），以泵帧法验通。
- **✓ 5-b4 DrawController（绘制会话出库，2026-10-01 第二十六轮）**：`app/drawController.ts`（400 行）——会话启停（成员/高度/道路）、笔刷命中、笔画快照-diff 入栈（undo 腐蚀采集端）、洪水填充/设中心/道路端点路段全量出库；状态（paintDirty/strokeSnap/高度样本/区间选择）随类迁移，选中/状态/失效族经 Ctx 注入；store 六段 facade 调用点零改动（1686→1462）。**验收**：高度三态=画 17/17/4 → 撤销全 0 → 重做全 0（stack0=0 干净栈）；成员笔画=无主地 +17 收编 → 撤销**被画子层精确还原 du=0**/depth=0；drawGuard「行省已隐藏」正常；tsc/svelte-check 0。
- **✓ 5-b5 CommandService（命令 CRUD 出库，2026-10-01 第二十七轮）**：`app/commandService.ts`（814 行，**方法体自 store 原样搬运**——`this.*` 经类内代理映射 Ctx，零改写）：undo/redo+类型分发、删除/复制/吞并、图层树缩进·提升·移序、样式·显隐·透明度、路径快照执行器+拖动会话、字段快照执行器、新建·重命名·换色；选中类（selectLayerTop/clearLayerSelection/focusLayerForDraw）留 store（App 直连）。store **888 行**（日初 2045）。**验收（浏览器八组门面回归）**：建层/元素复制/删除层/缩进提升/显隐/样式（border.width 0.8→4.2→0.8）/withPaths/patchRegions 全部经 facade 生效且撤销回滚、栈归零、IDB 15 层清净、零 console 错。**教训**：undo 换 world 身份后**数组长度断言读旧引用=假阴**——对象字段级断言+栈计数+IDB 实读才是可信口径。孤儿 import 29 项清理；tsc/svelte-check 0。
- **✓ 5-c App 转发器瘦身（2026-10-03 全量收口，`716e03f`；步骤 5 至此全清）**：
  - **审计**：双向比对=真实 on* 赋值 **39 个、零死转发**（canPaint/onMoveLayer 类已在前轮清完）。
  - **✓ 首批（不碰 shell prop 面）**：① Viewport 四个纯 editor 转发下沉（onpaint/onradius/onendpoint/onstrokeend → 组件内直调 editor——该组件本就直连 store，路径编辑同先例），App 的 Viewport 标签 6 props→2；② `organize` 业务规则（图层 up=-1/元素 up=+1 映射）下沉 CommandService.organize+门面，App 删 9 行函数；③ 死 CSS `.gen-pending` 删除。App 532→**509**、Viewport 1437→1423。
  - **验收（浏览器）**：真指针笔画 down→move→up（走下沉 paint/commitStroke 链）61→撤销精确回 10、栈 1；alt+滚轮半径 1.5→1.65（下沉 onradius）；organize('indent') parentLayerId 翻转+撤销回弹；tsc/svelte-check 0、零 console 错。
  - **✓ shell 面全量下沉（2026-10-03，`716e03f`）**：24 项纯转发改组件直连 editor（TopBar rename/clearCache、LeftRail undo/redo、GenerateSection shape/regen/param、LayersPanel 七项、WorkspaceDrawer 十项含 selectElement 整体下沉 store）+2 个零调用死 prop 删除；App 只余真数据流（style/projection/globe/railState）与编排（export/import/generate 后 switchView）。验收=冒烟（高度区间选中/空白收起/撤销钮）+ tsc/svelte-check 0。
- **验收（总）**：各模块独立可测；App 不再是回调转发器；渲染不反向 import store。

### ◐ 6. 热路径与缓存保险（P1）——2026-10-01 核心三项落地，两项缓发

- **✓ 已落地**：① `RegionIndex worldKey` → O(1)（原每次 ensure 扫全部 region.cells+拼串，拾取/悬停按帧调用=O(100k)/次 → 改 `regionsRev():长度:长度`，rev 在全部 touch* 同点 bump）；② `buildPieceParams` 每帧分配清零（regionById Map/seenFill/seenBound 跨帧 clear+复用——同步不可重入已论证，out 数组刻意保持新分配防跨帧持有）；③ decorationsLayer 每层 `regions.filter` + cellMarker `flatMap+Set` → **dataRev 键控惰性缓存**（每次编辑只重建可见层，帧内零分配）。
- **验收**：**同状态 stash A/B（旧码 vs 新码、零交互默认态）最终 diff=0.0%**（首次 7.1% = 渐现时序，3s 后完全收敛）；帧 p50 9.7ms 无回归；tsc/svelte-check 0。
- **缓发三项结案（2026-10-04 用户批「做」后复核）**：
  - ④ **✓ 完成 `7eb3775`**：副本可见性双尺合一——`space.copyOffRange/copyIntersectsBox` 单一原语，worldCopyKs（世界级）与 mapRenderer 件级过滤（原 copyVisibleIn/offRangeOf 内联删）同函数；稳定帧法 stash A/B=默认态/平移态跨码均0.0%（「历史 bug 旋涡」由统一+对拍双保险收口）。
  - ⑤ **维持原裁决（红线）**：键补 regionsRev 会把件环 Δ 补丁作废成全量重算，与「不删缓存、补丁即机制」冲突——正确形态=运行时一致性断言，随翻转探针包立项（不单独实施被否方案）。
  - ⑥ flip 探针降级 debug 断言：同捆翻转探针包（可选项）。

### ✓ 7. 大扫除（P2）——三小包全清收口——2026-10-01 第二十九轮：死码/孤儿/两修复全清，三项存量转独立小包

- **✓ 死代码七项清账**（逐项按当日现状复核，非照抄评审行号）：
  - `cellIndex.ts` **整文件删除**——索引机器（CellIndex/getCellIndex）零读者，仅剩的 invalidate 无读者=无效失效 → 连 store/changePipeline 的调用一并删；
  - `rebuildNeighborsFromSharedVerts` 零调用 ✓ 删；`NamePlacement`+`Region.nameStyle` 随 cellIndex 死亡链 ✓ 删；`cellsLayer` 空桩（draw=空 pass）出 **Viewport pathPipeline 与 defaultPipeline 双管线** ✓ 删；
  - `centerLabel` 判**活**（validate.ts 消费）保留；`PathFeature.name` 判**活**（路径行展示）保留；`Viewport 旧注释`随重构漂移无存 ✓。
- **✓ 孤儿判定与删除（外部零调用实证）**：store 链 `applyNature/regenPolitical/regenNetworks/applyHeightmap/measureClick`、CommandService `renameSelected/recolorSelected`、DrawController `roadBreaks`、GenerationService `applyGenPreset/toggleProfile`（presets 无 UI 入口）全删；**`core/nature.ts` 整文件删**（应用零引用，测试手术随行）；biomes 瘦身至活核 83 行（删 generateBiomes/syncEnvironmentRegions/BIOME_META/biomeAt/environmentRegions/sampleBiomeSeed）；测试=climate.test 删 nature 两案、networks/perf 夹具 `generateBiomes→computeBiomes`；`SOFT_MAX_DENSITY` 死导出删；store 孤儿 import 清（**888→803**）。
- **✓ 两修复**：
  - **路网清空先于早退**（已知问题）：generateRoads/generateRoutes 改**校验先于清空**——合成探针双分支实测 verdict=true（早退保留既有路网 / 正常重建照常清空）；
  - **撤销后父层残留**（5-b4 发现的预存缺口）：CommandService undo/redo 补 `materializeParentCells`，且物化实现由「从父现有并=**只加不减**」改为**精确派生（父≡∪子，AGENTS §3 字面语义）**——实测 7 对父子中 6 对恒等、唯一 extra 全为历史残留本身 → 改后**自愈**（extraNow=[]）+ 撤销逐位还原（unrestored=[]）、深度 0、零错。
- **✓ 三小包①容差集中（2026-10-01 第三十轮）**：`core/tolerances.ts` 单源——KEY_QUANT(1e-3 键量化)/WRAP_EPS/PROJ_WRAP_EPS（**已统一千分之一**：`2aa988a` 拍板①，projCache 顶点网格同改 KEY_QUANT）/GEOM_EPS(1e-12 判等·近零)/EPS_FP(1e-9)/SCALE_FLOOR/MIN_RATIO/MIN_SEG/DEDUP_EPS/SPHERE_MIN；**17 文件原值迁移、零数值改动**；裸字面量收敛（1e-12 全清、cam.scale 下限族全清、键量化×1000 全清）；一次性孤值（1e-8/1e-10/1e-15）与 GLSL 内字面量留原地（模块头注明）。
- **✓ 三小包② 图层名标志位（2026-10-02 第三十一轮）**：**LayerDef 三标志**（`genStrategy: 'scatter'|'heightmap'|'elements'` 缺省 elements / `focusAfterGen` / `editsHeight`）+ `ensureBuiltinLayers` 旧档回填；读取单源 `core/layer/flags.ts`，消费点禁比 id 字符串。**landsea 身份收进 landSea 模块选择器**（landSeaLayerRegions/landSeaContinentRegions/isLandSeaLayer——非标志位，模块本职）；`isFreeLayerId` kind 版 lookup 收编 Viewport/WD/DisplayNamePanel 三处 id 三连比较。迁移 ~35 处（生成三分支/生成后聚焦/worldShape/showCellMesh/高度域 UI/flush diff/大陆中心/手动分割/默认焦点回落/建层路径分支）；死码 genLabel/isPath 删；opacity 过时注释修。**判定保留**：模块本域 id（political/heightElements/landSea 内部）、SVG 导出描边（storage 注释）、`__height__` 协议。**行为零变化**；tsc/svelte-check 0；浏览器=旧档回填读证+三分支面板+height regen focusAfterGen+球面往返零错。**未跑测试**（纪律）。
- **✓ 三小包③ `as unknown` 收敛（2026-10-03 第三十四轮）**：src 域 **25→0（grep 归零）**，六模式——缓存键定型（WeakMap 键改 MidRing[]/DisplayRing/ProjCache）、`DisplayRing extends MidRing` 协变直删桥接强转、RegionIndex 增 `reset()`、globalThis 性能钩子集中声明 `render/perfHooks.ts`（declare global 只给类型，裸名赋值 ReferenceError 已踩 → 消费点一律 `globalThis.__x`）、paths 迁移显式构造、worker 双文件 reference-lib 化；**tests 域余 2 处**（造 World/Canvas mock 夹具，保留）。**三小包全清。**
- **验收达成部分**：grep 死码零残留 ✓；npm check 0 errors ✓（tsc/svelte-check 绿）。三项存量按拆包纪律各自立项。

---

## 二、性能观察项（不提前优化）

沿袭 ROADMAP 原记录（评审 P1-8 的对应项）：

| 项 | 状态 | 说明 |
|---|---|---|
| GPU 直绘提交 | ✓ 非瓶颈 | GL 提交 0.2ms/帧；件数/环复杂度增 10× 再看 |
| 拖动/绘制卡顿 | ✓ 包 1-4 落地 | 剩余 = 缩放动画（依赖 GPU）；红线：零瞬态折扣 |
| 100k 生成链 | ✓ 4.8-6.9s | 可选：getProjCache 首建 Worker 化 |
| autosave 主线程 stringify | ✓ 步骤 3 落地 | stringify+idb 已离线程；残余=clone ~250ms/次（列式化另立项） |
| 每帧 O(n) 分配 | ☐ 见还债步骤 6 | layers.ts 三处 + compose 单槽冲刷 |

---

## 三、已知问题登记（观察 / 已接受）

| 问题 | 位置 | 状态 |
|---|---|---|
| 撤销后**父层物化残留**：父 cells=子并集（materializeParentCells），undo 只 touchWorld 不重新物化 → 子已回滚、父多出的 cells 残留到下一次 touchRegions（5-b4 终证实测 +16 残留；预存类，与 undo 只 touchWorld 的老路径同构） | store.undo/物化管线（第十六轮 A/B 未做，代码同构推定预存） | 观察：修法=undo 后补物化或并入 touchWorld（注意频率成本），随 1-c 深化/历史面板包 |
| `generateRoads` 先清空 road 区域再生成，首都不在同一陆块时 `pathBetween` 全 skip → **路网归零且无法可复**（路径层 UI 再生成=禁用待设计） | `core/generate/networks.ts`（步骤 4 验收探针直调实测：1→0；与 ensure 无关——biome 只做正系数代价缩放不碰连通闸） | 观察：归路径层再生成设计包 |
| 高度笔画撤销后 `continentId` 标签 + region 数组序漂移（分区等价、真值 Region.cells 逐位精确；笔画期间也重排） | heightRegions/landSea 派生管线（第十九轮 A/B 证**预存**，非 1-c 引入） | 观察：派生标签非真相，用户可见性待查（叠放若受影响再修=重建后稳定序） |
| 缩放重烘焙顿挫 ~100ms | — | 暂接受（归卡顿包 2） |
| 球面元素填充 = cell 贴角三角扇，非 Hermite evenodd | GlobeView | 已知余量；球面中点 Hermite 填充为独立包 |
| 球面无标签/悬停 | GlobeView | 待做 |
| gk 投影 unproject 是坏的（死代码残骸） | `projections.ts` | ✓（2026-10-01：前向本身 2 对 1 折叠 → 整体替换为「墨卡托·中经」x=Δλ/y=atanh(sinφ)，注入+闭式逆解 roundtrip 1e-14；UI 下拉实际只暴露 mercator/robinson，gk 属防护性修复） |
| autosave 靠 `void w.cells.length` 触发，纯改高度/颜色不触发 | `App.svelte` | ✓（2026-10-01：`scheduleAutosave` 集中进 touch* 家族——touchWorld/touchRegions/touchRegionsIncremental/touchHeight/touchLayerView/touchPaint，2s 防抖无重复成本；加载即存已实测） |
| 球面视图下补丁队列无人消费、无限增长 | `Viewport` 消费端 | ✓（2026-10-01：入列侧根治——piecePatch/heightDelta 同键 Δ 合成（键数=上界）、pieceInvalidations 去重；合成语义经「串行应用 ≡ 合并应用」断言） |
| `dragPathIdx` 用位置索引，undo 后错指 | `Viewport:1002/1019` | 待修（随步骤 1 命令化） |
| 提示文案"右键擦除"与实际行为矛盾（右键=内容平移） | store/Viewport/App | ✓（2026-10-01：A′「画布右键=纯位移」定案 → 擦除手势=**Shift+左键**；三层同修：paintHeight 路由接受 shift、App `onpaint` 补 alt/button 丢参、状态文案更新；浏览器实测 cell 62→0） |
| GL scissor 与 evenodd 遮罩 1px 缝 | `mapRenderer:302` | 观察 |
| 检查区展示值不随数据刷新（`$state.raw` 无深代理 → 模板直读可变属性/同引用派生截断失效） | `InspectSection` | ✓（2026-10-01：全部展示值收敛 `view` 快照，`rev+world` 键控输出新对象；眼睛标签三态实测跟随；**教训：raw 状态下新增展示字段必须进 view，禁模板直读可变属性**） |
| 同类 stale 潜力点（DisplayStylePanel 内部直读 style 对象的模板、其余组件同模式） | 各组件 | 观察（按 view 快照模式逐步收编） |
| Robinson 双周期语义并存（自洽但脆弱） | build/normalize | 观察 |
| 无 UI/渲染集成测试 | — | 已知盲区；测试盲区与 P0 风险区重合 |

---

## 四、已否决 / 不做（防止反复重提）

- ✗ **阴影功能**：永不做，代码已物理删除（2026-09-28 用户定，详见 `docs/_archive/canvas2d-shadow/`）。
- ✗ **Canvas2D 渲染后端**：已归档，GL 唯一后端；不恢复第二条管线。
- ✗ **per-cell 颜色图集**：撞显示契约（贴角填充），已回退（第三十八次）；重启须用户改契约。
- ✗ **穿极大陆参数**：已删（第五十六次），低纬倾向 latBias 取代。

---

## 五、变更决策记录（待拍板的架构级选项）

- **2026-10-04 用户决议批（8项）**：①精度统一千分之一 ✓`2aa988a` ②地图模式三按钮+投影动画=**维持现状** ③尸体数据（exclusiveColor+外交）**删** ✓`d0b3aa5` ④步骤6缓发=**做**（④✓`7eb3775`、⑤⑥按红线/同捆结案见上）⑤全量测试=**跑** ✓152绿 ⑥验收三件=**做** ✓（见待验收行）⑦路径生成 R7=**先不做** ⑧12条UI提案=**不要了**。

- **地图模式三按钮 + 投影动画**（墨卡托基准烘焙 + LUT 插值）：待用户拍板，见记忆与 HANDOFF 日志第五十九次前后讨论。
- **图集三选一**：已被 ✗（见上）。
- **全新父子层级系统设计（2026-10-02）**：`docs/HIERARCHY_DESIGN_2026-10-02.md` —— 层显示树/生成单元源/元素行政树三处真相收敛为**一片层森林 + 一片元素森林**（`parentLayerId` 单源、units=子层、桥不变量 I-bridge），并含焦点整段叠放修复、读时有效显隐、删除策略表、元素 UI 重设计（承接 2026-10-01「子元素先删之后重设计」原话）。**已拍（2026-10-03 用户委托全按推荐实施）并全部落地**：包1 层级内核 `c4ba324` → 包2 显示 `1980fdc` → 包3 生成 `268b307`（逐位哈希相等）→ 包4 元素 UI `b01c906`（子元素逐跳+手动挂靠）；读档修复/删除策略表/双路径清账（regionOps 溶解）齐。**吸收 GEN_UNIFIED_DESIGN §6 引擎包**（指针方向反转：genParent 改为从 parentLayerId 派生）。

## 六、UI 重构（设计定稿待实施）

- 设计规格：**`docs/UI_REFACTOR_2026-09-29.md`**（顶栏模式胶囊 / 左轨图层+工作区合并 / 信息弹窗入右键菜单 + portal 防截断 / 生成系统入工作区 / 面板全退役 / 状态栏分区）。
- 分期（**2026-09-30 修订，消除生成空窗**）：U1 顶栏底栏（视图面板全退役、项目面板只退役文件节、生成节暂留）→ U2 左轨合并 **+ 生成子面板（自 U3 提前）** + C1 契约 → U3 有效视口收尾；配套模式状态机、keymap、popover portal、UI 偏好持久化。
- 与还债步骤 5（store/Viewport 拆分）**不同包**（2026-09-30 用户拍板 B）：U1 纯 UI 重组独立验收，步骤 5 另起一包。U2 的生成**可撤销**仍依赖还债步骤 1（命令化）。
- D1-D6 已全部拍板（2026-09-29，见设计稿 §9）；D1′ 澄清：undo/redo 按钮**接现有 editor.undo/redo**（不接新能力）。D4 = B（ValidatorPanel 归档删除，规则与测试保留，还债步骤 1 后以自动校验 + toast 回归）。
- 结构层 C1-C9 二轮拍板（2026-09-29）+ **A-D′ 四项（2026-09-30）**：默认模式回球面、还债不同包、**画布右键=纯位移（仅面板行出菜单）**、undo/redo 接已有功能。
- **U1 开工前置已满足**（2026-09-30）：并发线（投影动画批1-3 / 模式切换）已落定，`git log`/`git status` 干净。
- **✓ U1 完成（2026-09-30，`3abf544` + 决策落档 `8dadfd1`）**：顶栏三件（模式胶囊/世界名菜单+双击改名含 `meta.name`/⚙视图设置）、状态栏三分区、双模式相机记忆、视图面板退役；浏览器验收过（改名存档往返、模式切换、导出 SVG、几何零重叠）。
- **✓ U2 完成（2026-09-30，`9b4868c` + `0ea7eed`）**：
  - 1/2 = 左轨合并（LeftRail：图层段 ≤45% 内滚 + 工作区段、⊟↔圆钮 localStorage 持久化）+ C1 契约（单击选中/双击绘制/画布反选/隐藏层红字守卫）+ 工具带（weight 删、fill/center 死值删、undo/redo 接现有 editor.undo/redo + Ctrl+Y）+ 元素过滤 + 悬停归属元素名可跳选；ValidatorPanel 按 D4=B 归档删除。
  - 2/2 = 信息入右键菜单卡片（锚点/点外/Esc 关闭）、PanelShell 去 backdrop-filter（菜单被裁根因）、生成入轨 GenerateSection（D5 长按 900ms 进度触发）、球面星球参数区 PlanetParams、**PanelDock 删除 → 常驻浮窗 = 0**。
  - **教训（svelte-check 抓不到）**：`.svelte` 里漏解构的 props **类型检查 0 错**但运行 `ReferenceError`——WorkspaceDrawer 漏 `lowFreq` 一度打断 effect 树、表现成「左轨不随模式切换」的假性响应失灵；排查时勿先怀疑响应性系统。
- **✓ U3 完成（2026-09-30，`04dcff1`+`e492241`）**：C7 有效视口（选中遮挡区 180ms easeOut 拉回；修 `viewportRoot` 未绑定、tween 漏 `requestRender` 两处根因）+ 生成段按层补全（非 height 层 params 类型化控件 + regenLayer、无配置层禁用、height 原样）+ 草稿持久化（mapedi.ui.gen 500ms 防抖）。浏览器端到端验证过（按层面板/草稿回读/遮挡判定+tween 帧数断言）。
- **✓ 四把手重排包（2026-09-30 第三轮需求，`6ceb132`）**：左栏=图层把手+绘制/生成/显示三把手（FoldHandle 单源）+列表；**生成三分支**（cells=重新撒点 / height=生成高度图+海陆删旧建新 / 普通 regen / 路径禁用）；⚙ 移模式胶囊右、视图面板 3d/2d 互斥、星球组迁回；搜索按钮化；紧凑统一。配套架构设计：**`docs/GEN_UNIFIED_DESIGN.md`**（genParent 单源/递归/CASCADE 推导——引擎包待过目）。
- **✓ 三模式双树包（2026-09-30 第四轮 E1-E5，`fc827ce`）**：**取代四把手结构**（需求演进非缺陷）——检查/生成/绘制 tab + 双树行级展开区 + C1 二修（推导式会话）+ 右键收敛（三 popover 退役）+ 平面编辑更名 + 球面锁。后续：**包2 新绘制语义（范围/自动扩展/笔刷类型）= 还债步骤 1 命令化后**；**包3 元素级生成 = 生成引擎包后**（GEN_UNIFIED_DESIGN §6）。
- **验收轮已执行（2026-10-04 批6）**：100k 主线程 scratch 基准=总7.96s（create5.92/cascade1.90/serialize0.14，UI 走 Worker 另测）；绘制会话=高度+成员笔画 commit→undo 逐位还原 ✓、帧 p50=1.1ms；**「长按生成」「liftDrag」两项标的已随三模式重构/拖动退役作废**（替代=非 height 层按钮生成 E2E ✓）；道路会话本世界 paths=0 不可达（校验早退原状，哈希证非回归）。~~引擎包~~已随 HIERARCHY 包3 落地；**海陆案 A ✓（`fc8664e`）**。
