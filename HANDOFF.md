# Mapedi 交接提示词（直接粘给下一个 AI）

你继续开发 **Mapedi**（球面奇幻地图编辑器）。工作目录：`/Users/zgy/mapedi`，应用在 `web/`，`npm run dev`。

**先读**：`AGENTS.md`（规则，已重构为 0–11 节：身份 → 六层定位模型 → 根因流程 → 硬规则 → 交付纪律 → 反例 → 踩过的坑 → 自检）、`RENDER_LOGIC.md`（显示契约）。`docs/_archive/` **禁止当依据**。

必须遵守：整包交付；每次改动写清 **问题 / 原理 / 预期效果**；发现双真相/坏选型要指出，不要打补丁；**显示不打折**；**除非用户明确说 test，否则不要跑测试**；默认焦点层是 **地块（cells）**，不是高度；**视觉差异先打印数据层实际值再怀疑渲染**（AGENTS.md §8 坑 5）。

---

## 当前状态（截至交接）

**本轮已处理（2026-09-26，第二十一次）— GPU 后端第一版（`a7d184b`）**

- **WebGL2 RegionMesh 元素渲染器落地**（`render/gpu/gpuElements.ts`）：填充=Hermite 环三角扇+stencil 奇偶（= evenodd 含副本）、内阴影=描边纹理 blur（可分离高斯，σ 自适应抽样）按填充 stencil 合成、描边=细长四边形（端头外延）。平滑曲线仍由 `core/ring/hermite` 唯一采样（smooth 同源）。
- **elementsLayer**：GPU 优先 + 逐件 Canvas2D 回退闭包（显示不降级）；宽度/alpha 口径与 `drawPreparedElement` 一致。
- **显示样式面板新增「渲染后端（全局）」切换**（Canvas2D / GPU 实验，localStorage 持久化，切换即重烘焙）。
- **验证**：高度图层 ×1/×6 两档 Canvas↔GPU 逐像素对照 14400 采样点，>8/255 差异 **0 个**。
- `npm run build/check` 通过；147/147 测试通过。
- **下一步**：① 用户验收 GPU 显示 → 确认后默认切 GPU；② 100k 压测（目标达成路径）；③ 视需要做烘焙期 GPU 直渲纹理（省 drawImage）。

**上一轮已处理（2026-09-26，第二十次）— 副本带深海消失修复（`0acf58e`）**

- **用户实测："副本里面的深海还是消失"**（定位极准）。根因与上次裁剪框同族：h0（深海）的**整框底色填充**矩形钉在绝对 ±π，而 `clipDxBias` 已把裁剪口径移到「可见带」`[fr − clipDxBias]`——右键平移后可见带滑出 ±π（= 副本区域），填充够不着 → 副本带丢深海底色、其上叠色全变调（"又变色了"）。**与上次同一类：凡钉在绝对 ±π 的绘制，都必须随裁剪口径平移。**
- 修复：整框填充与 `clipToMapFrame` 同口径（bias 同步）。`frameLayer` 框线/遮罩钉 ±π 是设计本义（外框固定），不动。
- **验证**（像素锚定，副本带深海锚点）：右拖半屏使可见带进入副本区 → 取最暗海洋像素 [13,31,61] → 放大至 ×17.45（视口模式深处）同点颜色不变。
- `npm run build` 通过；147/147 测试通过。
- **下一步：GPU**（用户指示"完全修好之后开始"——本轮修复验证通过即开工；RegionMesh 数据层已就位）。

**上一轮已处理（2026-09-26，第十九次）— 深海/远海变色修复 + 错误处理改造（`e454863`）**

- **用户实测：>2.4× 后深海/远海变色**（用户点破方向："是不是跳过不可见元素的判定有问题"——是）。根因：h0（深海）是**无环整框底色片**，ringBBox 退化为原点——跳过判定只在窗口含原点时放行；×2.4 = 视口模式阈值（平铺窗口恒含原点、视口窗口随视点走）→ 深海底色被跳过、其上全部半透明叠色变调。
- 修复：无环片永不跳过；有环片副本相交改**精确周期解**（k 区间求交，替代 ±2 猜测）。
- **错误处理**（用户拍板）：运行期错误 → 状态提示 + 继续运行（main.ts）；挂载失败仍整屏报错。
- **验证**（用户指路：用高度图）：像素锚定跨缩放色彩不变——右拖半屏后海洋锚点 [66,128,167]，放大至窗口不含原点（bug 条件）颜色不变。
- **重要教训（测试环境）**：自动化探针与**用户手动测试共用同一浏览器标签/世界**——测量会被用户操作干扰（曾误读为回归）；验证要 CSS 坐标全程折算 + 选安静时段。本轮曾误判"测试侵蚀了世界"（右键拖=平移不画图，不成立）。
- `npm run build` 通过；147/147 测试通过。**下一步：GPU**（用户指示"完全修好之后开始"——等用户确认本轮修复后动工）。

**上一轮已处理（2026-09-26，第十八次）— 放大元素消失修复（`93cebac`）**

- **用户实测：放大后部分元素消失（高度档位/其他图层）**。根因：增量烘焙的元素包围盒跳过只比较未平移包围盒——元素经 k±1 世界副本平移后落入窗口（跨缝/平移后）会被误判不可见而跳过。修复：跳过判定按 k∈[-2,2] 周期移位比较。
- **验证方法教训**（写给后续会话，勿再踩）：
  1. 新生成世界的语义层**默认隐藏**（产品默认，焦点=地块只显网格）——"看不到陆地"先查图层可见性，不是渲染 bug；
  2. 右键拖动走平移分支、**不触发画笔**（曾误判测试侵蚀了世界，不成立）；
  3. 合成指针的 `setPointerCapture` 抛错会经 `window.onerror` → `showFatal` **整屏报错**——自动化测试前先打 `setPointerCapture` 空补丁；该容错本身值得改进（输入路径错误不该杀死应用，待拍板）；
  4. 像素探针要与画布同步坐标系（dpr/backing 变化后注意）；验证用**像素锚定**（同点前后对比）而非仅比率。
- **验证结果**：×4 平铺档与 ×11.7 视口档，整周期平移前后中心像素一致、陆地占比一致（0.571≈0.568）；深放大元素完整。
- `npm run build` 通过；147/147 测试通过（**perf 用例须在 web/ 目录跑**：仓库根无 vitest 配置会用 5s 默认超时误报）。

**上一轮已处理（2026-09-26，第十七次）— 世界副本消失修复（`a19e466`）**

- **用户实测：2.4× 以上左右平移时"为循环地图增加的旁边副本"消失**。2.4× = period 贴图预算（16M 像素）耗尽、切 viewport 模式的阈值。副本机制两模式不同：period 靠贴图平铺隐式重复（一直正常）；viewport 需显式画副本，但烘焙裁剪框是绝对 ±π，把副本平移后的像素全部裁掉。
- 修复：**裁剪补偿按模式取值**（`clipDxBias = viewport ? contentOffsetX : 0`）——period 补偿有害（裁掉贴图，上一轮误加后回退的就是这个）、viewport 补偿必需（放行副本）。两个裁剪口径不同是本 bug 与上轮误判的根源，改裁剪/贴图类代码前务必分清模式。
- **循环不变量验证**（用户判据）：×2.59 平移整世界周期，陆地占比前后一致（0.185 = 0.185）；副本缺失时应掉到 ~0。
- `npm run build` 通过；147/147 测试通过。

**上一轮已处理（2026-09-26，第十六次）— 半显/漂移真根因 + 点击卡顿 + 缩放级别（`b271f19`）**

- **半显/放大漂移（用户实测"还是只显示一半/上下不贴"）**：真根因 = **dpr 变化不触发 ResizeObserver** → backing store 过期 → 渲染坐标系（canvas.width/dpr）与输入坐标系（rect.width）错位 → 内容半显 + 缩放定锚漂移（锚点像素逐格走色带）。修复：`syncBackingStore`（渲染前对齐）+ matchMedia dpr 监听。浏览器像素追踪验证：12 格放大锚点恒定。
- **注意**：期间曾误判"裁剪框口径"并加 `clipDxBias`（已回退）——周期贴图只裁 pad 毛边，图框由 frameLayer 遮罩执行；做裁剪/贴图类修改前先分清这两个职责。
- **点击卡顿**：移动 ~1ms（首帧 139ms 惰性索引）；主体 = 提交后重烘焙。增量烘焙改单次合并裁剪 + 元素包围盒跳过 + 增量跳过 bg（其 clearRect 抹拷贝）→ 陆地点连点阻塞 <25ms。**残留**：拓扑翻转（造陆/造海）仍一次全量烘焙（~0.8s@30k）——GPU 后端解决。
- 状态栏新增缩放级别（×倍率）。
- `npm run build` 通过；147/147 测试通过。GPU：RegionMesh 数据层已落（`accc837`），下一步 WebGL2 三 pass + 显示 panel 后端切换。

**上一轮已处理（2026-09-26，第十五次）— 半显/卡顿根因修复 + GPU 开工**

- **增量烘焙半显/错位修复（`193347c`，浏览器复现定位）**：① 脏矩形逻辑无底图也只画脏区——"脏标记残留+缩放换键"同帧 → 空白底+脏矩形的残缺贴图被缓存（"只显示了一半"）；② 增量拷贝换锚重画 → 整张贴图错位（"上下不贴视口"）；③ 脏矩形映射只对 period 窗口成立。修复：增量必须有同布局底图（无则全量）、沿用底图取景锚点、脏矩形按实际覆盖窗口映射。
- **渲染看门狗**：requestRender/requestOverlay 加 250ms 兜底——rAF 被丢弃时 dirty 闸永久卡死（渲染停摆至重挂载；浏览器复现稳定触发）。同时是环缓存内容寻址（点击提交不再全量重链 12 个嵌套区间边界环——"点击卡 2 秒"根因）。
- **GPU 开工**：`render/gpu/regionMesh.ts` 数据层落地（纯函数：cell 扇形三角化/边界细长四边形/合并）。平滑=边中点 Hermite 同源采样（回答用户：平滑保留）。下一步：WebGL2 上下文 + fill/border/shadow(纹理 blur) 三 pass + Canvas2D 回退 + **显示 panel 后端切换选项**（用户要求第一版带切换）。
- 浏览器复现验证：右拖半屏+放大 ×15 → 全画布不透明、陆地铺满、无半显。
- `npm run build` 通过；svelte-check 0 errors；147/147 测试通过。

**上一轮已处理（2026-09-26，第十四次）— viewport 半显/残影修复 + 卡顿包 2/3/4**

- **viewport 半显/残影修复（`320337d`，用户实测）**：三根因——drawWorld 从不清屏（贴图露边即残影）；viewport 烘焙 `worldDxs:[0]` 单副本（窗口跨周期缝缺半边）；分桶键弧度/像素单位混用（恒 0，分桶失效是死代码，滑出余量永不重烘）。修复：每帧清屏+海色底；副本走 worldCopyDxs 按窗口选 k；分桶改屏幕像素单位（桶宽=2×余量）。
- **卡顿包 2/3/4 全部落地**（详见「最近在处理的问题 0」）：增量烘焙（同布局旧贴图作底+脏矩形）、路径 poly 缓存、装饰视口裁剪、标签记忆化、hover 只刷 overlay。
- `npm run build` 通过；147/147 测试通过。
- **GPU 讨论待继续**：用户明确长期想走 GPU——下一步出 RegionMesh/WebGL 设计。

**上一轮已处理（2026-09-26，第十三次）— 显示修复 ×2 + 卡顿包 1 + 100k 可行性**

- **显示修复（`13d0bc2`，用户实测报的两个 bug）**：
  - 标签随右键平移不动 → decorations 的标签/cellMarker 文本手算屏幕坐标漏了内容偏移（违反 MapTransform 唯一换算点契约）；已统一走 MapTransform。
  - 放大过阈值后元素闪回到标签位置 → 静态贴图 viewport 模式定位漏 contentOffsetX 且取景窗口没按"可见内容窗口"（cam.x−内容偏移）；已统一 viewCenterX 口径，period/viewport 两模式一致。
  - 地块全显 cell id → builtinLayers 的 `cellMarker:'id'` 调试遗留默认值；改 'none' + ensureBuiltinLayers 同步修复旧档。
- **卡顿包 1（`91135dc`）**：失效域拆分落地——geomRev 分域、pairEdgeCache 只订几何域、ensureRev 去 world 引用判断、环缓存键补内容指纹（setKey 可选）、端点拖动 move 阶段不再 touchWorld（projCache 591ms 级重建消除）。
- **100k 可行性结论**（详见「最近在处理的问题 0」）：平移/绘制/选中/悬停/编辑 CPU 侧包 1-4 可达标；**缩放动画达标依赖 GPU 后端**（RegionMesh/WebGL）；"手势期瞬态"方案按用户"不打折"约束**作废**。
- `npm run build` 通过；147/147 测试通过。

**上一轮已处理（2026-09-26，第十二次）— 测试修复整包 + 卡顿全盘分析设计**

- **测试修复包（`b0bbafa`）：147/147 全绿**（此前 7 红含 2 文件收集失败）。修根因不改规则：
  - 真 bug ×3：① `landSea` claimId/pickOld **双重占位**（preferred 分支不可达 → 每次重建 ID 漂移，选中/名字样式丢失）→ claimId 唯一占位点；② `heightToMeters` 浮点高度时代映射（整数模型下珠峰=38 万米、赤道均温 -619°C）→ 整数域映射（陆 0..8848 / 海 0..-11000）；③ `unified generateFromLayer` 分组失败吞源省 → 孤儿省，收尾挂接（共享邻接边最多的新元素，覆盖旧档残留 parentId）。
  - 陈旧测试迁移：height/hierarchy 的 layer filter `'height'→'landsea'`；networks/validate/perf 旧生成器 → `unifiedGenerate`（生产路径）；sphereVoronoi 极点规则 → 「极点归属最近站点的普通 cell」；prepareDisplayRings/projections 的孤儿导入（ownerPolygon/polarPoly）→ ring/* + projCache/polarCellIds 现行契约。
  - **culture.ts 退役**（第七轮条件「等用户要求改测试时删」达成，零引用删除）。
  - spike 断言从旧平铺多边形 0.75π 密度约定迁到结构不变量（相邻点 |Δx|≤π=unwrap 保证；近极大跨角是球面真实几何）——**规则适配已记入提交信息，供复核**。
- **卡顿全盘分析 + 设计 + 四包规划**：根因三条链（失效域/烘焙粒度/实时层）逐文件核实完毕，方案写在下方「最近在处理的问题 0」，**未动实施代码，等用户审方案**。

**上一轮已处理（2026-09-26，第十一次）— 技术债务整批清理（5 个整包）**

- **git 仓库建立**：基线提交（214 文件）+ `.gitignore`（node_modules/dist/dev.log/target/.DS_Store）；后续每包独立提交（共 7 个 commit）。
- **文档修正**：`RENDER_LOGIC.md` 模块表补 `path2d.ts`、删已不存在的 `ownerPolygon.ts` 行（`defaultExclusiveColor` 现居 `layer/style.ts`）；`DESIGN_ENTITIES.md` 配套引用改指现行契约（旧 REQUIREMENTS/DESIGN_SPEC 已归档）。
- **死代码清理**：`ui/chrome/` 并入 `ui/shell/`（GenDock/ProjectPanel/ViewDock/ValidatorPanel 迁移，引用改相对路径；无引用的 BrushHud/LayerList/StatusStrip 删除）；删 `FloatingPanel.svelte`+`panelStore.ts`（旧悬浮面板壳，零引用）、脚手架残留（`lib/Counter`、`assets/*`）、**`wasm-core/` 空壳**（16 行，与「明确不做 WASM」一致）、`web/scripts/` 19 个历轮 diag/patch 一次性脚本、`dev.log`、`dist/`。
- **`world.continents` 第二真相删除**（架构债）：大陆分组唯一真相 = landsea 层 continent `Region.cells`。删 `World.continents` 字段与序列化往返、死算法 `computeContinents`（与 `cellGraph.landContinentsCSR` 重复且零调用）；新增派生访问器 `landSea.continentCellGroups(world)`（顺序与 `cell.continentId` 一致）；`cell.continentId` 保留为笔刷多数票缓存（assignContinents 生成期 / rebuild 改归属后同步）；`borderCache` 大陆中心的 kind 判定统一走 `landSeaKindOf`。测试引用迁移：`w.continents` → `landContinentsCSR` / `continentCellGroups`（断言语义不变；`displayCompose.test` 移除已删 API `effectiveRegionCells` 的残留断言，同规则已由 `materializeParentCells` 的 `A.cells` 断言覆盖）。**旧档 JSON 的 `continents` 字段读取时忽略，无需迁移。**
- **一处实现：高度 12 档单源化**（架构债）：heightRegions 的 HEIGHT_BINS/LEVEL_NAMES/色表与 `layer/heightIntervals` 逐值重复、`heightToLevel ≡ heightToIntervalIndex` 重复算法——现全部从 `HEIGHT_INTERVALS` 派生（heightRegions 176→71 行，显示语义不变）。**连续渐变时代死配置链整链删除**：`heightFillMode`/`LayerExtraParams`/`defaultExtraParams`/`resolveLayerParams`/`LayerConfig.extra`/`World.layerRenderParams`/store 的 `layerExtraParams`/`setLayerExtraParams`（零读者、不进序列化、UI 无入口）。双份兼容别名收敛：`rebuildHeightRegions`/`heightKindOf` 只留 heightRegions 一份（tests 在用），store 改用真名 `rebuildLandSeaRegions`；死导出清除（heightRampColor/heightRampGradient/HEIGHT_COLOR_STOPS/heightColor/LAND_BASE_COLOR/levelTo* 等）。
- **layer.ts barrel**（架构债）：`GenConfig` 形状移入 `layer/genTypes.ts`（与枚举单源）；layer.ts 只留各层默认值；不留 re-export 门面。
- **TS 存量错误清零**（架构债）：svelte-check **23 → 0 errors**（4 条 svelte runes 提示保留）、tsc 1 → 0。其中**两个是被类型暴露的真 bug**：① `map2d.drawWorld` opts 缺 `gpuFill` 字段 → GPU 离屏填充通道从未激活（env 恒 undefined），补全转发后按设计工作（Canvas2D evenodd 兜底不变）；② `catmullRomPolyline` 丢 z → GlobeView 球面路径 hypot(NaN) **实际不可见**，现按同一公式插值 z（2D 输出形状不变，paths.test 的 toEqual 不受影响）。另修复：WorkspaceDrawer/ProjectPanel 解构漏声明回调（外交按钮附庸/敌/盟、高程图导入**此前断线**）；WorkbenchHost 重复 `onApplyPreset` ×2；`num()` 接受 input 的 string 值；App 对 TopBar 不存在的 `settingsOpen` 绑定 + `shell.settingsOpen` 死状态删除；Sheets `onGenerate` 补 `Number()` 解析；**孤儿组件 `SettingsDrawer.svelte` 删除**（零引用，被 Sheets 取代）；vite.config 改用 `vitest/config` 的 defineConfig。
- `npm run build` 通过；`npm run check` 0 errors。**按纪律未跑测试**。
- **需用户目视验收**：① GPU 填充边缘 vs Canvas2D 兜底一致性（回退杠杆：Viewport 去掉 `gpuFill` 传参一处即回退）② 球面视图路径/航路（此前 NaN 不可见，现应显示）③ 外交按钮（附庸/敌/盟）④ 高程图导入按钮。
- **两份测试已陈旧**（待用户拍板再改）：`heightRegions.test.ts`/`hierarchy.test.ts` 用 `layerId === 'height'` 期望海陆元素，海陆层独立后应在 `'landsea'`——规则仍有效，改 filter 即恢复。

**上一轮已处理（2026-09-25，第十次）— 渲染统一 + 过度设计清理 + 架构修复**

- **渲染统一（单一路径）**：删除 `drawHeightRegions`（每帧从 `cell.height` 临时重算 12 档）、`coastRingsFromHeight`（第二套海岸求环）、`isHollowRegion`（湖泊特判）。所有图层（含高度/海陆/湖泊）走同一 `Region.cells → cellSetBoundaryRings → drawPreparedElement`（fill→shadow→stroke）。高度区间本来就是 Region（`rebuildHeightIntervalElements` 造的 12 个嵌套 `cells`+`color`），不再特殊处理。
- **符号参数化**：`LayerDef.coreSymbol: 'star'|'square'|'circle'|'none'` + `cellSymbol: 'tree'|'none'` + `baseMesh: boolean`。`symbolsLayer` 读参数画，不再按图层名硬编码。新图层加 `coreSymbol` 即可，零渲染层改动。
- **陆海谓词收敛**：`isLand(cell)` / `isOcean(cell)` 在 `types.ts`，只在生成/绘制阶段调用。渲染阶段零高度判定。
- **cellColor = 元素填充**：`cellDisplayColor` 返回 Region.color，不再按焦点层名分支。
- **过度设计清理**：删 `ownerPolygon.ts` 兼容门面、`effectiveRegionCells`、`reorderRegions`、5 个 RenderEnv 死字段、5 个零引用 ring 导出、`render/perf.ts` 临时模块。`defaultExclusiveColor` 移到 `layer/style.ts`。`cell.height` 注释修正为 -63..64。
- **getProjCache 失效键**：不再按 world 引用失效（store 浅拷贝 `{…world}` 每次触发 591ms 全量重建），改按 `cacheKey`（seed/cellCount/proj/pp）。
- **笔刷增量**：`commitStroke` 的 Region 归属路径从 `touchWorld` 改 `touchRegions`（不碰投影缓存）。
- **静态贴图 viewport 模式**：period 贴图超预算时改烘焙视口+30% 余量（相机分桶失效），不再掉到每帧矢量直绘。1:1 不拉伸。
- **文档整理**：归档 `RENDER_ARCHITECTURE_ANALYSIS.md`、`RENDER_STYLE_PLAN.md`、`DESIGN_LAYERS.md`（v0.2 draft）→ `docs/_archive/`。根目录回到 AGENTS.md 规定的 5 份。`RENDER_LOGIC.md` 更新烘焙机制描述。新建 `ROADMAP.md`（不完善项与优先级）。
- TS 错误 47 → 18（全是既有类型问题，无新增）。**未跑测试**。

**上一轮已处理（2026-09-24，第九次）— 高度卡死 + 嵌套区间**

- **卡死根因**：`WorkspaceDrawer` `$effect` 读 `world.regions` 后 `rebuildHeightRegions` 写回 → 无限重建。海陆过滤还把 `kind=interval` 误判为大陆并删掉高度元素。已改为：过滤只认显式 continent/lake/ocean；effect 只补缺失区间且不在条件里写 regions。
- **高度区间 = 嵌套重叠（等高线）**：陆地 `hi > h`、海洋 `lo < h`；允许 overlap；`sharedCells` 大重叠只记 `sharedCount`（防关系计算爆内存）。
- **绘制边界等高线**：`drawHeightRegions` 按嵌套序叠画（海 h0→h3，陆 h11→h4）。

**上一轮已处理（2026-09-24，第八次）— P4–P8 图层体系落地**

- **海陆层独立**（`core/layer/landSea.ts`）：`landsea` 内置层；大陆/湖/海元素；`splitPolicy=newElement`（大陆分开=两陆）；**海洋 `manualSplit` 拆分持久化**；海岸=海陆元素边界（coast 通道退休）
- **高度 12 区间元素**（`core/layer/heightElements.ts`）+ **HeightDraw**（整数 ±1 / Shift±档 / Alt=0）
- **MembershipDraw**（`core/draw/membershipDraw.ts`）：placement 闸 + overwrite emptyOnly/replace + splitPolicy
- **ElementStyle** 仅 border/shadow(enabled)/fill；DisplayStyle 三通道；曲线层明示独立
- **LayerConfig 实例表**（`core/layer/config.ts`）+ **生成预设**（默认大陆/群岛/海国/高原）+ `allowOcean`
- 颜色卡已删（`HeightIntervalList`）；`heightRegions` 收敛为色阶 API + 笔刷辅助
- `npm run build` 通过；**未跑测试**

**上一轮已处理（2026-09-24，第七次）— 统一元素类 + 统一生成器**

- **`Region` = 统一 `LayerElement`**（不是子类体系、不是双份结构）：
  - 扩展字段：`adjacentElementIds?: Set<string>`（相邻元素）、`overlaps?: ElementOverlap[]`（complete/partial + sharedCells）
  - `core/layer.ts`：`type LayerElement = Region`；`GenMethod / GenScope / GenPattern / CoreSelector / GenConfig`；`defaultGenConfig(layerId)` 为各层默认配置唯一真相
  - 序列化：`adjacentElementIds` Set ↔ array（与 `weights` Map 同套路）

- **`core/generate/unified.ts` 统一生成器**（所有语义层共用，配置驱动）：
  - **method**：`diffusion`（高度场 stampContinent + rebuildHeightRegions；非高度层径向团）/ `randomConnected`（随机种子 + 连通扩展）/ `fromLayer`（聚合源图层元素，country←province）
  - **scope**：`oceanOnly` / `landOnly` / `noCrossLandSea`（扩展不跨海陆）/ `unlimited` / `fromLayer`
  - **pattern**：`partitionLand` / `partitionOcean` / `partitionAll`（多源 BFS 分区）/ `scattered`（多小块）/ `longStrip`（随机游走长条）/ `cluster`（紧凑洪水）
  - **coreSelector**：`centermost` / `nearBoundary`（边界 cell）/ `highElevation` / `lowElevation` / `random`（种子 rng，不再 `Math.random`）
  - 生成后统一 `computeRelationships`：相邻（共享边）+ 重叠（共享 cell，complete/partial）
  - `fromLayer` 自动 `materializeParentCells`（父 cells = 子并集）

- **各层默认配置**（`defaultGenConfig`）：
  | layer | method | scope | pattern | coreSelector |
  |-------|--------|-------|---------|-------------|
  | height | diffusion | unlimited | cluster | random |
  | province | randomConnected | noCrossLandSea | partitionLand | random |
  | country | fromLayer | landOnly | partitionLand | centermost |
  | environment | randomConnected | unlimited | scattered | random |
  | vegetation | randomConnected | landOnly | cluster | random |
  | fauna | randomConnected | unlimited | scattered | random |
  | race | randomConnected | landOnly | partitionLand | random |
  | culture | randomConnected | landOnly | cluster | highElevation |
  | religion | randomConnected | landOnly | scattered | lowElevation |
  | military | randomConnected | landOnly | longStrip | nearBoundary |

- **级联顺序**：height → province → country → environment/vegetation/fauna/race/culture/religion/military → river → road → route
  - **province 必须先于 country**（country = fromLayer 聚合 province，设 `parentId`）
  - `registry.ts` 全部走 `makeUnifiedGen` → `unifiedGenerate`；路径层（river/road/route）仍走各自生成器
  - `profile.ts` CASCADE_ORDER / defaultProfiles 与上述顺序对齐

- **调用点切换**：`store.applyNature` / `regenPolitical`、`WorkbenchHost` 重新生成本层 → `unifiedGenerate`；不再调用 `generateCountriesCost` / `generateCultures` / `generateReligions` / `generateVegetation` / `generateFauna` / `generateRaces` / `generatePolitical`

- **旧生成器保留原因**：`culture.ts` / `nature.ts` / `political.ts` 中旧函数仍被 **tests/** 引用（外部引用，按 AGENTS.md 可留）；应用主路径已不走它们。等用户要求改测试时再删。

- 本轮 `npm run build` 通过；**未跑测试**（用户未要求）。

**上一轮已处理（2026-09-24，第六次）**

- **实施 RENDER_STYLE_PLAN.md**：
  - **Step1**：`elementsLayer` 恢复到烘焙层（周期贴图优化不破坏）
  - **Step2**：`LayerRenderConfig` 扩展（cellFill/cellBorder/cellFillMode/cellBorderColor）+ `defaultLayerStyleFor` 各层默认样式
  - **Step3**：高度层修正（阴影从样式参数读取，cellFill/cellBorder 可控）
  - **Step5**：随机种子按钮（🎲）
  - **Step4 局部重绘**：cell 级脏区域追踪（`markDirtyCells` + `computeDirtyRects` 环形拆分）
  - **DisplayStyle 面板**：竖向悬浮（图层 panel 右侧）、全参数、👁「显示」按钮、实时同步
  - **高度色阶**：正态分布分箱（两端各 2 值，中间最多）；16 色块色尺 hover 显示范围

**上一轮已处理（2026-09-24，第五次）**

- **渲染架构三步走**（见 `RENDER_ARCHITECTURE_ANALYSIS.md`）：
  - **Step1 修 bug**：`MapTransform` 统一坐标接口（唯一 y 翻转点）；纹理覆盖范围 = 视口范围（`pixelH = TEX_SCALE * dpr * h / cam.scale`）；yOff 从 `MapTransform.yOffFor` 推导；纹理分辨率匹配屏幕（`TEX_SCALE = cam.scale * dpr`）
  - **Step2 性能优化**：`composeShownPieces` 记忆化（`dataRev + focusLayer + highlightRegionId`）；渐进分辨率（拖动/缩放 64px/rad、松手匹配屏幕）；缩放中关阴影
  - **Step3 架构升级**：多分辨率缓存（LOD，LRU 保留 4 级）；`TEX_SCALE = cam.scale`（匹配屏幕）；像素预算 16M；烘焙时始终完整质量（含阴影）

**上一轮已处理（2026-09-24，第四次）**

- **性能三连（绘制/缩放卡顿）**：
  - **A1 笔刷不重烘焙**：`drawPeriodicStatic` 只靠 `dataRev` key 判失效，去掉 `state.world !== env.world` 对象身份判断——笔刷期间 world 对象重建不再触发全量重烘焙
  - **A2 pairEdgeCache 按需失效**：纯几何边表只在 world 对象变化时失效，不随 height/regions rev 清空
  - **A3 高度纹理预烘焙**：逐格高度色烘焙到低分辨率纹理（≤4096²），区域内 `drawImage` 一次性贴图——替代 30k 次逐格 `fill`
  - 代价：笔刷过程中视觉反馈来自 brush cursor，commitStroke 后才看到最终高度色；pairEdgeCache 在 world 对象变化时仍全量重建

**上一轮已处理（2026-09-24，第三次）**

- **高度渐变渲染**：所有大陆统一底色 `#C4A882`（暖沙），高度差异由区域边界内的 **Canvas 渐变** 表达（非逐格填充，符合显示契约）。`heightColor` 改为返回统一底色；新增 `heightGradientColor` / `HEIGHT_COLOR_STOPS` / `DEPTH_COLOR_STOPS`。`drawPreparedElement` 的 `fillColor` 支持 `CanvasGradient`；`elementsLayer` 对高度层自动创建垂直渐变（低地深绿褐 → 高原暖沙 → 雪峰浅黄白）。工作区右侧新增 **HeightColorRuler** 色尺（选中高度层时显示）。

**上一轮已处理（2026-09-24，第二次）**

- **色差问题闭环（非 Bug）**：用户实测"大陆 1 比大陆 2 白"与湖泊数无关；最终定位为**数据层默认配色不同**——`heightRegions.ts` 的 `heightColor(Math.max(0.08, meanHeight(world, comp)))` 按大陆平均海拔给不同色，渲染层参数链（fillA × dp.opacity、layer.opacity ?? 0.88）两大陆完全一致，**不存在重复绘制**。教训已写入 AGENTS.md §8 坑 5：先打印两侧 `reg.color` 再查合成语义。是否改默认配色策略（同色 / 保留高度映射 / 调色板轮转）**用户尚未拍板**，不要擅自改。
- **AGENTS.md 已重构**：原"前半规则 + 尾部 100 行散文提示词"两块合并为统一 0–11 节结构（角色 → 六层模型 → 根因流程 → 显示契约/拓扑/叠放硬规则 → 交付纪律 → 反例清单 → 已踩过的坑十条 → 卫生 → 自检），硬约束零删除、重复合并。后续更新规则直接改这份，不要再追加散文块。

**上一轮已处理（2026-09-24）**

- 用户明确要求极点属于普通地块：`generateVoronoiCells` 改为全域蓝噪声撒点，不再强制两个极点站点或排除极区；`polarCellIds` 从 Voronoi 站点在极点方向的最大点积派生归属，旧档无需新增字段。`projCache` 只为这两个普通 cell 生成按自身周期顶/底框闭合的拾取路径，网格仍描真实边；删除无人调用的 `polarPoly.ts` 第二套实现。`borderCache` 按同一 cell 集求南北极归属，`normalize` 为绕行环选顶/底框虚边；`layers` 与 SVG 不再铺北极整幅底面。浏览器新生成 30k 世界，极点归属普通站点（纬度约 +89.37° / -89.43°），含极大陆的环均正常绕行并生成相应框边；生产构建通过；`npm run check` 仍为此前 46 错、4 警，本轮修改文件未见新增错误。没有运行测试；旧档、拖动与更多种子需继续用户目视验收。
- 用户此前反馈单周期贴图仍有色差与副本竖线。曾为北极归属加连续展开 evenodd 底面，现已由上条的普通极点 cell + 框边闭合替代；离屏贴图按设备像素唯一分配周期区间，余量只供采样；`dp.opacity=0` 保持透明。~~原用户报告的具体色差位置仍需复看~~ **已闭环**：色差根因是数据层默认色不同（见本轮第 1 条），非渲染重复绘制。
- 圆柱投影静态层改为单周期带接缝余量的离屏贴图：区域仍按同一 cellSet 环、evenodd 遮罩、真实边界及内阴影成像；右键水平平移只平铺画面，不再每帧重画多个世界副本。投影/数据/样式/缩放/垂直相机等变化重新烘焙；非周期、路径编辑及超出离屏画布预算时直绘，保持原精度。实时路径、符号、标签、拾取和固定外框仍按现行管线；SVG 保持矢量导出。~~本改动尚需浏览器目视验收极区大陆色差与接缝，不应宣称色差已解决~~ 色差已按本轮第 1 条闭环；接缝竖线已由后续整数副本去重修复。
- 用户继续反馈右键横向拖动后出现竖线与半幅整片填色。种子 `504781501` 的高度图层已用浏览器截图复现：右拖约 2.5 CSS 像素后，左侧被整片误填。根因是 `elementsLayer.elementCopies` 将 `contentOffsetX + k·period` 的浮点结果再分别 `±period`，用 `Set<number>` 去重会留下相差约 `4e-16` 的同一副本；evenodd 把重复路径当成两条环翻转填充。本轮改为先按整数副本索引 `k` 去重，再一次性计算坐标。相同种子、缩放和右拖后的截图中半幅误填及竖线消失。静止截图不能替代平移验收。
- 用户提供墨卡托种子 `504781501`，30,000 地块，`#14592` 横线、`#26099` 竖线。浏览器重生后两者及邻居都是海洋地块，不在接缝或极点；高度海洋的绕行环有首末相距约 5.78 弧度的假闭合，含北极大陆的多个世界副本在虚拟框边处可能重复叠色。本次改为所有绕行环的最后真实段连接相邻副本首点，再向南框补仅供填充的虚拟边；北极 cell 是否归属只决定 evenodd 底面。元素/海岸按同一环合成副本路径，填充和内阴影共用 evenodd 遮罩，SVG 同步按填充/真实描边分别输出。浏览器恢复该种子并在高度图层查看整图，原南侧贯穿横线与内部竖缝未再出现；旧项目和其他图层仍需用户实际目视验收。
- 上一轮保留全部有效共享边、球面先求边中点，并将缺边开链保持为开链；圆柱投影周期与环缓存失效已同步。但上一轮按区域极点归属逐环补框边的方法没有解决海洋带和世界副本接缝，已由本轮的周期环显示规则取代。
- 项目格式写出 v2，保存图层样式与 cellClimate；支持 JSON/gzip 导入；恢复有错不再按无存档处理；生成、导入、恢复经统一换世界入口清除旧交互与缓存；平面 PNG 按钮已接画布。
- 本轮 `npm run build` 通过；`npm run check` 仍为 46 个现存错误、4 条警告，没有指向本轮修改文件的新错误。按要求没有运行测试。
- **尚未处理**：拓扑整数索引格式及旧档迁移；生成 Profile/Worker/依赖单源；父子 Region 换父和撤销的收缩规则；2D/球面的绘制统一及剩余缓存键。不要把这些描述为本轮已完成，也不要以量化经纬度键修补拓扑。

**已对齐的契约（勿破坏）**

- `Cell.polygon` = 几何唯一真相；`sharedEdges` / 网格 / 拾取只派生  
- 球面 Delaunay = **3D 凸包 faces**（整数拓扑）→ `neighbors` + `sharedEdges` + 胞腔外心（**全局顶点表 snap**，与 polygon **同一 LonLat 引用**）  
- `Region.cells` = 归属真相（父含子并集；`materializeParentCells`）  
- `Region` = 统一 `LayerElement`（含 `adjacentElementIds` / `overlaps`）  
- 元素边界 = **边中点 Hermite**（`core/ring/hermite.ts` 唯一）  
- 填充 = 边界内 evenodd；中空本层不填、不铺底  
- 海岸 = 高度 continent/lake 的 **同一** cellSet 环  
- z 序：焦点层 > 列表上层根 > 列表下层根；同树子>父；**选中元素最顶**  
- 默认密度 **30000**；默认大陆 **穿极且贴一极**  
- 中键平移；**Shift+中键** 复制 `#id`（含未聚焦兜底）  
- 生成：**统一 `unifiedGenerate` + `GenConfig`**（method/scope/pattern/coreSelector）；province 先于 country  

**最近在处理的问题（优先继续）**

0. **拖动 / 绘制卡顿（当前最高优先）— 全盘分析与设计已完成（2026-09-26），待用户审方案后实施**

   **现象**（用户原话）："拖动、绘制的卡顿太严重了，在不损失功能和显示的情况下避免卡顿；现在右键左右平移拖动完全不卡顿"——右键横向平移（period 贴图平铺）流畅；卡顿集中在**笔刷绘制、滚轮缩放、放大后平移、路径端点拖动**。

   **根因**（六层模型第 5 层：渲染临时几何/缓存失效，三条链，均已逐文件核实）：

   **链 A 失效域过粗**：
   - `store.endpoint` 路径端点拖动 **per-move 调 `touchWorld()`**（store.svelte.ts:1118）= 每 tick `invalidateProjCache + invalidateBorderCache + invalidateStaticLayer + bumpAllRev`；projCache 重建 O(N)（30k ≈ 591ms）→ 拖端点即冻结。而 `dragRoadEndpoint` 只改 `region.endpointOverrides`（regions 域），属杀鸡用牛刀。
   - `touchRegions/touchHeight`（每次笔刷提交）都 `invalidateBorderCache + invalidateStaticLayer` → 边界环全量重链 + 贴图全量重烘。
   - `borderCache.ensureRev` 按 **world 对象引用**失效（`world !== cachedWorld` 即清 ringsCache）；store 每次 touch 浅拷贝 world → 引用链式失效；`pairEdgeCache` 同样按引用（此前"只随 geom 失效"未真正落地）。
   - 静态贴图 key 含 `dataRev + pieceSignature + highlightRegionId` → 点选元素也全量重烘。

   **链 B 烘焙粒度过粗**：
   - `invalidateStaticLayer` 清空整个 LRU（4 state）；脏矩形机器（`markDirtyCells/computeDirtyRects` 环形拆分）已有，但**只有样式面板用 `'all'`**——笔刷从不标记脏 cell，每次提交全量重烘。
   - 滚轮：`TEX_SCALE = Math.round(cam.scale)` 进 key → **每 tick 全量重烘**（`zoomEndTimer` 只切 `zoomingLive` 标志、不延迟烘焙）→ 缩放顿挫 ~100ms/tick。
   - viewport 模式（放大）：camBucket 0.3w 分桶，跨桶即新 key 重烘 → 放大后平移周期性顿挫。

   **链 C 逐帧实时层成本**（管线 bg,cells,cellsMesh,elements 烘焙；paths,decorations,frame 每帧）：
   - `pathsLayer` 每帧每路径 `projectPt + catmullRom(10)` + 双遍描边（河逐段双描），无缓存。
   - `decorationsLayer`：tree 逐 cell 画且**无 viewIndex 视口裁剪**（植被层放大 = 1 万+ 图标/帧）；标签 `regionCenter` O(region.cells) + `measureText` 每帧每区域。
   - hover 空划：`hitTest → hoverId → $effect → requestRender` = 无按键划过也全图渲染。
   - （更正：阴影已非 8 遍——layers.ts:444 现为单遍 clip+blur；ROADMAP P0 首行过时。composeShownPieces 记忆化也已修。）

   **设计原则**（红线不破）：
   1. 失效按域：**geom**（cell 几何）/ **data**（height+regions）/ **style** / **view**（相机桶）；每个缓存只订阅自己的域。
   2. 缓存键按 rev 订阅，**不按 world 对象引用**（引用链式失效是根）。
   3. 重烘焙按脏集：笔刷提交只重烘脏矩形（机器已有，接线）；手势期间 blit 旧贴图（瞬态），停手一次性全质量 1:1（终态不打折；"不永久降分辨率"允许瞬态——与笔刷期 brush-cursor 反馈同一模式）。
   4. 实时层只做**等价降本**：路径 poly 缓存投影空间（points rev+proj 失效）、每帧仿射到屏幕；装饰过 viewIndex（视口外不画 ≠ 抽稀）；标签 measureText/regionCenter 记忆化。
   5. 显示不打折：不抽稀、不关阴影、不降 smooth、终态 1:1。

   **分包规划**（每包独立验收 + §7.2 反例清单；顺序 1→2→3→4）：
   - **包 1 失效域拆分 + 键去引用化** ✅（`91135dc`）：geomRev 分域；pairEdgeCache 只订几何域；ensureRev 去 world 引用判断；环缓存键补内容指纹；端点拖动 move 阶段 touchWorld→touchPaint。
   - **包 2 烘焙增量** ✅：同布局旧贴图作底 + 脏矩形重绘（copy-source）；笔刷归属提交标脏 stroke cell、高度提交拓扑翻转全量/微调标脏；选中变化只标脏新旧选中元素（不全量重烘）。
   - **包 3 实时层降本** ✅：paths poly 投影空间缓存（points 签名+投影为键，跨帧/跨副本复用）；tree/cellMarker 视口 bbox 裁剪（baseMesh 全量走惰性迭代）；标签 measureText + regionCenter 记忆化。
   - **包 4 hover 只刷 overlay** ✅：hoverId 移出地图渲染 effect，空划不触发地图管线。
   - ~~手势期瞬态~~ **已否决**（用户约束：零显示打折）：缩放维持逐格全质量烘焙，达标依赖 GPU 后端。

   **100k 级 cell 可行性（用户要求评估；约束：不卡顿 + 零显示打折）**：
   - **可达成**（CPU 侧包 1-4 落地后）：平移（period blit 与 cell 数无关）、笔刷绘制/提交（命中查询 + 脏矩形增量）、选中/工作区、悬停（包 4 后走 overlay）、编辑操作。30k→100k 下这些路径的成本随**视口内** cell 数增长，不随总数增长。
   - **缩放动画是唯一卡点**：全质量约束下每格需全量重光栅；CPU Canvas2D 单次全图烘焙 100k 量级数百 ms（30k 已 ~100ms 级），逐格执行必掉帧。**唯一达标路径 = GPU 后端**（ROADMAP P0 的 RegionMesh/WebGL：填充/描边/阴影走 GPU，100k 全图重光栅 ≈ 数 ms，缩放 60fps 全质量）。CPU 缓解（非达标）：visited-scale LRU（复访即时）、烘焙移 Worker（主线程不卡、动画仍受限吞吐）。
   - 初次生成/加载：生成已走 Worker；projCache 首建 ~2s@100k（一次性，可 Worker 化）；首次烘焙一次性。
   - **结论**：目标可达，路线 = CPU 包 1-4（本轮起）+ **GPU 后端立项**（下一轮出 RegionMesh/WebGL 设计：三角化缓存 + per-vertex 属性 + 保 RENDER_LOGIC z 序的合成序）。GPU 落地前缩放维持现状（慢但不糊）。

1. ~~**应邻接的 cell 顶点仍可能不重合**~~ **已做：生成侧全局顶点表**  
   - 根因：凸包对偶近重合外心 + per-cell first-wins 去重 → 同一角两个坐标  
   - 已做：`createVertexSnap` 全局焊接 → polygon / sharedEdges **同一 Vec3/LonLat 引用**；短 Voronoi 边塌缩则丢退化边；`rebuildSharedEdges` 去掉 0.05° 糊焊且端点同引用  
   - 实测 seed=42/800：独有顶点 0；sharedEdges 端点均在两侧 polygon；serialize 前后一致  
   - projCache 0.01° 表仍作显示 unwrap，不得再当几何焊接层

2. **30k 生成仍偏慢 / 进度**  
   - 已换凸包 Delaunay、分段进度、Worker、stripSharedEdges 回传  
   - 若仍卡：标定是 Worker 串行 JSON 还是 height/cascade；整包优化，不降画质  

3. **外框 vs 静态合成**  
   - 外框与 `beginWorld` 同矩阵；静态缓存（bg+mesh+elements）已开  
   - 若再错位：只修坐标系单源，禁止手算屏幕矩形第二套  

4. ~~**三角缝（三 cell 夹缝）**~~ **接 1 已做**  
   - 角点已全局焊接；剩余「邻接只共 1 点」= 短边塌缩（合法点触），不是裂缝

5. **极点 cell 与框边闭合（本轮）**
   - 全域正常撒点，南北极分别由最近站点所属 cell 覆盖；只在圆柱显示侧沿完整周期接上顶/底框虚边，真实网格边独立描绘。
   - 删除旧的 `polarPoly.ts` 与纬度阈值判断；极点归属从站点导出，与存档中的 `Cell.center` 一致。旧档仍保留其原站点与拓扑，不静默重生。

6. **墨卡托周期环（本轮）**
   - 球面环在相邻世界副本结束真实段，绕行环按同一 `cellIds` 的极点归属向顶/底框补虚边，不再增加 evenodd 底面；唯一例外是全世界 cell 集没有外边界，直接填充全框（画布与 SVG 同口径）
   - 画布同一元素的副本合成一次填充/阴影/描边；旧的 `nearPole` 阈值与逐环 `poleSide` 不再是现行设计
   - 验收：种子 `504781501` 的两处线、两极大陆、海洋带、跨日界线、地图横向拖动，以及 SVG 导出

7. **统一生成器调参（本轮后续可做）**
   - `defaultGenConfig` 的 names/colors/count 可再丰富；profile 面板可暴露 method/scope/pattern/coreSelector
   - 旧生成器（culture/nature/political）待测试迁移到 unified 后删除
   - `generateDemoContinents` 的 stamps/falloff 尚未接到 profile.params

**明确不做**：per-cell 语义填色；第二套海岸/边界管线；显示抽稀；WASM（除非用户点名）。

**工作方式**：一次只推一个整包；用户要 test 再 test；要 F12 堆栈再让用户提供。
