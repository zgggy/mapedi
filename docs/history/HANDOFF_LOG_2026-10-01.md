# HANDOFF 历史归档（2026-10-01 剪出）

> 从 HANDOFF.md 按交接纪律剪出（轮次积压）；**冻结，禁止当实现依据**——现行状态看 HANDOFF.md。

## 第十一轮需求（2026-09-30 用户原话规格，**已交付**——见「当前状态」）

用户九点：① 缩进无视觉效果→button 内最左侧短竖线 ② 缩进/提升顺序乱（未变成上一个图层的子图层）③ 元素面板无缩进/提升两钮 ④ 展开后为空→直接不能展开 ⑤ ul 与 panel 左右间距再小 ⑥ 图层/元素列表不能滚动（连续三轮）⑦ 结构定稿（创建行文本框兼搜索+🎲+加，拉满同 button 宽；两面板同构；独立搜索行退役）⑧ 任何模式 button 上无操作控件，滑块只在高度元素展开内容 ⑨ （隐含）检查/绘制模式展开各含一个高度滑块。

- **✓ 1-b 路径编辑命令化（2026-10-01 完成并提交 `43ff5d1`，浏览器全链验收）**：`withPaths(label, fn)`（前后整表快照→有变化才入栈 `PathsCommand`→统一 touch）+ 控制点拖动会话 `beginPathsDrag/commitPathsDrag`（移动过程直改、up 一条命令）。覆盖：Viewport 六处（双击建线/空路径两点成线/插入/删除/拖点会话/草稿提交）、store 五处（删除/显隐/上移下移顺序/复制/新建·重命名）。**⚠ 大坑：`path.points` 经组件 `$state` 深代理 → `structuredClone` DataCloneError**——快照/apply 全改**手动平面拷贝**（{...p, points: map({lon,lat})}）；连带 autosave Worker 克隆 world 也炸 → `dispatchSave` 捕获后先 `snapPaths` 规范化重试一次（实测 Worker 保存恢复、无降级提示）。**验收**：建线 pts0→2、拖点坐标变化、撤销1 精确回拖前、撤销2 回 []、autosaveAt 正常刷新。**1-b 剩余**：图层树 dragLayer 排序、图层/元素 copyItem 命令化、climate/astro、道路端点（region 域）。


- **⚠→✅ 渲染错乱根因（2026-10-01 用户报障 → 已修）**：本批 `ensureMapGl` 在 renderer 创建**之前**调用了无参 `glCanvas.getContext('webgl2')`——**WebGL 上下文属性由首次调用者决定**，无参默认建出 `alpha/depth=true、stencil=false` 的上下文，renderer 请求的 `stencil:true` 被静默忽略 → **轮廓 stencil/evenodd 填色掩码全废 = 渲染错乱**（复现实证：错乱会话 `getContextAttributes()` = alpha:true/depth:true/**stencil:false**）。修法：ensureMapGl 彻底不再自己 getContext，丢失判定改用 renderer 自带 `isLost()`，创建只走 `MapGlRenderer.create`（首个调用者=renderer ✓ 属性归正）。**验收：修复后 attrs = alpha:false/depth:false/stencil:true 与 renderer 请求完全一致**；沉降后统计与基线一致（meanR57/distinct≈基线），早段差异=渐现时序噪声（见方法论）。基线存档提交 `8bdec59`（第十一~十四轮+速修包，渲染批之前）。


- **✓ 还债步骤 2（GL 恢复路径 P0，2026-10-01 完成）**：renderer `dead` 标记 + Viewport lost/restored 监听**主动触发重绘** + `ensureMapGl` 三级分类（丢失=瞬态提示不计失败 / 活着但 failed=2s 冷却重建 / 3 次失败=致命提示仍 5s 自试）+ `map2d` GL 缺席铺底色 **2D 余量层照画**（路径/标注/图框）+ 双提示条。**验收**：事件间谍 `["lost","restored"]`、丢失期 rest 管线持续绘制、恢复后 **diffPrePost=0 像素级自愈**、gpu 恢复自增。**测试坑：`getExtension` 丢失后返回 null，restoreContext 句柄必须提前保存**（曾把页面卡在丢失态，重载即解）。
- **✓ 还债步骤 3（存档链路硬化，2026-10-01 完成）**：① `deserializeWorld` 结构断言四项（cell.id 连续性/polygon≥3/邻居越界/region 引用越界）——**坏档断言实测全中、好档零误杀**，throw→启动错误条不进渲染；② **autosave 挪 Worker**（`persist/saveWorker.ts`，busy/latest-wins + `saveDrain` + 同步降级链）——实测「已存」正常刷新、无降级提示、**主线程 longtask 峰值 250-330ms**（2s 级巨任务=Worker 首建一次性）。**残余：postMessage 结构化克隆仍在主线程 ~250ms**（归零需列式化，另立项）。
- **✓ 还债步骤 6（热路径与缓存保险，2026-10-01 核心三项落地）**：① `RegionIndex worldKey` O(1)（原拾取路径每次 O(100k) 扫描+拼串 → `regionsRev:长度:长度`）；② `buildPieceParams` 每帧 Map/Set 分配清零（跨帧 clear+复用，同步不可重入）；③ decorations 每层 regions.filter / cellMarker flatMap → dataRev 键控惰性缓存。**验收：同状态 stash A/B 最终 diff=0.0%、帧 p50 9.7ms 无回归**。**缓发**：世界副本数统一（副本=历史 bug 旋涡，另立包）、borderCache regionsRev 键（与 Δ 补丁红线冲突，断言随翻转探针包）、flip 探针降级——理由见 ROADMAP_REFACTOR 步骤 6。


- **第十四轮（2026-10-01 历史清点 + 已知问题速修包，全部浏览器实测）**：
  - **全量历史清点**：用户要求把散落在 ROADMAP×2/59 轮日志/复盘与控件彻查记忆里的未完项全部翻出——完整清单已交付（A 已知问题5 / B 还债七步剩余 / C 性能5 / D 控件存余 / E 功能骨架 / F 显示缺口 / G 待验收 / H 待拍板），本轮修掉其中修复类，其余在 ROADMAP 系按层归位。
  - **① autosave 漏存根治**：`scheduleAutosave` 集中进 touch* 家族（World/Regions/RegionsIncremental/Height/LayerView/Paint 六处），任何数据触碰 2s 防抖入存——不再依赖「恰好换了 world 身份且 App effect 恰好读到」。（实施插曲：正则锚点撞上**调用点**导致一度误植，已修正——教训见验证方法论。）
  - **② 球面补丁队列限界**：piecePatch/heightDelta **同键 Δ 合成**入列（键数=上界，球面不消费也不涨）；pieceInvalidations 去重；合成语义 node 断言「串行应用 ≡ 合并应用」。
  - **③ 右键擦除三层断链**：A′ 拍板画布右键=纯位移 → 擦除手势定为 **Shift+左键**：paintHeight 路由接受 shift、App `onpaint` 补上丢失的 alt/button、状态文案改「Shift+左键擦除」。实测合成指针序列 cell 高度 62→0。
  - **④ gk 投影残骸**：旧前向 2 对 1 折叠（渲染重叠+逆解无解）→ 整体换「墨卡托·中经」（x=Δλ、y=atanh(sinφ)，尊重 centralMeridian——mercator 分支反而不带 cm），闭式逆解 roundtrip 1e-14；UI 下拉实测只暴露 mercator/robinson，gk 属防护性修复；改名 gk: 高斯-克吕格→墨卡托·中经。
  - **⑤ 检查区「数据翻了界面不跟」根因修复（新登记已知问题）**：`worldRaw=$state.raw`（无深代理）→ 模板直读 `layer.visible` 等可变属性不被追踪、且中间派生输出**同引用截断失效**（world 身份换了也白换）→ 眼睛标签三态不刷新。修法=**`view` 快照派生**（依赖 `editor.rev` + world 身份，输出全新对象），InspectSection 全部展示值（显隐/名称/颜色/计数/描述/相邻/extra/高度区间/样式 cfg）收敛入快照；实测三态跟随 + 元素分支/显示参数面板正常。**通用规则已写进组件注释：raw 状态下新展示字段必须进 view，禁模板直读可变属性。**
  - 基线：tsc 0、svelte-check 0 errors（5 既有 warnings）。

- **⚠→✅ 冻结 P0 已修复（2026-10-01，打桩定位→一行护栏修复→全链验收）**：
  - **根因（bundle 级实证）**：App 绘制派生 effect 的幂等护栏 `editor.draw.targetRegionId === id` **对高度会话永不成立**——`startHeightDraw` 存的 target 是 `` `__height__:${id}` ``。于是每次 effect 重跑（world/selected 变化都会触发）都走 `endDraw()`（内部 touchWorld **换 world 身份**）→ `startDraw()` → world 变又弄脏 effect 自身 → **无收敛自激循环**：批处理 `#process` 重入 200+ 层、`is_processing` 永真、后续所有批不入队 → **写入照常但永不渲染**（模式切不动/过滤失效/FPS 断链，早期表现为 `state_unsafe_mutation`）。普通元素 target=裸 id、护栏一次命中即收敛——**故只有「绘制+高度区间元素」触发**（打桩实测 written-sources 每轮完全相同：`ui.draw/ui.status/worldRaw/world/roots/visibleFlat/cells`）。
  - **修复**：`App.svelte` 绘制派生 effect 护栏改为同时匹配裸 id 与 `` `__height__:${id}` ``（带注释）。**验收（5184 实测）**：绘制↔检查反复切换 tries=1 全过、`#process` 最大重入深度 216→**2**、零 `state_unsafe_mutation`、过滤即时（军队→1行）、高度绘制功能完好（状态栏「高度绘制 · 顶峰 61」+ mpanel 高度滑块）。
  - **环境已复原**：svelte 源码探针二次撤净（`rm -rf node_modules/svelte && npm install`）、依赖重优化回原始 `runtime-BON0u2xn.js`（探针命中0）、调试端口 5175-5184 全杀只留 5173/5174。
- **第十二轮（2026-10-01 用户反馈批，全交付、浏览器实测通过）**：
  - **对准按可见副本**：`revealSelection` 旧只算 k=0 副本 → 平移一整圈后解算到"原件位置"空地（用户"一下子偏移很远"）。修：`worldCopyKs` 可见 k 集再扩 k±1（与 elementCopies 同口径），取离相机最近副本；元素已在视口 → 零移动。**活实例探针验收**：平移 1.67 世界宽后点腓尼基，最近副本 sx=994∈[330,1272]、camX 不变 ✓。
  - **两面板搜索独立**（用户定）：各面板局部 `text` $state；顶层创建行 onAddLayer(name)/onCreate(name)/onRandomName(返回名) 新签名；子级 CreateBox 仍走全局 newName；实测图层框只滤图层、元素框只滤元素。
  - **元素展开区整修**（用户定：统一/紧凑/无框/无解释）：EntityInfoBody 重写——**删专属色字段与概念（UI）、删外交（附庸/敌对/同盟）、删说明段落**；.mpanel 去边框底色、CreateBox 去虚线框、去"显示参数"标题与分隔线、行内徽章（diplomacyBadge）删除、绘制提示段落删除（状态栏已有指引）；死组件 `ElementInfoPanel/LayerInfoPanel` 物理删除、layers.ts 死变量 excl 删。数据层 exclusiveColor/diplomacy.ts 保留（legacy，无 UI 入口）。
  - **缩进/提升语义 v3（用户 2026-10-01 定稿，推翻 v2"上一个同级直接父"）**：**缩进=目标是视觉上一行**（=上一个同级的子树链尾叶子：有子则下钻到"没有子元素的父元素"，位置零漂移）；**提升=一次点击直接到顶层**（"还有父和同级就继续提升"=终点一次算出）；仍单命令零数组搬家。`indentable` 禁用=无上一行或已是其子。实测：环境 depth2 一键回顶层 ✓。
  - **任务3 显隐两断点修复**：① store 根数配额拒绝分支漏 `touchLayerView()`（父链已点亮但缓存不失效=眼睛显示中却没画）已补；② `isLayerShown` 去掉自由层短路（路/航/河眼 ON 在球面可见，与 2D/契约对齐）。**验收：同焦点下高度层开关像素差 62.7%**（非焦点可见层确实大面积显示）；植被类低重叠层 1.2% 属正常叠放（§5 焦点在上）。
  - **任务2 结论（无代码）**：副本**无界不成立**——每帧 `worldCopyKs` 现算 k 集（硬上限12，元素±1=36）、渲染完即丢；GL 同一 instance 缓冲覆盖写；几何/环缓存键不含平移量；唯一增长是 `contentOffsetX` 标量（浮点精度，无内存增长）。
  - 基线：tsc 0、svelte-check 0 errors（5 既有 warnings）；测试未跑（纪律）。
- **第十一轮（2026-09-30，九点全交付，浏览器实测通过）**：
  - **缩进/提升语义重写**（store）：旧「链尾下钻/上溯最老祖先+relocateAfter 数组搬家」废除（图层 visualItems 错误 reverse = 顺序乱根因）→ 新 `layerDisplayList()`（与 LayersPanel 同序=数组前序 DFS）；**缩进=成为上一个同级图层的子图层、提升=升一级（父的同级）**，两者**只改 parentLayerId、数组序不动**（LayerFieldsCommand 单命令，叠放零影响；数组前序不变量保证显示位置正确）；元素树分支删除（元素面板不再提供缩进/提升）。
  - **结构定稿**：CreateRow 文本框兼过滤器（`newName` 即 filter，两面板 `shownRows/roots` 同规则过滤；独立🔍搜索行退役）+ canCreate=false 时只留文本框（高度层/球面）+ 三件 `width:100%` 同 button 宽；**button 上控件全灭**（ItemButton control 链删除），高度滑块=绘制 mpanel（ia 分支）+ 检查 InspectSection `.hsl`（`setHeightPaint` 无需会话，先按可涂改）。
  - **判空**：`taskMode==='draw'` 图层行 content=null、元素 `modeBodyOf`（gen 无子=null）→ 无 caret 不可展开；组织行按钮按传入 handler 渲染（元素只上移/下移），禁用改**同级判定**（first=无上个同级/last=无下个同级/顶层）——修了旧「下移被 first 误禁」。
  - **滚动根治**：LayersPanel `.grid` 缺 `overflow-y:auto` = 三轮不滚的根因（已补+隐藏滚动条）；元素 ul 原生可滚（PageDown 可信事件实测 0→126/220.5）。
  - **视觉**：缩进行 button 内 2×12px 金色短竖线 `.dbar` + li padding-left=depth×14（图层补齐与元素同构）；间距 `.acc.grow .body` 左右 8→4 + grid/create padding 2→1（实测 button 距框 10→7px）。
  - 基线：tsc 0、svelte-check 0 errors（5 既有 warnings）；**测试未跑**（纪律）。
- 第十轮 `2ddc6ce`+`bed0880`：组织模式/拖动退役/样式批（详见 docs/UI_REFACTOR §9；其缩进语义标注已被第十一轮定稿推翻）。


## 追加归档（2026-10-01 第三十轮剪出）

- **✓ 第十九轮（2026-10-01，还债 1-c 命令纯数据化——步骤 1 三子项全清）**：
  - **删**：`PatchRegionsCommand`（死码零引用——store.patchRegions 实产 `RegionFieldsCommand`）；`HeightStrokeCommand`（afterApply/afterRevert 闭包）合并入纯数据 `HeightCellsCommand`；连带删 commitStroke 死变量 `topoChanged`。
  - **分发**：`History.undo/redo` 改返回**被执命令或 null**；store 新增私有 `historyEffect(cmd, dir)`——高度笔画 undo→`flushHeightRegions(交换样本)+touchHeight(true)`、redo→`flushHeightRegions(原样本)+touchHeight(false)`（**区间/landsea 归属=派生数据，不重算=归属过期**，这是必须分发而不是只 touchWorld 的原因）；非高度命令零副作用直通。
  - **契约变化**：undo/redo 返回 boolean→`EditCommand|null`；`tests/historyMulti` 5 断言适配（toBe(true/false)→toBeTruthy/toBeNull，业务规则未变）。
  - **验收**：高度笔画（顶峰 61 三笔）画→撤销→重做——cell 高度/海陆旗/区域成员**逐位回滚**（hD=oD=rD=0，重做对 s1 全 0）；常规建层撤销 15→16→15→16；console/overlay 零错；tsc/svelte-check 0。
  - **stash A/B 法证预存**：`git stash` 回旧码跑同流程，undo cD=8792/分区等价/redo 全 0 **与新码逐位相同** → `continentId` 标签+region 数组序漂移是**预存行为**（分区等价、真值精确），已登记 ROADMAP 已知问题表；新旧码行为保持。
  - **1-c 边界（诚实记录）**：JSON round-trip 残余=快照类命令载荷含 Set/Map（历史面板会话内运行不需序列化，持久化时补编解码）。

- **✓ 第十八轮（2026-10-01，1-b 收尾：复制/删除命令化 + 拖拽死码清理，浏览器全链验收）**：
  - **命令化**：`copyItem` 层支 → `history.run(world, new AddLayerCommand(copy,'复制图层'))`、元素支 → `new CreateRegionCommand(copy,'复制元素', idx+1)`（**新增 `at` 参数**：复制插原位之后）；`deleteItem` 层支 → 新 **`DeleteLayerCommand`**（ctor 快照层定义+其 regions（cells/Set/Map 深拷贝）+renderCfg；apply=删、revert=全量恢复；`alreadyApplied:true` 执行后入栈）。
  - **死码**：store `dragLayer/dragRegion`/DropHint import（十轮拖动退役后零调用）、LayersPanel+App 死 prop `onMoveLayer` 一并删除。
  - **验收**：元素复制（右键「复制一个」9行→Ctrl+Z 回8，副本消失）✓；图层复制（15→16→15）✓；建层→右键删除→Ctrl+Z 恢复（15→16→15→16）✓；全程零 error overlay；测试层已清理（终态 15 原始行）。tsc/svelte-check 0 errors。
  - **1-b 收口**：剩 climate/astro（无 UI 写入口=孤儿，归步骤 7 判定）、道路端点 `endpointOverrides`（region 域，随 1-c 核对）。**下一包 = 1-c 命令纯数据化（历史面板唯一前置）**。
  - **测试坑**：编辑后 HMR 整页重载会把整段 evaluate 拖到 32s 超时（两次误判为 copy 死循环）→ 先跑活体探针（页内自旋 50ms）再分步执行；本 runtime **globals 不跨 evaluate 调用**，每次都要重挂 setupBrowserRuntime。



## 剪出（2026-10-02）：第二十五轮 用户反馈批四件

- **✓ 第二十五轮（2026-10-01 用户反馈批四件）**：
  - **revealRaf 修复**：5-b3 换 revealCancel 时漏改 onMount cleanup → 切球面即 `ReferenceError`（用户报障）——已改 `revealCancel?.()`，来回切 4 次零错。
  - **错误复制钮**：`main.ts` 捕获**全文含栈** → `editor.lastError`（ui 新字段）→ StatusBar 左区出错时（error 或 ⚠️ 状态）左侧 `⧉`，点击 `clipboard.writeText`（失败降级 execCommand）→ `✓` 1.5s。验收（间谍法，失焦页真剪贴板被拒）：截获=Error 全栈、按钮翻 ✓。
  - **顶栏胶囊金钮不动**：根因=**IAB/后台页 CSS 过渡时间线冻结**（style 已更新、computed 停旧档；ModeCapsule 自 371f8d2 未改=环境性）→ `.knob` 去过渡**瞬移到位**。验收：点击后 120ms computed=96px=目标档。
  - **元素展开删子元素**（拍板先删、之后重设计）：WorkspaceDrawer 删 kids 递归+子级 CreateBox+childNameOf/handleCreateChild/onCreateChild（App 绑定同删）；`modeBodyOf(gen)=false`；InspectSection 删「子元素」计数行；App 删元素级生成占位。顶层缩进树不受影响；验收=无子元素/子层字样、检查区正常、7 国全显（少1国=生成数据本就 7 个，旧逻辑同）。
  - 基线：tsc 0、svelte-check 0 errors。


## 剪出（2026-10-02）：第三十轮 容差集中

- **✓ 第三十轮（2026-10-01，步骤7 转包①：容差集中）**：
  - `core/tolerances.ts` 单源 10 常量；**17 文件原值迁移零改值**——键量化 KEY_QUANT（lonlatKey/NumKey ×1000 全清）、WRAP_EPS(1e-3)/PROJ_WRAP_EPS(1e-2) 并列暴露历史分歧、GEOM_EPS(1e-12 含近零保护，全清)、EPS_FP(1e-9)、SCALE_FLOOR(cam.scale 下限 7 处全清)、MIN_RATIO/MIN_SEG/DEDUP_EPS/SPHERE_MIN。
  - **坑（已修）**：脚本把替换表达式当 import 符号名插进 14 文件（`import { Math.max(...) }` 语法炸）+ ring/ 相对路径差一级——修复法=删垃圾行按 `^import` 重插；教训=批量替换的 import 符号必须与替换对**分离建模**。
  - 留原地（模块头注明）：一次性孤值 1e-8/1e-10/1e-15、GLSL 内字面量。
  - 验收：tsc/svelte-check 0；冒烟=平面 hover 拾取（#70115 全字段）+球面往返×2 零错。**未跑测试**（纪律）。
  - 存量进度：容差 ✓ / 图层名标志位 ☐ / as-unknown ☐。


## 剪出（2026-10-03）：第二十九轮 还债步骤7大扫除

- **◐ 第二十九轮（2026-10-01，还债步骤 7 大扫除：死码/孤儿/两修复全清）**：
  - **七项死码按当日现状复核**：cellIndex **整文件删**（索引零读者，invalidate 无读者=无效失效）+ rebuildNeighborsFromSharedVerts + NamePlacement/nameStyle + cellsLayer 空桩出双管线；centerLabel/PathFeature.name 判**活**保留；Viewport 旧注释已随重构漂移无存。
  - **孤儿链全删（外部零调用实证）**：store（applyNature/regenPolitical/regenNetworks/applyHeightmap/measureClick）、CommandService（rename/recolorSelected）、DrawController（roadBreaks）、GenerationService（applyGenPreset/toggleProfile）；**nature.ts 整文件删**+biomes 瘦至 83 行活核+climate.test 删 nature 两案+networks/perf 夹具换 computeBiomes；SOFT_MAX_DENSITY 死导出删；store **888→803**。
  - **修复①路网**：校验先于清空（roads+routes）——合成探针双分支 verdict=true（早退保留/正常清空）。
  - **修复②撤销父残留**：undo/redo 补物化 + materializeParentCells 改**精确派生（父≡∪子）**——6/7 对恒等、唯一 extra=历史残留→**自愈 extraNow=[]**、撤销 unrestored=[] 逐位还原。**语义注**：从空重建的前提=「父 cells≡∪子」实测成立（AGENTS §3 字面语义）；若未来出现父直接持有子外 cell 的合法流程，需回看此假设。
  - **转独立小包三项存量**：容差字面量 65 处 / 图层名硬编码 30 处（=LayerDef 标志位数据模型级）/ as unknown 25 处 11 文件——详见 ROADMAP 步骤7。
  - 基线：tsc 0、svelte-check 0 errors；冒烟=四次模式切换+建层撤销零错。
  - 进度：**1 ✓ 2 ✓ 3 ✓ 4 ✓ 5 ◐（剩 shell 协调+两小包）6 ◐ 7 ◐（三项存量转包）**。


## 剪出（2026-10-03）：第二十/二十一轮 还债步骤4+步骤5-a

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
