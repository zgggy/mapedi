# Mapedi 还债路线与已知问题（滚动状态）

> 定位：**行动清单**——做什么、验收标准、当前状态。证据（file:line、失败模式分析）全部在
> `docs/ARCH_REVIEW_2026-09-29.md`，两份文档配套使用：本文件是"待办"，评审是"依据"。
> 状态标记：`☐ 未动` · `◐ 进行中` · `✓ 完成` · `✗ 已否决/不做`
> 更新纪律：状态变了就改这里；证据细节别抄过来（会与评审漂移），指过去即可。

---

## 一、还债七步（按序，每步一个可独立验收的整包）

依据：评审 §6。原则 = AGENTS §6 整包交付；**步骤 1 是后续一切（含未来叙事编辑器第 0 包）的地基**。

### ☐ 1. 变更纪律闭环（P0，最高优先）

- **内容**：① 修 undo 腐蚀——笔刷跨元素副作用（replace 剥 cell / stealFromSiblings / splitPolicy / 自动建行省）补记入命令；② 高频直改路径命令化（路径编辑、图层树、显隐、改名、样式、外交）；③ 命令纯数据化（去 `capture/restore` 闭包与 `afterApply` 回调 → 判别联合 + 外置应用器）。
- **验收**：每类编辑撤销后 world 与改前**逐位一致**（可复用"输出逐位不变法"）；命令可 JSON round-trip；grep 无绕过 history 的 `world.` 直改（生成/导入除外）。
- **为什么先做**：这是当前唯一正在**产生错误数据**的缺陷（评审 P0-1），且是历史面板/持久时间线的唯一前置。

### ☐ 2. GL 恢复路径（P0，单点故障）

- **内容**：`webglcontextrestored` 监听重建；异常分类（瞬态重试 vs 致命提示）；`glReady=false` 时仍画 2D 余量层（路径/地名/图框不依赖 GL）；`ensureMapGl` 允许重建 failed 实例。
- **验收**：F12 `WEBGL_lose_context.loseContext()/restoreContext()` 后地图自愈；拔插/驱动切换不再永久黑屏。

### ☐ 3. 存档链路硬化（P0）

- **内容**：`deserializeWorld` 加结构断言（cell.id 连续性 / neighbors 越界 / polygon≥3）并明确报错；autosave 挪 Worker（当前每 2s 主线程同步 stringify 几十 MB）；失败可见化 + 重试。
- **验收**：手工构造坏档 → 明确错误信息、不进渲染、不覆盖旧档；保存期间无主线程卡顿。

### ☐ 4. cellClimate / biome 真相归位（P0）

- **内容**：二选一——(A) 真缓存：序列化不存、加载后按需重算（与 `types.ts:193` 注释声明一致，倾向此案）；(B) 承认真相：改契约，高度变更纳入 touch 失效管线。
- **验收**：改高度后群系/气候不再静默过期；存档中该字段的行为与文档一致。

### ☐ 5. store / Viewport 拆分（P1）

- **内容**：按六模块边界分包——UIState / ChangePipeline（touch*+consume*，最先拆）/ CommandService / GenerationService / Persistence / DrawController；抽 `MapTransform` / `ViewportController`；顺手修三处失联（`canPaint` 死 prop、`onpaint` 丢参致右键擦除不可达、`panningMode:'cam'` 死分支）。
- **验收**：各模块独立可测；App 不再是 ~60 回调的转发器；渲染不再反向 import store 私有队列。
- **依赖**：建议在步骤 1 之后（命令化减少拆分时的行为风险）。

### ☐ 6. 热路径与缓存保险（P1）

- **内容**：`borderCache` 键补 regionsRev 或运行时断言；每帧分配清零（`buildPieceParams` 每帧 new Map、decorationsLayer 每帧 filter、cellMarker 每帧重建数组）；`RegionIndex` 缓存 worldKey；世界副本数 GL/2D 统一（`map2d.ts` 与 `buildRenderEnv` 双份 dxs 收敛单源）；flip 探针降级为 debug 断言（定向包验证稳定后）。
- **验收**：`__drawMs` 无回归；连续笔刷期 compose 缓存不再全量重算。

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
| autosave 主线程 stringify | ☐ 见还债步骤 3 | 每 2s 同步全量序列化 |
| 每帧 O(n) 分配 | ☐ 见还债步骤 6 | layers.ts 三处 + compose 单槽冲刷 |

---

## 三、已知问题登记（观察 / 已接受）

| 问题 | 位置 | 状态 |
|---|---|---|
| 缩放重烘焙顿挫 ~100ms | — | 暂接受（归卡顿包 2） |
| 球面元素填充 = cell 贴角三角扇，非 Hermite evenodd | GlobeView | 已知余量；球面中点 Hermite 填充为独立包 |
| 球面无标签/悬停 | GlobeView | 待做 |
| gk 投影 unproject 是坏的（死代码残骸） | `projections.ts:171-185` | 待修（拾取/标签错位） |
| autosave 靠 `void w.cells.length` 触发，纯改高度/颜色不触发 | `App.svelte:156-162` | 待修（接近 P0） |
| 球面视图下补丁队列无人消费、无限增长 | `Viewport:710-734` | 待修 |
| `dragPathIdx` 用位置索引，undo 后错指 | `Viewport:1002/1019` | 待修（随步骤 1 命令化） |
| 提示文案"右键擦除"与实际行为矛盾（右键=内容平移） | `store:1208` vs `Viewport:923` | 随步骤 5 修 |
| GL scissor 与 evenodd 遮罩 1px 缝 | `mapRenderer:302` | 观察 |
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
