# Mapedi 交接（给下一轮 AI）

工作目录 `/Users/zgy/mapedi`，应用在 `web/`（Svelte 5 + TS + GL 直绘，100k cell 基准）。

## 先读

1. `AGENTS.md` — 协作规则与红线（六层定位模型、根因流程、硬规则、反例清单、测试纪律）
2. `RENDER_LOGIC.md` — 显示契约与模块边界
3. `ROADMAP.md` — 产品功能缺口与滚动状态
4. `ROADMAP_REFACTOR.md` — 架构还债路线与已知问题（含证据行号）
5. `docs/ARCH_REVIEW_2026-09-29.md` — 全库评审快照（还债排序的**依据**）

`docs/_archive/` 与 `docs/history/` **禁止当实现依据**（考古用）。

**必守**（详见 AGENTS）：整包交付；交付说明 = 问题/原理/预期效果；发现双真相要指出不打补丁；显示不打折；**除非用户明确说 test，否则不跑测试**；视觉差异先打印数据层实际值。

## 当前状态（2026-09-30，UI 重构 U1-U3 + 四把手重排完成后填写）

- **在途未提交改动**：无（工作区干净）。最近提交：`4492ba4`（**1-b 字段类命令化**）、`e837f67`（**第七轮 ExpandPanel 单体**）、`3b43698`（1-a undo 腐蚀）。
- **2026-09-30 第十轮（组织模式+拖动退役，`2ddc6ce`）**：模式胶囊**四档**（+🗂 组织，球面锁检查）；行展开=OrganizeRow 四操作——上移/下移/缩进/提升；**缩进=视觉前一个的链尾下钻**、**提升=上溯最老祖先后置（按用户字面解析，待复核——见设计稿 §9 第十轮表）**；history 新基座 Orders×2/Composite/LayerFields、moveItemStep 全量入栈（paths 序剩）；**拖动全退役**（ItemButton 长按链/两面板 drag/liftDrag 数学全删，留等高）；样式批（边距 6→2、名称单行省略【推翻换行契约】、字体统一 11、create 无分割线等宽、展开无横线、rail 宽=顶行实测 299=299）。浏览器全绿（缩进→罗马入链尾→undo 回位、提升顶层禁用、零错误）。
- **2026-09-30 第九轮（完全复用+三修，`cf02fe3`）**：用户报三问题全修——①**完全代码复用**：ExpandPanel 加 header 槽/selected/dragging/lift/bodyMax，ItemButton 删自造壳（.iacc/.ibtn-body 物理删除）→ 行=嵌套 .acc 同组件；②**再点无法收起**：图层行 handleSelect 单开 toggle（再点清聚焦）+工作区空态句；元素行真实点击收起复测 ✓；③**内容不显示/高度**：行内 body `bodyMax=42vh` 限高自滚（1075px 撑爆根因）+ 把手/行头统一 **26px 精确相等**（handle padding6 / measureSlot 26 / fallback 26）。真实鼠标路径全链验证零错误。
- **2026-09-30 第八轮（列表行把手化，`1874a7a`）**：**行按钮本身 = 把手**——ItemButton 手风琴化（外层 .iacc 与图层/元素把手同款样式语言；头部行 open+content **原地长出**展开区，独立 panel li 与第七轮行级 ExpandPanel 包装全部退役）；**眼睛从行按钮移入检查模式展开区**（InspectSection 两处 vis-toggle：图层/元素；行上 visible/onEye 全链删除）；li `.cell.open` 自适应高（等高机制只测头部不受影响）；toggleItemHidden 包 patchRegions（1-b 补账）。浏览器全绿零错误（两列表 15+8 行、检查/绘制两态展开、再点收起）。
- **2026-09-30 第七轮 + 1-b**：① 左栏单体手风琴——`ExpandPanel`（收起=一行 button、展开=同容器长内容）四处复用传参（左栏图层/元素两面板 + 两侧行级展开区）；工作区改名「元素」、身份行删（首行=新元素）；rail=max-content → 面板右缘与 ↶↷ 圆钮精确对齐（实测 249=249），宽度 ResizeObserver 回传 C7；行级 header 点击收起（图层换聚焦重开/元素=清选中）。② **1-b**：纯数据命令四件（RegionFields/LayersVisibility/LayerStyle/AddLayer）+ `patchRegions` 快照执行器；显隐（含 3 树拒绝分支净变化）、样式、建层、保存信息、外交三操作全部入栈——「core 直改+touch」主路径关闭。浏览器干净复测（显隐三态/改名列表回滚/建层消失）全绿零错误。
- **留下一批（1-b 剩余）**：路径编辑（Viewport 直改 points，8 处）、图层树拖拽排序/复制/删除、climate/astro、**1-c 整体**（PatchRegionsCommand/HeightStrokeCommand 闭包仍在——历史面板前置）。
- **验证教训（累积）**：CUA 组合键会整轮失灵 → 页内 `window.dispatchEvent(KeyboardEvent)` 直发；状态栏 error 盖 status → 先开眼；`createRegion` 自动选中 → 再点行=toggle 取消；改名撤销判定要读**列表行文本**（EntityInfoBody 输入框是本地副本不随 undo 刷新，读它会误判）；眼睛悬停才可见 → evaluate 派发 click。
- **2026-09-30 第六轮（左栏最终形态，`e2ba164`）**：三块统一框架——①顶行=工作区胶囊（与顶栏视图胶囊同高 y=10）+ undo/redo 圆钮；②图层面板 ③工作区面板：**同款把手+子面板**（FoldHandle 单源）、块间 8px、都展开各半（330/330 实测）、收起=27px 一行、内滚锁 pane 内、开合持久化（`mapedi.ui.panel.*`）；⊟/左上圆钮/railOpen 全链删除；railW/workspaceOpen 由 LeftRail onState 回传（railState）。验证全绿零错误。**六轮迭代收敛完毕**。
- **2026-09-30 第五轮（左栏终稿，`371f8d2`）**：**模式胶囊上移至左栏顶**（原图层 header 位）——左栏定稿 = 「三档胶囊（检查/生成/绘制）+ 图层区（📚 轻区头）+ 元素区（工作区·层名 + undo/redo）」两区结构；ModeCapsule 通用化（顶栏两档/左栏三档同款，items/segMinW/disabledWhen）；FoldHandle 物理删除（把手架构彻底退役）、panels/onToggleExpand 开合链退役（两区恒在）。浏览器两批全绿零错误。
- **2026-09-30 第四轮拍板（E1-E5，`fc827ce` 已实施）**：左面板 = **检查/生成/绘制三模式**（球面锁定检查；`shell.wsMode` 持久化）+ 双树行级展开区（图层=聚焦行 / 元素=选中行，snippet 注入；绘制=本地参数区）；**C1 二修**（AGENTS 已改写：绘制会话=模式×选中的推导，双击退役）；右键只剩复制/删除（三信息 popover 退役，InspectSection 为唯一信息入口）；顶栏更名「平面编辑」。**E2 单开/E3 收敛/E4/E5 分期均已落档**（设计稿 §9 第四轮表）。浏览器八项验证全绿零错误。
- **教训（勿重犯）**：snippet 必须**顶层平级**声明——嵌套在兄弟 snippet 内 = ReferenceError（本轮实测踩中，与三十四次“snippet 冻结”同族）。
- **测试基线**：`web/tests/` 33 文件 / 171 用例；静态 = tsc 0 + svelte-check 0 errors（5 warnings 为 tsconfig 元配置既有）。跑测试仅在用户要求时；tsc 用 `npx tsc -p tsconfig.app.json`。
- **2026-09-30 四把手重排包（`6ceb132`）**：左栏 = 图层把手 + 绘制/生成/显示三把手（FoldHandle 单源）+ 元素列表；生成三分支（cells=重新撒点 / height=生成高度图+海陆删旧建新 / 普通层 regen / 路径禁用待设计）；⚙ 移模式胶囊右 + 视图面板 3d/2d 互斥（星球组自 PlanetParams 迁回）；搜索按钮化；紧凑统一。浏览器端到端全绿（三分支文案、互斥、长按 filling、`已重新生成：height`+海陆重建、console 零错）。
- **统一生成架构设计稿**：`docs/GEN_UNIFIED_DESIGN.md`（genParent 单源/递归/CASCADE 拓扑推导/parentLayerId 同构投影/海陆 A 案待拍板）——**引擎包待用户过目后实施**。
- **本轮教训**：① FoldHandle 的 `grow` prop 解决跨组件样式（Svelte scoped 父选不中子内部）；② 验证批次要显式记录起始模式（上一批切了球面，下一批按平面断言全部误报）；③ `playwright.keyboard` 不在 IAB API 面，用 `cua.keypress`。
- **遗留**：非 height 层长按触发生成未实测（filling 态已验，fire 与按钮同函数已由 height 按钮路径覆盖）；100k 性能回归与全量回归待用户验收轮；`Choose File` a11y 裸露小疵。
- **更早**：U1-U3 见 `3abf544`/`9b4868c`/`0ea7eed`/`04dcff1`/`e492241`；59 轮日志 `docs/history/HANDOFF_LOG_2026-09-29.md`。

## 交接纪律（新轮次怎么记）

1. **每次交付**在本文件"当前状态"下追加一轮小节（≤15 行）：问题 / 根因 / 修复 / 验证，**并同步刷新"在途改动"与"测试基线"**。
2. **超长日志禁止堆本文件**：本文件始终保持 <150 行。当历史小节积到 ~20 轮，把**全部历史小节**剪切到 `docs/history/HANDOFF_LOG_<日期>.md`（只读快照），本文件只留指针与最新 1-2 轮。
3. 产品/契约变更落 AGENTS（规则）或 ROADMAP（状态），**不要只写在交接里**——交接是易失层，规则与状态必须落持久文档。
4. 用户拍板的契约变更要写**日期与原话语义**（例："显隐只归眼睛（2026-09-28 用户推翻第四十二次方案）"）。

## 下一轮候选（从最近轮次提炼，动手前与用户确认）

- 投影切换动画的收尾/验收（批2 已提交，探针测试在 `9940e9a`）
- 比例尺 / 指南针（ROADMAP P0）、等高线、文字标注、成图排版
- 球面中点 Hermite 填充（球面显示契约补齐）+ 球面标签/悬停
- 还债包 1：变更纪律闭环（undo 腐蚀 → 命令化 → 命令纯数据化），见 `ROADMAP_REFACTOR.md`
