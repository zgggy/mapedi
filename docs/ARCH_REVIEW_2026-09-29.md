# Mapedi 全库架构评审报告 · 2026-09-29

> **定位**：现状风险与技术债完整清单 + 还债顺序建议。不是新需求方案。
> **方法**：只读评审——状态/UI、核心数据/序列化、渲染管线三路并行深读 + 交叉验证；按工作区现状评审（含未提交的 `ring/build.ts` 环定向重构，其质量单独评述见 §4）。
> **透镜**：AGENTS.md 显示契约 / 拓扑硬规则 / §7.2 反例清单；未来"叙事编辑器"需求仅作扩展性透镜（§5），不作为评审对象。
> **对照**：`ROADMAP.md` 的架构债一节只保留滚动状态，本报告是当日的全量证据快照。

---

## 0. 总评

内核优秀、外壳承压。

- **做到了的**：拓扑单源契约在源头真实成立；环语义单源（Hermite / 求环各一处）；rev 计数失效纪律贯彻；增量缓存架构完整且有事故复盘注释；triangulate 三层语义等价兜底是库内最稳一环；零 TODO、零 `as any`、29 测试文件 147 用例全绿。
- **没做到的**：**变更纪律（谁改数据、改了记不记、能不能撤）没有闭环**——它已经产生静默状态腐蚀（§1.1），且是未来任何需求（历史面板、叙事时间线、多时代）的地基缺口。
- **两个结构性压力**：`store.svelte.ts`（1,640 行 ≈12 组职责）与 `Viewport.svelte`（1,255 行）两块巨石；渲染与应用层耦合方向倒挂（Viewport 反向 import store 消费私有队列）。
- **一处单点可用性风险**：GL 是唯一后端，失败即永久黑屏，无恢复、无降级（§1.2）。

一句话：**"显示完美"已做到，"架构简洁"在内核做到，"数据怎么改"这条主线还停留在约定层面。**

---

## 1. P0 —— 正在产生错误状态或单点故障

### 1.1 变更纪律未闭环：撤销系统是"半套"，undo 已能腐蚀数据 ⚠️ 全库最严重

**(a) undo 静默腐蚀（正确性 bug）**

主编辑路径上，笔刷/flood 的跨元素副作用不入命令栈，提交只记录目标元素的增减：

| 副作用 | 位置 | 后果 |
|---|---|---|
| replace 模式剥其它 owner 的 cell | `core/draw/membershipDraw.ts:107-112` | 撤销后原归属元素**永久丢 cell** |
| `stealFromSiblings` 直改兄弟元素 | `core/draw/brush.ts:123-141`；flood 路径只记 add：`store.svelte.ts:1393-1404` | 同上 |
| `applySplitPolicy` 直接 push 新 Region | `core/draw/membershipDraw.ts:170-179` | 撤销后拆分克隆残留 |
| `resolveDrawTarget` 自动建行省 | `core/draw/brush.ts:77` | 撤销后自动建的元素残留 |

提交点只还原 `PaintCellsCommand`（`store.svelte.ts:1284-1291` 采集、`:1367` 提交）。对照组：`AnnexCommand` / `DeleteRegionCommand` 都正确处理了跨元素副作用（COW 快照 + 外交清扫，`core/history.ts:153-245`）——**命令系统知道正确做法，笔刷路径没有走它**。撤销一次 replace 笔画后，地图停在"既非改前也非改后"的状态，且随 autosave 落盘。

**(b) 大量编辑操作根本不入栈（第二套"改数据"路径）**

- 路径编辑全程无 undo：`ui/Viewport.svelte:886-891`（双击提交路径直改 `world.paths`）、`:938`（清 paths）、`:968 / :1000 / :1018 / :1057`（拖控制点直改 `points`）。
- `App.svelte:426-432`（元素信息保存直改 name/color/attributes）、`:436-456`（diplomacy 直调无命令）。
- `WorkspaceDrawer.svelte:195`（组件 `$effect` 内 `rebuildHeightIntervalElements(world)`——组件副作用改核心派生数据）。
- store 内绕过 history：删路径 `:675`、显隐 `:694/701`、图层排序 `:717-721/743-747`、复制 `:761/776/801`、删层 `:816-818`、建层 `:850`、样式 `:899-900`、图层拖拽 `:1009-1064`、建路径 `:1092-1124`、改名 `:1160`、climate/astro `:1455`、astro 补丁 `:167-201`、道路端点拖动 `:1420-1437`（+ `core/draw/roads.ts:56-77` 整段）。

可撤销与不可撤销之间没有用户可感知的规则；ROADMAP 登记的"缺撤销 UI"只是冰山一角。

**(c) 命令不可序列化、纪律无强制**

`PatchRegionsCommand` 持 `capture/restore` 闭包（`history.ts:267-281`）、`HeightStrokeCommand` 持 `afterApply/afterRevert` 回调（`history.ts:57-74`）——命令存不进文件，栈纯内存、limit 80（`:286`）。没有任何 lint / 测试强制"编辑必须走命令"。

**修复方向**（对应 §6 步骤 1）：
1. 先修腐蚀：笔刷提交补记**所有**被 steal/split/replace 触及的元素（可泛化一个多元素补丁命令）；
2. 高频直改路径命令化（路径编辑、图层树、显隐、改名、样式、外交）；
3. 命令纯数据化（判别联合 + 外置应用器），为持久日志 / 时间线铺路。
**验收基线**：每类编辑操作撤销后 world 与改前逐位一致（可复用"输出逐位不变法"做断言）。

### 1.2 GL 后端单点：失败即永久黑屏，无恢复、无降级

- `webglcontextlost` 只置 `failed=true`，**无 `webglcontextrestored` 监听**（`render/gl/mapRenderer.ts:242-246`）；
- 任何渲染异常（含 `:513-516` 一次"非纯色样式"的瞬态错误）也永久 `failed`（`:332-336`）；
- `ensureMapGl` 对已存在但 `ok=false` 的实例**永不重建**（`ui/Viewport.svelte:682-688`）；
- `render/map2d.ts:251` 在 `!glReady` 时直接 return——**连本不依赖 GL 的 2D 余量层（路径/地名/图框）也不画**；
- Canvas2D 后端已归档（`map2d.ts:244`），`gl-fail` 提示只覆盖初始化失败（`Viewport.svelte:875-877`）。

GPU reset、驱动切换、一次瞬态异常 → 地图全空直到刷新页面。Canvas2D 归档时失败路径没有重新设计。

**修复方向**（§6 步骤 2）：监听 `webglcontextrestored` 重建资源；异常分类（瞬态重试 vs 致命提示）；`glReady=false` 时仍画 2D 余量层；`ensureMapGl` 允许重建。
**验收**：F12 手动 `WEBGL_lose_context.loseContext()/restoreContext()` 后地图自愈。

### 1.3 cellClimate/biome：注释说"可重算缓存"，实际被当真相消费

- 声明：`core/types.ts:193`"可重算，不必当真相持久化"；
- 实际：`serializeWorld` 无条件保存（`core/world.ts:404-406`）；nature 生成直读（`core/draw/nature.ts:66`）；GeoJSON 导出 biome（`persist/storage.ts:267`）；`biomeAt` 带 `??` 回落（`biomes.ts:102`）；
- 重算只有手动入口 `applyNature`（`store.svelte.ts:1455-1467`）。

高度笔刷改地形后群系/气候**静默过期**，且随存档带进下次会话。同一概念两种身份，是 AGENTS §8 坑 1 的种子。

**修复方向**（§6 步骤 4）：二选一，不许维持现状——
(A) 真缓存：序列化不存，加载后按需重算（Worker 化，与注释声明一致，**倾向此案**）；
(B) 承认真相：改契约，把"高度变更触发重算"纳入 touch 失效管线。

### 1.4 存档链路整体乐观：零深层校验 + 静默失败

- `deserializeWorld` 深层零校验：整包 `JSON.parse(json) as {...}` 断言（`world.ts:414`），浅校验仅 4 个 is-array（`:432`）；不查 cell.id 连续性、polygon 长度、neighbors 越界。结构合法但内容坏的档直接通过，崩溃延迟到渲染深处，再被全局兜底吞成"已忽略"（`main.ts:30-31`），根因不可见。
- autosave 每 2s **主线程同步全量 stringify**（10 万 cell 几十 MB 级，`store.svelte.ts:608-624`），失败只写状态栏、无重试（`:619-621`）；反序列化失败静默回退（`:639`）。
- idb `db.close()` 不在 finally（`storage.ts:25-46`，异常时句柄泄漏）。
- 好的一面：JSON.parse 抛错路径有 bootError 且不覆盖旧档（`App.svelte:108-114`）。

**修复方向**（§6 步骤 3）：load 后结构断言（id 连续 / neighbors 越界 / polygon≥3）+ 明确报错；autosave 挪 Worker + 失败可见化与重试。

---

## 2. P1 —— 高成本技术债（约束开发速度与性能上限）

### 2.1 `store.svelte.ts` 上帝模块（1,640 行，≈12 组职责）

| 职责组 | 行号 |
|---|---|
| 响应式状态袋 + ~40 对 getter/setter | 102-127, 130-224 |
| astro/日历补丁（`{...world}` 身份换新 4 处重复模式） | 162-202 |
| touch* 失效分层管线 + 增量补丁队列 | 252-426 |
| 生成管线（worker+主线程双路、seq 守卫） | 428-538 |
| 生成参数/预设/profiles | 540-606 |
| 持久化 + 4 种导出 + 搜索 | 608-651, 1540-1574, 1592-1615 |
| history 门面 | 653-668 |
| CRUD 命令 | 670-864, 1077-1174 |
| 选择/焦点/显隐（含"3 颜色根树"业务规则） | 871-995 |
| 图层树与元素拖拽 | 998-1075 |
| 绘制会话 + 笔刷 + 提交 | 1176-1247, 1249-1389 |
| 洪水/道路端点/自然重算/校验/测距 | 1391-1538 |

**耦合方向倒挂**：`Viewport.svelte:49` 反向 import store，并在 render() 消费其私有补丁队列（`:710-734`）——渲染层↔应用层双向耦合；`App.svelte` 沦为 ~60 个回调的转发器。
**自然拆分边界**：UIState / ChangePipeline（touch*+consume*，已半成形，最先拆）/ CommandService / GenerationService / Persistence / DrawController。core→store 无反向依赖（好）。

### 2.2 `Viewport.svelte` 巨石 + 三处已失联信号

1,255 行内塞了输入路由、路径编辑领域逻辑、GL 生命周期、缓存、队列消费。已发生的失联（不是假设，是现状 bug）：

- `canPaint` prop **App 从未传入，恒 false**（`Viewport.svelte:57`，`App.svelte:173-197` 无此 prop）；
- `onpaint` 转发丢参：Viewport 传 6 参（`:277`），App 只转 4 参（`:191`）→ store.paint 的 `button===2→右键擦除` 分支**不可达**（`store.svelte.ts:1249-1256`）；而 `startHeightDraw:1208` 的提示文案仍宣称"右键擦除"——**提示与行为矛盾**（右键实际被 content 平移占用，`Viewport.svelte:923`）；
- `panningMode:'cam'` 分支从未赋值（死代码，`Viewport.svelte:119`）。

其余：`dragPathIdx` 是 world.paths 的**位置索引**（`:1002/1019`），undo/删除后错指（`hidePathId:773` 错隐）；补丁队列在球面视图无人消费、无限增长（`:710-734`）；`cam`/`toScreenXY` 组件私有——**任何 DOM 覆盖层拿不到坐标变换 API**。
**修复方向**：抽 `MapTransform` / `ViewportController`；renderOverlay 拆为可注册 overlay 列表；修三处失联。

### 2.3 无模式状态机

编辑态 = `draw.active`（store）∧ Viewport 本地十来个布尔（panning/panningLive/painting/spaceDown/pathEdit/zoomingLive/dragPtIdx/pathDraft…）∧ 死 prop `canPaint`。判定散布 ≥7 处：`Viewport.svelte:491/532/932/1071/1172`、`WorkspaceDrawer.svelte:240-245`（选中即 startDraw）、`App.svelte:371-376`。加任何正交顶层状态（浏览模式、叙事模式）都要逐点插判定。
**修复方向**：store 引入单一 `mode` 真相，`draw.active` 变派生。

### 2.4 逐帧热路径残余 O(n) / 分配

| 热点 | 位置 |
|---|---|
| `buildPieceParams` 每帧 `new Map(world.regions)` | `render/layers.ts:267` |
| decorationsLayer 每帧每层 `regions.filter`（O(layers×regions)） | `layers.ts:686` |
| cellMarker 每帧 `[...new Set(flatMap)]` 重建 10 万级数组 | `layers.ts:796` |
| ringCacheKey 每件每帧拼字符串 ×2（GC churn） | `borderCache.ts:142` + `layers.ts:293` |
| 连续笔刷每 tick bumpRegionsRev → compose 单槽缓存 miss → 全量重算 | `core/displayCompose.ts:270` |
| `RegionIndex.ensure` 每次查询重算 worldKey（全 region cells 求和）；stealFromSiblings 实际 O(笔画×总归属数) | `core/index/regionIndex.ts:112-117` |
| autosave 主线程同步 stringify（同 §1.4） | `store.svelte.ts:608-624` |

### 2.5 缓存失效不变量只靠纪律维持

- **borderCache 键含 geomRev 但不含 regionsRev**：正确性全靠"region.cells 变化必走 invalidate 或 patchPieceEntry"的注释自觉（`render/borderCache.ts:139-144` 自认）；store 在提交笔刷时配套兑现了（`store.svelte.ts:304/1382`），但未来任何绕过即静默陈旧环。建议键补 regionsRev 或加运行时断言。
- `pathPolyCache` 删路径不清理（慢性泄漏，`layers.ts:438`）。
- GPU VBO 滞后 sweep：换世界/投影后旧缓冲最多滞留 600 帧（`mapRenderer.ts:433-443`，泄漏有界但不及时）。
- **worldCopyDxs 计算双份**：`map2d.ts:217-239` 与 `buildRenderEnv:59-74` 逐行重复，必然漂移点。
- **GL 与 2D 世界副本数不一致**：GL 几何用 `elementCopies`（每 dx 再 ±1，`layers.ts:454-467`），2D 只按 `env.worldDxs`（`map2d.ts:255-265`）→ 地图边缘道路/标签比元素填充少一个副本，接缝不对称。
- 缓存全景（键/失效/风险）：projCache（seed:count:len:proj:pp，换代全清，安全）、ViewIndex（同 projCache）、ringsCache（geomRev，容量淘汰）、环几何 WeakMap 族（恒等匹配维持，设计好）、meshCache（换投影整条重建，一次性大付）、compose 单槽（warmLayerGeometry 逐层调用会冲槽，`map2d.ts:128`）、regionCenterCache（rev 键自愈）、labelWidthCache（与数据无关，安全）。undo/重生成走 touchWorld 全清，无陈旧显示风险。

### 2.6 统计性 flip 探针仍是正确性上的双保险

环数据已由定向机制（在途重构）决定，但 64 票多数表决探针仍参与建缓存（`borderCache.ts:226-276`，rate≥0.75 且领先 0.1，`:275`）：既有每次 128 次 3 副本 raycast 的成本，又可能在探针噪声下"纠"反正确件。**定向验证稳定后应降级为 debug 断言。**

### 2.7 隐含投影假设散布

- **gk 的 unproject 实际是坏的**：循环体 `void lam; break;` 死代码残骸（`core/project/projections.ts:171-185`）→ gk 投影下拾取/标签经纬错位。
- brush 回退路径用经纬平面度量/平面射线（高纬失真，`brush.ts:83-99,174-191`，靠"最近中心+邻居精查"缓解）。
- exportSvg 硬编码 mercator + 3600×1800 + 自带 y↔lat 逆变换（`storage.ts:175-196`）。
- 生成度量用 `projectMercator`（`core/project/unified.ts:16,98,131,264`）。
- 加新投影要动 5 处（`projections.ts:4,26,39,57,123`），上述暗假设不会提醒你。

---

## 3. P2 —— 卫生债

### 3.1 死代码（AGENTS"删就真删"）

| 项 | 位置 | 说明 |
|---|---|---|
| `cellIndex.ts` 整模块 | `core/index/cellIndex.ts` | 无消费者；`getCellIndex` 每调必重建（`:144`）；store 只调 invalidate |
| `rebuildNeighborsFromSharedVerts` | `core/world.ts:282-333` | **契约明令禁止的 LonLat 键反推邻接**，留着的每一天都是被误用的违禁入口 |
| `NamePlacement`/`nameStyle` | `types.ts:103-112,143` | 全链零消费（cellIndex 搬运后无人读）；动工文字功能时"消费或删除"二选一 |
| `PathFeature.name` | `types.ts:230` | 实体活，name 无任何展示消费 |
| `cellsLayer` | `layers.ts:186-202, :823`、`Viewport:135` | 只 clip/restore 无绘制仍挂管线 |
| `centerLabel` 双写三读 | `cellIndex.ts:112-113`、`layers.ts:735`、`validate.ts:43` | 三处语义还不一致 |
| 注释引用已归档函数 | `Viewport.svelte:777` | 引用 drawPreparedElement |

### 3.2 容差与量化网格散落（违自家 §2"集中管理"规矩）

三套顶点量化精度并存：`build.ts:17`（1e-5）、`build.ts:27`（0.001°）、`projCache.ts:30`（0.01°）、`space.ts:288`（1e-5）。另有 hermite 曲率魔数（`hermite.ts:34,58-64,84`：k、0.45/0.3/0.15/0.55）、triangulate（0.02 面积 / 8e6 成本 / 1e-12）、borderCache（VOTES=64 / 0.75 / 0.1）、CELL=0.35 两处重复（`geometry.ts:170`、`viewIndex.ts:8`）、mapRenderer（2000 点 / 600 帧 / 1024 缓冲）。多数有注释说明含义，但**无中心**，动任何一个都要全库排查。"同一角点同一引用"不变量在 JSON 往返后退化为值相等、靠量化容忍（`world.ts:465`）——目前自洽，属隐性脆弱。

### 3.3 轻度违契图层名特判

`Viewport.svelte:769-771` 硬编码 `'cells'` 决定 showCellMesh；`borderCache.ts:322` 硬编码 `'landsea'`；UI 侧 `isFreeLayer` / `as PathKind`（`Viewport:127-129,544`、`WorkspaceDrawer:85-88`）；`focusLayer` 是 string 无联合类型。合成/叠放层本身无名字特判（合格）。

### 3.4 类型卫生

`as unknown` 25 处（其中 `regionIndex.ts:129-132` / `cellIndex.ts:151-157` 翻私有成员，封装破洞）；core 下 `as` 约 44 处（热点 paths.ts 9 处）；`Region.attributes` 无 schema（diplomacy 挂里面，多特性共袋有碰撞风险）。

### 3.5 杂项

- **`void x` 假依赖**：Viewport 17 处、store 8 处。最危险的一处：autosave $effect 靠 `void w.cells.length` 触发（`App.svelte:156-162`）——**纯改高度/颜色不触发保存**（接近 P1）。
- 球面视图下补丁队列无人消费、无限增长（`Viewport:710-734`）。
- `paintValues` 不随 projectEpoch 重置（`WorkspaceDrawer:217`，对比 App:150-154 有重置——两处策略不一致）。
- scissor 与 evenodd 遮罩 1px 缝（`mapRenderer.ts:302-305` vs `layers.ts:163-167`）。
- setKey 字符串三处手拼（`displayCompose.ts:356`、`Viewport:715,732`、`store:385`），slice 维度靠口头约定。
- Robinson 双周期语义并存（build 用 2π unwrap、normalize 用 frame 周期），目前自洽、脆弱。
- `lloydIterations: 1` 被 `void` 掉，调用方以为有松弛（`voronoi.ts:122`）。
- 命令类 `if (!r) return;` 静默无效（`history.ts:92,101,119,164,204,231`）；`exportPngFromCanvas` blob null 静默（`storage.ts:107`）。
- 版本迁移无注册表：`formatVersion: 2` 字面量两处（`world.ts:388,439`），v1→v2 是散落的字段级容忍而非迁移链。
- 吞错统计：catch 19 处（store 6、Viewport 4、App 2、main 2、map2d/mapRenderer 各 2、worker 1）；store `??` 兜底 27 处（多为防御性，未见掩盖错误型）。

---

## 4. 优点（还债时不得破坏）

1. **拓扑单源在源头真实成立**：neighbors/sharedEdges 仅由凸包 faces 推导（`core/voronoiSphere.ts:781-842`），反序列化从不触碰 neighbors（`world.ts:467` 明文"禁止几何键反推覆盖"）。
2. **rev 计数失效纪律是全库最强资产**：三域计数器 + "禁止 O(n) 指纹"明文（`core/rev.ts:1-10`）；regionCenterCache 用 rev 键自愈（`layers.ts:708`）。
3. **增量架构完整**：book 补丁 O(|Δ|·deg)、环恒等匹配让下游 WeakMap 全命中（`core/ring/incremental.ts:124-139`）+ warmQueue 渐现与空闲预热（`map2d.ts:114-166`），是 10 万 cell 量级的正确设计；注释带事故复盘（`store.svelte.ts:854-858` warm 冻结真凶）。
4. **triangulate 是库内最稳一环**：earcut→stencil XOR→扇形三层语义等价兜底 + 总面积 2% 自检 + 质心奇偶回验（`render/gl/triangulate.ts`），外/洞按包含奇偶分类正确（`core/ring/displayRing.ts:117-147`）。
5. **契约即注释**：每个缓存、每个补边/定向决策写明根因 bug 与反例；grep 全库无 TODO/FIXME/HACK。
6. **语义单源执行到位**：Hermite 唯一实现、求环唯一入口（`build.ts:412`）、fill=evenodd 在 GL 双路精确等价。
7. **确定性生成 + Worker 化**：字典序 snap 代表（`voronoiSphere.ts:322-374`）、Morton 插入序、方向桶、transferable；输出与遍历序无关。
8. `$state.raw` + 身份换新选型正确（50-70× 代理税实测依据写在注释，`store.svelte.ts:99,132-134`）；generationSeq 竞态守卫贯穿生成/恢复（`:429-456,626-651`）。
9. 2D 与球面共用 composeShownPieces 单源显隐/叠放（`ui/GlobeView.svelte:21,60`）；球面定位纯展示无编辑。
10. 29 测试文件 / 147 用例全绿（含跨日界线/极区反例）；**零 TODO、零 `as any`**。
11. **在途定向重构（未提交 diff）质量高**：spherical 三重积处处保向（修平面叉积跨缝错号）、共享 pair 缓存边不就地换向（防串向）、patch 时已存在边方向翻转也重定（`incremental.ts:94-103`），测试同步更新。方向正确，应尽快合入。

---

## 5. 可扩展性评估（以叙事编辑器需求为透镜）

### 5.1 渲染内核反而是最可扩展的部分

| 扩展 | 要动的地方 | 卡点 |
|---|---|---|
| 新 LayerKind | `types.ts:10` → `displayCompose.ts:27`（isFreeLayer）→ `core/layer/config.ts` | **`layers.ts:530-555` pathsLayer 的 kind 分支：新路径 kind 落入 else 静默画成河流**；GL 侧零改动（样式驱动） |
| 新投影 | projections.ts 3 处 + PROJ_META + period | unproject 精度（参照 gk 现状）；伪圆柱 period=null 即无副本的取舍 |
| 新线原语（虚线/变宽） | 需第四 program/attribute | VERT_STRIP 只有 uHalfW 均匀宽+纯色；变宽河流目前 2D 逐段 stroke 是现成坏例 |
| DOM 第 4 视觉层 | Viewport canvas 栈加 div + worldToScreen（space.ts 已备） | 坐标变换 API 组件私有（§2.2）；标签避让私有于 decorationsLayer（`layers.ts:694-703`）需上提；frameVoid 是 2D 画布语义，DOM 层需自带 clip |

### 5.2 真正的扩展性短板是两处

1. **命令系统不可序列化（§1.1c）**——任何历史面板、持久时间线、多时代叙事的唯一前置。
2. **模块边界（§2.1/2.2/2.3）**——任何新 UI 域都必须先从 store/Viewport 里拆出 ChangePipeline / CommandService / MapTransform，否则继续堆上帝模块。

### 5.3 数据层演化成本低但无保险

加 World 顶层字段需改 4 处（types / **serialize 对象字面量（漏加即静默不落盘）** / deserialize 解包 / ensureBuiltinLayers），无 `satisfies` / round-trip 测试兜底。建议：迁移注册表 `migrations: Record<v, fn>` + 单一 formatVersion 字面量 + 字段覆盖完整性 round-trip 测试。

### 5.4 测试盲区与风险区重合

现有 147 用例守的是几何/渲染不变量；P0 四项（undo 腐蚀、存档校验、GL 失败路径、缓存失效纪律）恰好全部无测试覆盖。无 UI/渲染集成测试（ROADMAP 已登记）。

---

## 6. 还债路线建议（只排序，未动手）

| 步骤 | 内容 | 验收标准 | 依赖 |
|---|---|---|---|
| 1 | **变更纪律闭环**：修 undo 腐蚀 → 高频操作命令化 → 命令纯数据化 | 每类编辑撤销后 world 逐位一致；命令可 JSON 序列化 round-trip | 无（最优先） |
| 2 | **GL 恢复路径**：restored 监听 + 异常分类 + 2D 余量层保底 + ensureMapGl 可重建 | 手动 lose/restore context 后地图自愈 | 无 |
| 3 | **存档链路硬化**：deserialize 结构断言 + autosave Worker 化 + 失败可见化 | 坏档明确报错不进渲染；保存不再卡主线程 | 无 |
| 4 | **cellClimate/biome 真相归位**（倾向方案 A：不落盘 + 按需重算） | 改高度后群系更新；存档体积减小 | 无 |
| 5 | **store/Viewport 拆分**：按六模块边界分包（先 ChangePipeline），抽 MapTransform，修 canPaint/onpaint/panningMode 三处失联 | 各模块独立可测；App 不再转发 ~60 回调 | 建议在 1 之后（命令化减少拆分时的行为风险） |
| 6 | **热路径与缓存保险**：borderCache 键补 regionsRev / 断言、每帧分配清零、RegionIndex 缓存 worldKey、副本数统一 | __drawMs 无回归；笔刷期 compose 不再全量重算 | 部分依赖 5 |
| 7 | **大扫除**：死代码（§3.1 七项）、容差集中为 tolerances 模块、违契特判、as-cast 收敛 | grep 验证零残留；tsc/svelte-check 0 errors | 随时可做，建议搭车 |

**原则**（与 AGENTS §6 一致）：每步一个可独立验收的整包；步骤 1 是后续一切（含叙事编辑器第 0 包）的地基。

---

## 7. 证据索引（按文件）

- `app/store.svelte.ts` — 162-202, 252-426, 429-456, 608-651, 670-864, 871-995, 998-1075, 1077-1174, 1176-1389, 1391-1538, 1592-1615
- `ui/Viewport.svelte` — 49, 57, 111-137, 277, 491/532/932/1071/1172, 682-688, 710-734, 769-771, 875-877, 886-1057, 119
- `App.svelte` — 108-114, 150-162, 173-197, 191, 371-376, 426-456
- `core/history.ts` — 57-74, 92-231, 267-281, 286
- `core/world.ts` — 282-333, 386-411, 414-472
- `core/types.ts` — 103-112, 143, 193, 230
- `render/gl/mapRenderer.ts` — 242-246, 302-336, 433-443, 513-516, 584-596, 712-748
- `render/map2d.ts` — 128, 217-239, 244-265
- `render/layers.ts` — 186-202, 267, 438, 454-467, 519-555, 686-812, 823
- `render/borderCache.ts` — 139-144, 142, 226-276, 322
- `core/displayCompose.ts` — 27, 32-34, 270, 356
- `core/draw/brush.ts` — 6, 77, 83-99, 123-141, 174-191
- `core/draw/membershipDraw.ts` — 107-112, 170-179
- `core/project/projections.ts` — 4-123, 171-185
- `core/index/regionIndex.ts:112-117`、`core/index/cellIndex.ts`（整文件）、`core/ring/incremental.ts:94-103,124-139`、`core/voronoiSphere.ts:322-374,781-842`、`persist/storage.ts:25-46,107,143-267`、`main.ts:19-31`、`ui/shell/WorkspaceDrawer.svelte:85-88,192-217,240-245`
