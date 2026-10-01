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
- **验收**：每类编辑撤销后 world 与改前**逐位一致**（"输出逐位不变法"）；命令可 JSON round-trip；grep 无绕过 history 的 `world.` 直改（生成/导入除外）。1-a/1-b 已验（浏览器干净复测：撤笔画还原/显隐三态/改名列表回滚/建层消失/路径拖点撤销还原、**第十八轮：元素复制 9→8 撤销、图层复制 15→16→15、建层→右键删除→Ctrl+Z 恢复 15→16→15→16，零 error overlay**）。**1-c 已验（第十九轮）**：高度笔画画→Ctrl+Z→Ctrl+Y——cell 高度/海陆旗/区域成员**逐位回滚**（hD/oD/rD=0）、重做全 0、常规建层撤销 15→16→15→16 回归零错误；**stash A/B 证新旧码数字逐位相同**（行为保持）。**两注（诚实边界）**：① JSON round-trip 残余=快照类命令（删除/吞并/多元素）载荷含 Set/Map，编解码在历史面板需要持久化时补（面板会话内只读 label+跳转不需要）；② 高度笔画撤销后 `continentId` 标签与 region 数组序存在**预存漂移**（分区等价、真值 Region.cells 精确，A/B 证明非 1-c 引入）——已登记下方已知问题表。

### ✓ 2. GL 恢复路径（P0，单点故障）——2026-10-01 完成

- **内容（已全部落地）**：① renderer `webglcontextlost`（preventDefault + `dead` 标记区分瞬态/致命）+ Viewport 挂 lost/restored 监听**主动 requestRender**（命令式渲染下恢复后无触发 = 画面停到下次交互的坑）；② `ensureMapGl` 分类：上下文丢失=瞬态提示不计失败、活着但实例 failed=2s 冷却重建、连续 3 次失败=致命提示（仍 5s 低频自试）、创建成功即复位；③ `map2d` GL 缺席时铺底色 + **2D 余量层（路径/标注/图框）照画**（cellsLayer 已是空桩，不复活 Canvas2D 地图后端）；④ 双提示条（致命/恢复中）。
- **验收（`WEBGL_lose_context` 实测）**：事件间谍 `["lost","restored"]` 送达；丢失期「恢复中」提示即时出现、rest 管线持续绘制（24→28）、像素 98.5% 切后备底色；恢复后 **diffPrePost=0 像素级自愈**、gpu 恢复自增、提示消失；空闲对照 diff=0。
- **测试坑（记入方法论）**：上下文丢失后 `getExtension` 返回 null——**restoreContext 句柄必须在 loseContext 之前保存**，否则恢复调不出（曾把自己页面卡在丢失态）。

### ✓ 3. 存档链路硬化（P0）——2026-10-01 完成

- **内容（已落地）**：① `deserializeWorld` 结构断言——cell.id 连续性 / polygon≥3 / neighbors 越界 / region.cells 引用越界，全部**明确中文报错**（throw → tryRestore/runWorker 捕获 → 启动错误条，不进渲染；autosave 只写成功序列化的结果，旧档不被覆盖）；② **autosave 挪 Worker**（`persist/saveWorker.ts`：world 结构化克隆 → serialize+idb 全程离主线程；busy/latest-wins 排队；`saveDrain` 供 clearAutosave 等在途；Worker 不可用/DataCloneError → 旧同步链降级 + 可见提示）。
- **验收（浏览器实测）**：坏档四项断言全中（id 连续性/邻居越界/region 引用越界均抛明确信息、好档零误杀）；保存后「已存 HH:MM:SS」正常刷新、无降级/失败提示；**主线程 longtask 峰值 250-330ms/次**（原 2s 级 = Worker 首建一次性；stringify+idb 已离线程）。**残余（诚实记录）**：`postMessage(world)` 的结构化克隆仍在主线程 ~250ms——要归零需世界数据列式化/转移缓冲，另立项。

### ☐ 4. cellClimate / biome 真相归位（P0）

- **内容**：二选一——(A) 真缓存：序列化不存、加载后按需重算（与 `types.ts:193` 注释声明一致，倾向此案）；(B) 承认真相：改契约，高度变更纳入 touch 失效管线。
- **验收**：改高度后群系/气候不再静默过期；存档中该字段的行为与文档一致。

### ☐ 5. store / Viewport 拆分（P1）

- **内容**：按六模块边界分包——UIState / ChangePipeline（touch*+consume*，最先拆）/ CommandService / GenerationService / Persistence / DrawController；抽 `MapTransform` / `ViewportController`；顺手修三处失联（`canPaint` 死 prop、`onpaint` 丢参致右键擦除不可达、`panningMode:'cam'` 死分支）。
- **验收**：各模块独立可测；App 不再是 ~60 回调的转发器；渲染不再反向 import store 私有队列。
- **依赖**：建议在步骤 1 之后（命令化减少拆分时的行为风险）。

### ◐ 6. 热路径与缓存保险（P1）——2026-10-01 核心三项落地，两项缓发

- **✓ 已落地**：① `RegionIndex worldKey` → O(1)（原每次 ensure 扫全部 region.cells+拼串，拾取/悬停按帧调用=O(100k)/次 → 改 `regionsRev():长度:长度`，rev 在全部 touch* 同点 bump）；② `buildPieceParams` 每帧分配清零（regionById Map/seenFill/seenBound 跨帧 clear+复用——同步不可重入已论证，out 数组刻意保持新分配防跨帧持有）；③ decorationsLayer 每层 `regions.filter` + cellMarker `flatMap+Set` → **dataRev 键控惰性缓存**（每次编辑只重建可见层，帧内零分配）。
- **验收**：**同状态 stash A/B（旧码 vs 新码、零交互默认态）最终 diff=0.0%**（首次 7.1% = 渐现时序，3s 后完全收敛）；帧 p50 9.7ms 无回归；tsc/svelte-check 0。
- **✗ 缓发（含理由）**：④ 世界副本数 GL/2D 统一——副本机制是历史 bug 旋涡（硬教训1），合并需全量副本回归另立包；⑤ borderCache 键补 regionsRev——与「件环不删缓存、Δ 补丁即机制」红线冲突（键上加 rev 会把补丁作废成全量重算），运行时断言随翻转探针包一起做；⑥ flip 探针降级 debug 断言（可选项，随定向包）。

### ☐ 7. 大扫除（P2，随时可做，建议搭车）

- **内容**：死代码七项（`cellIndex.ts`、`rebuildNeighborsFromSharedVerts`、`NamePlacement`/`nameStyle`、`PathFeature.name` 展示或删、`cellsLayer`、`centerLabel` 双写、`Viewport:777` 旧注释）；容差集中为 `tolerances` 模块（三套量化精度并存）；违契图层名特判（`'cells'`/`'landsea'`/`isFreeLayer`）；`as unknown` 封装破洞收敛。
- **验收**：grep 零残留；`npm run check` 0 errors。

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

- **地图模式三按钮 + 投影动画**（墨卡托基准烘焙 + LUT 插值）：待用户拍板，见记忆与 HANDOFF 日志第五十九次前后讨论。
- **图集三选一**：已被 ✗（见上）。

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
- **待验收**：100k 性能回归、非 height 层长按生成、liftDrag/绘制会话全量回归（用户验收轮）；引擎包/海陆案 A 待拍板（设计稿 §6/§7）。
