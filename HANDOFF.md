# Mapedi 交接（给下一轮 AI）

工作目录 `/Users/zgy/mapedi`，应用 `web/`（Svelte 5 + TS + GL 直绘，100k cell）。**工作区干净；git log 头 = 第二十七轮 5-b5 批。**

## 先读

1. `AGENTS.md` — 协作规则与红线（六层定位模型、根因流程、硬规则、测试纪律、文档分层 §9）
2. `RENDER_LOGIC.md` — 显示契约与模块边界
3. `ROADMAP_REFACTOR.md` — 还债路线与已知问题（含证据行号）；产品缺口 → `ROADMAP.md`
4. `docs/ARCH_REVIEW_2026-09-29.md` — 全库评审快照（还债排序依据）
5. `docs/UI_REFACTOR_2026-09-29.md` — UI 九轮迭代规格与决策记录（§9 两表 D/C/E 系拍板 + 第十轮语义解析标注）

`docs/_archive/`、`docs/history/`（59 轮旧日志）**禁止当实现依据**。**注意**：投影动画/模式切换有并发会话线，接手前先 `git log`。

- **✓ 第二十五轮（2026-10-01 用户反馈批四件）**：
  - **revealRaf 修复**：5-b3 换 revealCancel 时漏改 onMount cleanup → 切球面即 `ReferenceError`（用户报障）——已改 `revealCancel?.()`，来回切 4 次零错。
  - **错误复制钮**：`main.ts` 捕获**全文含栈** → `editor.lastError`（ui 新字段）→ StatusBar 左区出错时（error 或 ⚠️ 状态）左侧 `⧉`，点击 `clipboard.writeText`（失败降级 execCommand）→ `✓` 1.5s。验收（间谍法，失焦页真剪贴板被拒）：截获=Error 全栈、按钮翻 ✓。
  - **顶栏胶囊金钮不动**：根因=**IAB/后台页 CSS 过渡时间线冻结**（style 已更新、computed 停旧档；ModeCapsule 自 371f8d2 未改=环境性）→ `.knob` 去过渡**瞬移到位**。验收：点击后 120ms computed=96px=目标档。
  - **元素展开删子元素**（拍板先删、之后重设计）：WorkspaceDrawer 删 kids 递归+子级 CreateBox+childNameOf/handleCreateChild/onCreateChild（App 绑定同删）；`modeBodyOf(gen)=false`；InspectSection 删「子元素」计数行；App 删元素级生成占位。顶层缩进树不受影响；验收=无子元素/子层字样、检查区正常、7 国全显（少1国=生成数据本就 7 个，旧逻辑同）。
  - 基线：tsc 0、svelte-check 0 errors。

## 当前状态（第二十七轮完成，5-b5 批待提交；在案：`47023e5` 5-b3 → `113d023` 反馈四件 → `ced5e81` 5-b4 → 第二十七轮 5-b5）

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

- **默认下一包 = 5-c App 回调瘦身（与 UI 重构线协调）→ 步骤 7 大扫除**（climate/astro 孤儿、nature.ts 死码、路网再生成、父物化撤销残留）。历史面板（1-c 前置已清、门面/服务就绪）等用户点名。
- 用户点名才动：功能包（比例尺/指南针/测量/搜索跳转/历史面板）；待复核：海陆案 A（产品级删层）、生成引擎包（`docs/GEN_UNIFIED_DESIGN.md` 过目）、专属色数据层清理。
