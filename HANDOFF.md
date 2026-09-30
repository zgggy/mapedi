# Mapedi 交接（给下一轮 AI）

工作目录 `/Users/zgy/mapedi`，应用 `web/`（Svelte 5 + TS + GL 直绘，100k cell）。**当前提交 `bed0880`（第十轮文档），工作区干净。**

## 先读

1. `AGENTS.md` — 协作规则与红线（六层定位模型、根因流程、硬规则、测试纪律、文档分层 §9）
2. `RENDER_LOGIC.md` — 显示契约与模块边界
3. `ROADMAP_REFACTOR.md` — 还债路线与已知问题（含证据行号）；产品缺口 → `ROADMAP.md`
4. `docs/ARCH_REVIEW_2026-09-29.md` — 全库评审快照（还债排序依据）
5. `docs/UI_REFACTOR_2026-09-29.md` — UI 九轮迭代规格与决策记录（§9 两表 D/C/E 系拍板 + 第十轮语义解析标注）

`docs/_archive/`、`docs/history/`（59 轮旧日志）**禁止当实现依据**。**注意**：投影动画/模式切换有并发会话线，接手前先 `git log`。

## 下一轮：第十一轮需求（2026-09-30 用户原话规格，**未动工**）

1. **展开后为空的 → 直接不能展开**（无内容的行不给开合能力：不显箭头、点击不展开——注意区分 content 为空 vs 模式未注入）。
2. **button 所在 ul 与 panel 的左右间距再小一些**（现 grid padding 2 → 更小）。
3. **⚠ 图层和元素 panel 内的列表还是不能滚动（连续两轮未修，本轮必须根治）**。排查线索（用户页面实测 HTML）：`ul.grid` rect `h=258`、`--ibtn-h: 26px`、class `grid`——容器有限高但 wheel 不滚/无滚动条。疑点链：`pane-body(flex:1;overflow:hidden)` → `.sec-root(flex:1;min-height:0)` → `.body` → `ul.grid(flex:1;overflow-y:auto)` 某处 flex/min-height 断链或 wheel 被拦。**用 DevTools/实测 scrollTop 定位，勿凭猜**。
4. **结构定稿（两面板同构）**：
   - `图层` 把手（展开/收起）→ `- ul` → `-- 新图层文本框 + 🎲随机 + ➕添加` → `-- 图层1/图层2…`
   - `元素` 把手 → 同构：`新元素文本框 + 随机 + 新增` → `-- 元素1…`
   - **搜索并入创建行文本框**：输入文字即过滤下方列表（与现“搜索元素”同能力）——**独立搜索按钮/搜索行退役**；文本框+随机+添加三件**整体拉宽 = 下面 button 同宽**（拉满行）。
5. **任何模式下 button 上不再有任何操作控件**：**行内高度滑块删除**（ItemButton 的 control 链）；滑块只存在于**高度层元素的展开内容中**——绘制模式展开区已有；**检查模式展开区（InspectSection）需补**（用户字面"展开后包含滑动控件"不分模式）。待定：检查模式滑块=只读展示 or 联动涂改（`setHeightPaint` 依赖会话与否需查）——**先按可涂改做，若 store 拦截则只读**。其他元素的展开永不含高度滑块（现状本无，保持）。

## 当前状态（第十轮完成）

- **第十轮 `2ddc6ce`+`bed0880`**：第四模式「组织」（胶囊四档：检查/生成/绘制/组织，球面锁检查）；`OrganizeRow` 四操作（上移/下移/缩进/提升，图层元素两列表复用）；**缩进=视觉前一个的链尾下钻、提升=上溯最老祖先后置（按用户字面解析·待复核，见设计稿 §9 第十轮表）**；history 新基座 `RegionsOrder/LayersOrder/Composite/LayerFields`，`moveItemStep` 全量入栈（**paths 序是 1-b 剩余**）；**拖动全退役**（ItemButton 长按链/两面板 drag/liftDrag 数学物理删除，等高 `measureSlot` 保留 26px）；样式批（边距 6→2、名称单行省略【推翻换行契约】、字体 11、create 无分割线等宽、展开无横线、**rail 宽=顶行实测 299=299**）。组织验证：缩进→罗马入波斯链尾→undo 完整回位、提升顶层禁用、零错误。
- 第九轮 `cf02fe3`：完全代码复用（ExpandPanel header 槽，行=嵌套 .acc，自造壳物理删除）+三修（图层行再点收起/行内 bodyMax 42vh 限高【1075px 撑爆根因】/把手行头 26px 精确相等）。
- 静态基线：`npx tsc -p tsconfig.app.json` 0；`npx svelte-check` 0 errors（5 warnings=tsconfig 元配置既有）；测试 33 文件/171 用例（未跑，纪律：用户说了才跑）。

## 遗留清单（按优先级）

1. **第十一轮清单**（上述 5 条，尤其滚动 bug）。
2. **1-b 剩余**：路径点编辑（Viewport 8 处直改）、paths 数组序、图层复制/删除命令化、climate/astro。
3. **1-c**：`PatchRegionsCommand`/`HeightStrokeCommand` 闭包仍在——**历史面板的唯一前置**。
4. 组织模式**多兄弟旧数据**下"提升"的锚点行为复验（现按根级多元素模型）。
5. 还债步骤 2/3/4（GL 恢复路径、存档链路硬化、cellClimate 真相归位）——见 ROADMAP_REFACTOR。
6. 面板内滚验证过的方法只覆盖了"结构存在"，**用户实测滚不动**——勿再凭结构断言滚动。

## 验证方法论（本会话累积的坑，务必沿用）

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
