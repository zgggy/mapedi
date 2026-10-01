# Mapedi 交接（给下一轮 AI）

工作目录 `/Users/zgy/mapedi`，应用 `web/`（Svelte 5 + TS + GL 直绘，100k cell）。**当前提交 `bed0880`（第十轮文档），工作区干净。**

## 先读

1. `AGENTS.md` — 协作规则与红线（六层定位模型、根因流程、硬规则、测试纪律、文档分层 §9）
2. `RENDER_LOGIC.md` — 显示契约与模块边界
3. `ROADMAP_REFACTOR.md` — 还债路线与已知问题（含证据行号）；产品缺口 → `ROADMAP.md`
4. `docs/ARCH_REVIEW_2026-09-29.md` — 全库评审快照（还债排序依据）
5. `docs/UI_REFACTOR_2026-09-29.md` — UI 九轮迭代规格与决策记录（§9 两表 D/C/E 系拍板 + 第十轮语义解析标注）

`docs/_archive/`、`docs/history/`（59 轮旧日志）**禁止当实现依据**。**注意**：投影动画/模式切换有并发会话线，接手前先 `git log`。

## 第十一轮需求（2026-09-30 用户原话规格，**已交付**——见「当前状态」）

用户九点：① 缩进无视觉效果→button 内最左侧短竖线 ② 缩进/提升顺序乱（未变成上一个图层的子图层）③ 元素面板无缩进/提升两钮 ④ 展开后为空→直接不能展开 ⑤ ul 与 panel 左右间距再小 ⑥ 图层/元素列表不能滚动（连续三轮）⑦ 结构定稿（创建行文本框兼搜索+🎲+加，拉满同 button 宽；两面板同构；独立搜索行退役）⑧ 任何模式 button 上无操作控件，滑块只在高度元素展开内容 ⑨ （隐含）检查/绘制模式展开各含一个高度滑块。

## 当前状态（第十六轮：渲染错乱根因已修，**未提交**——基线已提交 `8bdec59`）

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

## 遗留清单（按优先级）

1. **1-b 剩余**：路径点编辑（Viewport 8 处直改）、paths 数组序、图层复制/删除命令化、climate/astro。
2. **1-c**：`PatchRegionsCommand`/`HeightStrokeCommand` 闭包仍在——**历史面板的唯一前置**。
3. 还债步骤 2/3/4（GL 恢复路径、存档链路硬化、cellClimate 真相归位）——见 ROADMAP_REFACTOR。
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

## 下一轮候选（第十一轮之外）

- 还债步骤 2（GL 恢复路径，P0 单点黑屏）或 3（存档硬化）；历史面板（依赖 1-c）。
- 待用户复核：组织模式"提升=上溯最老祖先"语义；海陆案 A（产品级删层）；生成引擎包（`docs/GEN_UNIFIED_DESIGN.md` 过目）。
