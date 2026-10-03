# Mapedi 优化项全面盘点（2026-10-04）

> **性质**：快照式盘点（冻结只增，后续状态变化写新条目不回头改）。
> **时机**：手感批（`ed10480`）、金钮看门狗（`c14c764`）、拍板 8 项决议批全部收口后，
> 按「各方面审查」清点全部剩余优化项。**下一阶段重心 = 用户使用（§7）**，本文档 §1–§6 是支撑面清单，不阻塞 §7。
> **当前基线**：tsc 0 · svelte-check 0 errors（5 存量 warning）· vitest 29 文件 / 152 用例全绿 ·
> 100k 主线程生成 7.96s · 交互帧 p50 1.1ms · GL 提交 0.2ms。

---

## 1. 手感与交互

**本阶段已落地**（不再列）：闪根治（全清→渲染前对账补丁）、全局按压缩放、视图切换 dip+进场动画、
球面懒加载预取、金钮滑动+冻结看门狗、面板展开→对准剩余空间中心、种子输入全分支。

| # | 残余项 | 价值 | 成本 | 备注 |
|---|--------|------|------|------|
| 1.1 | **autosave 克隆抖动**：每次存档 `postMessage` 结构化克隆整个 world ≈250ms 主线程（2s 防抖后突发） | 高（每次编辑后一顿） | 中 | 方向=存档镜像常驻离线程/列式化；动存档链路需专门验收轮，**建议下一包单独做** |
| 1.2 | 滚轮缩放 1.1 倍一跳、无平滑补间 | 中 | 中 | 动缩放锚点数学，必须 stash 像素 A/B 验收 |
| 1.3 | 展开区展开/收起无高度过渡（内容已有进场动画） | 低 | 低 | max-height 动画，收益小 |
| 1.4 | `dragPathIdx` 位置索引，undo 后错指 | 中 | 低 | 已知问题表在案；随路径编辑命令化 |
| 1.5 | 撤销后父层物化残留（+16 实测，预存） | 中 | 低 | 修法=undo 后补物化；随历史面板包一起 |
| 1.6 | 缩放重烘焙顿挫 ~100ms | 中 | 高 | 已知问题表"暂接受（归卡顿包）" |

## 2. 性能

**基线达标项**：GL 提交 0.2ms、交互 p50 1.1ms、生成链 7.96s（UI 走 Worker 更快）、compose 冷算 0ms（件级）。

| # | 项 | 位置（行号） | 说明 |
|---|----|----|------|
| 2.1 | 每帧微分配残余 | `layers.ts:306`（out 数组）`:326`（styleByLayer Map）`:317→496`（elementCopies Set+spread+sort）；`decorationsLayer:698/706/746`（MapTransform/闭包/occupied） | 步骤6 已销大头，剩这些；p50 已1.1ms，**收益边际，勿提前优化** |
| 2.2 | compose 单槽冲刷源 | `touchPaint` 每 tick 换身份（`changePipeline:105`）；`warmLayerGeometry` 逐层不同 focus 调用冲槽（`map2d:129`） | 笔画中每3帧一次全量重算；若有体感卡再动 |
| 2.3 | 件键字符串每帧拼 ×2 | `layers.ts:346` + `borderCache.ts:196` | 字符串池化/缓存 key 字段，微优化 |
| 2.4 | compose 未命中 O(layers×regions) | `displayCompose:288-315`：同层 `displayAncestors` 调两次、`regionsWithCells` 全扫 | 实测件级 0ms，规模上去（数千元素层）才需动 |
| 2.5 | 球面重建 O(cells) 分配 | `GlobeView:118-129`（三全量数组+逐 cell clone/lerp） | 仅重建时付；切视图已有预取+进场动画掩盖 |
| 2.6 | 序列化体积：cells+region.cells 全量 JSON | `world.ts:343-371` | 无列式/差分；若存档变大（100k+ 区间）再立项 |

## 3. 架构与死码（「删就真删」候选，分三档）

**甲档=零风险可立即删**（src+tests 双零引用，纯死代码）：
- `core/astro.ts` 大片：`setMoonPeriodValue`/`orbitPosAt`/`orbitPoint`/`moonOrbitScene`（+12 个仅测试用导出随 astro 测试包一并判）
- `render/cellColor.ts` 整模块（`buildFillsForFocus`/`cellDisplayColor`，GL 接管后遗留通道）
- `core/heightmap.ts:8 applyHeightmapFile`、`runGenerate.ts:77 loadWorldSync`
- `core/layer/heightIntervals.ts` 三个死导出（`stepHeight`/`stepLevel`/`setHeightToInterval`）
- 零散双零：`paths.projectClickToPolyline`、`PROJ_META`、`unprojectMercator`、`riverSegments`、`sphere.normalizeLon`、`rev.resetDataRev`、`profile.profileFor`、`cellGrid.gridReady`、`hierarchy/derive.layerDepthOf`、`heightDraw.heightIntervalList`、`brush.regionWeight/shareCellsWithOthers`、`incremental.seedBoundaryBook`、`voronoiSphere.lloydRelax/polyToLonLat`、`storage.distanceKm`
- 仅同文件用的多余 `export` 收敛（`buildRenderEnv`/`projectPt`/`endWorld`/`decorationsLayer`/`readWsMode`/`SLOT`/`CAM_SCALE_MIN·MAX`/`EditorStore` 等）
- 注释里的已删标识残留（`CASCADE_ORDER`/`HeightStrokeCommand`/`ElementInfoPanel`/`fromLayerId` 注释行）

**乙档=tests-only，删须随测试迁移**（动前先想测试业务规则去哪）：
- `political.generatePolitical`（7 个测试文件的国/省夹具）→ 若迁 `unifiedGenerate` 夹具可删整模块
- `validate.validateWorld/fixIssue`（"自动校验+toast"未落地——**归用户阶段 E 项**，落地后变成活码）
- `astro` 12 个导出（随 astro 测试裁定）、`political.childrenOf`（仅测试）

**丙档=观察保留**：`reparentElement` 注释说"未来手动挂靠入口共用"（D4 挂靠已用它 ✓ 是活的）、
`heightIntervals` 占位（区间型数据驱动滑块）、R7 路径占位（用户已定先不做）。

## 4. 正确性与存档

| # | 项 | 说明/建议 |
|---|----|-----------|
| 4.1 | **序列化无字段白名单**：`deserializeWorld` 的 `...r` 展开让已删字段（exclusiveColor、外交键）永久往返残留 | 建议：载入清洗并入 `repairHierarchy`（已有先例+报告通道），一次迁移 |
| 4.2 | `attributes` 无 schema 的键袋（8+ 处写入点，键名可能撞车） | ARCH_REVIEW 已记；方向=显式字段或命名空间前缀 |
| 4.3 | formatVersion 只认 1–2，v3+ 直接 throw 无迁移 | 现在改任何数据结构都过不了这道闸——**做破坏性改动（如海陆案A）时应顺手建立 v3 迁移通道** |
| 4.4 | 空 catch 13 处（渲染/UI 全静默，排查只靠全局 onerror） | 低成本：给"有状态副作用"的 catch 补一行 console.warn（autosave 链已有 status 文案，可不动） |
| 4.5 | 已知问题观察项（ROADMAP_REFACTOR 表）：路网校验早退归零分支（用户世界 paths=0 待点名查）、GL scissor 1px 缝、Robinson 双周期语义脆弱 | 按表观察；路网那条**等用户点名** |

## 5. 测试覆盖

- **现状**：29 文件 / 152 用例；**107 个 src 文件中 68 个零覆盖**——`app/*` 服务层全空、`render/gl` 全空、`ui/*` 全空（virtualList 除外）、`core/hierarchy/policy`、`core/layer/palette`、`persist` 全空。
- **建议固化顺序**（价值/成本比，浏览器已人工验收的直接转成用例）：
  1. `hierarchy/{ops,policy,gate}` — 缩进/提升/挂靠/删除策略/读档修复，浏览器 E2E 全做过，纯函数好写（**最高性价比**）
  2. `palette`（tintOf/colorAt 确定性）+ `registry.cascadeOrder`（拓扑序==旧序）
  3. autosave 防抖/epoch 作废（autosaveService）
  4. `borderCache.reconcilePieceMembership`（补丁往返）——手感批的核心机制目前只有浏览器探针
- **已知盲区（诚实声明）**：无 UI 自动化、无渲染像素级回归进 CI；现有防线 = 手工 stash A/B + 稳定帧序列法。

## 6. 功能有实现、无入口（「半成品」清单——用户阶段最速见效的宝藏）

引擎/命令都写好了、只差按钮的：（详表，按感知价值排）

| 功能 | 实现位置 | 现状 |
|----|---------|------|
| **元素搜索** | `store.runSearch/focusSearch` + `storage.searchRegions` 成品 | 无输入框；跳转链路（选中+对准）现成 |
| **测距工具** | `store.toggleMeasure` + measureA/B 状态 | 无按钮（ROADMAP P2 列了） |
| **吞并（吃掉相邻元素）** | `commandService.doAnnex` + `annexPick` 挑选态 | 右键菜单删过入口，命令还活着 |
| **洪水填充 / 设中心** | `drawController.flood/setCenterAt` | 零 UI 调用 |
| **手动挂靠** | `ops.reparentElement` + 检查区「挂靠」按钮 | ✓ 已接（D4）——作为接线范例 |
| `setLayerOpacity` | 单层不透明度 | 无滑块（UI 走样式组 fill.alpha，功能重叠→建议删） |
| `setDrawTool` 手动切笔刷/道路 | drawController | 现按层自动选，无手动入口（场景少→建议删或并入工具带） |
| astro 五个写入口（setAstro 等） | store | 孤儿（climate/astro 无 UI）→ **删**（ROADMAP 在案） |

## 7. 用户使用阶段（下一阶段重心）——建议排布

> 以下是我按「感知价值 ÷ 成本」排的**执行顺序建议**，不是待拍板清单——你点名任何一项即做；
> 不点名则按此顺序推进。

**第一梯队（把半成品接上，每项都是"按钮出现就有用"）**
1. **元素搜索**：图层/元素列表顶部搜索框 → 过滤 + 回车跳转选中（骨架全有）
2. **测距**：状态栏/工具带加测距开关 → 画布点两点显示距离（骨架全有）
3. **吞并入口**：选中元素 →「并入…」进入挑选态 → 点目标完成吞并（命令全有）
4. 错误可见化：`validateWorld` 自动校验 + toast（ROADMAP 老约定，现在空 catch 多、用户看不到发生了什么）

**第二梯队（地图基本要素 P0 + 显示补完）**
5. 📏 比例尺 + 🧭 指南针 悬浮 panel（右下角，随投影/缩放动态）
6. 球面补完：球面悬停/标签（现在只有平面有）、球面填充 Hermite evenodd（显示契约对齐）
7. 名称排布质量：区域名贴区域、河流名沿曲线（现=质心+矩形避让）
8. 成图排版导出（图框/标题/图例——需要设计稿，工作量最大）

**第三梯队（编辑体验）**
9. 多选/框选批量编辑
10. 历史面板（撤销栈可视化，接已收敛的命令体系）
11. 路径生成 R7（**你已定先不做**，列此仅为完整）

**同时并行的技术线（不占使用侧注意力，按包推进）**
- 存档镜像离线程（修1.1抖动）→ 死码甲档清理（§3）→ 序列化字段清洗+版本迁移（§4.1/4.3）→ 测试固化第一梯队（§5.1-2）

---

## 附：本盘点的验证手段
- 死码判定 = src+tests 双向 grep（含注释）；性能数字 = 页面实测（`__drawSamples`/scratch 基准）；
- 覆盖率 = 测试文件反向索引 src；手感 = MutationObserver/timer-lag/看门狗探针（方法论见 HANDOFF 验证方法论节）。
