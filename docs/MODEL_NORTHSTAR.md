# 向北极星对齐 · 执行手册（2026-10-06 用户批准）

> 本手册 = 执行现场（规划层）。**每包开工三件事**：①读该包的「必读参考」（列出的文档 + §2 事实表）
> ②在本手册对应包下追加「包内分析小节」（现状复核/file:line/不变量/选项/反例）③实现与验收后把
> 「决策记录」（选了哪个、为什么、推翻/保留了哪些旧契约）写回本手册。**不准跳过分析直接改代码。**

## 0. 怎么用（写给执行 AI）

- **文档分工**（AGENTS §9）：本手册=执行现场；`AGENTS.md`=契约；`RENDER_LOGIC.md`=显示契约；
  `ROADMAP_REFACTOR.md`=状态与观察表；`docs/ARCH_REVIEW_2026-10-06.md`=评审依据（§5 数据模型对照、
  §6 公理与差距）；`docs/地图编辑器数据模型思考记录.md`=北极星原文；`docs/GEN_TUNE_DESIGN_2026-10-06.md`
  =生成参数设计。
- **忘记时的恢复路径**：`HANDOFF.md`（最近轮次）→ 本手册（计划与决策记录）→ 对应包必读参考。
- **会话纪律沿用 AGENTS**：不主动跑/加测试（除非用户说）、不主动 commit（除非用户说）、
  显示不打折、修根因不修症状、一次做完整。

## 1. 北极星条目（落地判据）

1. **图层 = 元素集合 × 规则**；规则="cell 属性→占据"的产线，属生成/绘制/重建期；`元素.cells`=占据
   =存储与渲染唯一输入；高度层与普通层存储平等。
   **判据：不存在"渲染期还在跑规则"与"派生回写真相字段且无审计"的路径。**
2. **规则可声明、可运行、可复用**：高度区间映射=第一实例；「高度>0=陆海层」=第二实例（用户例）。
   **判据：新增一种规则不动存储/渲染。**
3. **约束语义统一为「空间受限」**（集合判定+数量+反受限开关；父子/游离/争议区皆参数）。
   **判据：语义映射表完整、无第三套词汇。**
4. 已裁定改良（不得回退）：**单向引用+可重建索引**（拒双向落盘）；**定向失效+增量**（拒全局重算）。
5. 两处旧解释作废：**「高度层一等公民/专则」作废**（2026-10-06 用户裁定存储平凡）；**「数据精确档/
   显示累积」双真相契约将在包 B 改写**（语义不变、形态变）。

## 2. 差距总表（2026-10-06 三轮探索实证；file:line 已核）

**已符合**：地块最小单元；单向引用+索引；compose=过滤器；allowOverlap；核心子元素
（centerCellId/coreRegionId, commandService:498-559）；定向失效。

**需收敛（归属包）**：
- 高度双真相 → **B**
- `Region.cells` 四写者无入口 → **C**
- 生成规则三套词汇（活 `defaultGenConfig` layer.ts:28-116 × 死 `LayerConfig.gen` config.ts:26-52，
  漂移两处：country coreSelector config:141≠layer:54、height diffusion 无消费；× `genStrategy` 标志
  unified:376 一处分支）+ placement(config:226-248) vs scope(unified:55-85) 两套 + `splitPolicy`
  keepEnclave/reject 空声明 → **D**
- 约束散字段（parentLayerId/allowOverlap/require*/placement/splitPolicy）→ **E**
- 失效靶子 → **F**：touch 族 6 种（changePipeline:42-114）/ queue 3（patchQueues:16-35）/
  bump 3（rev.ts）/ 散补丁 regionsBump（WD:105）；incidentCache 跨世界不复位（borderCache:186-190）；
  物化窗口（touchWorld 族不物化）；I-bridge（history:426-432）；endpoint 无 undo（drawController:446-469）；
  adjacent/overlaps 陈旧；tintOf 伪装（commandService:250-262）
- refine 八阶段 → **G**；layerRenderConfig 归属待写清 → **A**（随真相表落）

**死物（A 清理，已核）**：`resetDataRev`（rev.ts:39 零调用）、`touchHeight._full`（changePipeline:92）、
`drawController:284 void placementAllows`、`shareCellsWithOthers/adjustWeights/regionWeight/
removeCellsFromRegion`（brush.ts，仅测试引用）。

## 3. 分期包

### 包 A · 台账落地 + 死物清账（零行为变更）
- **做法**：①本手册全文落盘；②§2 死物逐项"删就真删"（删前 src+tests 双向 grep，AGENTS §9.3）；
  ③AGENTS §11 加本手册指针；ROADMAP_REFACTOR 加章节"北极星对齐（A–H）"指向本手册。
- **必读参考**：AGENTS §9/§11；本手册 §2。
- **思考方向**：历史"孤儿判定"教训——每个删除项写明判定依据（引用计数归零证据），不确定的降级为
  "观察项"写入 ROADMAP_REFACTOR 观察表。
- **验收**：grep 归零（src+tests 两域）+ tsc/svelte-check 0。**无待拍板。**

**包 A 决策记录（2026-10-06）**：见文末「决策记录」。

### 包 B ✓ · 高度域平凡化（样板包——"规则期→占据"的第一次落地，2026-10-06 拍板 A 案落地）
- **现状事实**：双真相契约=heightElements.ts:1-12 文件头明文（数据=精确档 lo≤h≤hi 写入 Region.cells；
  显示=累积 h≥lo 由 displayCellsOfInterval:17-34 渲染期派生、明令不回写）；`displayCellsOfRegion`
  displayCompose:19 单源供件与对账；`reconcilePieceMembership` borderCache:135=对账补丁（本会话暗斑根因：
  件按累积、region.cells 按精确档）；祖先切片不对称：`regionsWithCells` displayCompose:154-158 用原始
  精确档 cells；精确档/累积集的其余潜在消费=validate.ts、regionIndex 拾取（regionIndex.ts）、
  store.cellRegions（store:132-152）、绘制滑块（WorkspaceDrawer paintValueOf）——**包内分析必须逐一核消费**；
  懒建四入口=unified.ts:378 / WorkspaceDrawer:207-213 / changePipeline:124 / heightElements:149；
  重算入口=flushHeightRegions（changePipeline:116）→ update(:144) / rebuild(:40)。
- **结论与不变量**：规则（档映射+显示映射）在**重算期跑完**，占据（region.cells）=**规则产物**（累积形态）；
  渲染/件环只读 cells；不变量：①任意时刻 cells=该档的映射集 ②件环与 cells 一致由**唯一维护路径**
  （Δ 补丁 updateHeightIntervalElements:144 改落写）保证 ③"显示=累积"语义不变（2026-09-30 契约）但改形态
  （AGENTS §3 DisplayPiece 行 + RENDER_LOGIC 改写，注明 2026-10-06）。
- **做法步骤**：①包内分析小节（先写：精确档去留选项 A=彻底退役（需要时现算）/ B=另存
  `attributes.exactCells`；逐消费点影响面）→拍板；②实现：update/rebuild 落写映射集；
  `displayCellsOfInterval` 从渲染链摘除；`reconcilePieceMembership` 退役（删除或降级测试夹具）；
  ③懒建收敛为一（唯一触发=flushHeightRegions + 新世界创建，删 WD effect 与 regionsBump 散补丁）；
  ④存量迁移（normalizeHeightIntervalElements:89 处按新形态重算）；⑤契约改写+记忆更新
  （记忆 `mapedi-height-cumulative-display.md` 补 2026-10-06 形态变更）。
- **必读参考**：AGENTS §3 显示契约全表；RENDER_LOGIC 核心约定块；记忆
  `mapedi-height-cumulative-display.md`（旧契约原话）；记忆 `mapedi-render-diagnosis-2026-09-28.md`；
  HANDOFF 第五十二轮（双真相修复现场）；本手册 §1.5。
- **思考方向（坑）**：①精确档退役前必须核完四类消费——漏一个就是新双真相；②Δ 链已算显示Δ（更新函数
  返回值），改"落写"是最小改；③反例清单：涂改跨两档（h 5→30：低档们各 +1 累积）、擦除回 0、细化批量
  变更、undo 回环（historyEffect:172-183 补 flush）、旧档载入迁移、父切片与累积的边界
  （regionsWithCells 对称化）；④reconcile 退役需先验证"Δ 维护 + 前缀失效"两路已完全覆盖
  （borderCache:84 patchPieceEntry / queuePieceInvalidation 两入口）。
- **验收**：涂改/细化后档色即时正确（旧暗洞断言 #5848/#73335 复跑）+ reconcile 删除后像素零回归
  （同 seed A/B）+ 四档分布断言 + 存档回环逐位 + undo 干净。**待拍板：精确档去留（包内分析出二选一）。**

**包 B 包内分析（2026-10-06 执行前，file:line 已核）**

- **双真相现形**：`rebuild/normalize/update`（heightElements.ts:40/89/144）写**精确档** cells；
  `update` 同时返回**累积** Δ（:176-179，与 `cellInInterval` 同谓词）；显示侧 `displayCellsOfInterval`
  （:26）→ `displayCellsOfRegion`（displayCompose.ts:19）→ 唯一消费=合成件（:325，传给
  `splitRegionForDisplay` 的是 `{...reg, cells: 累积}`）；对账补丁 `reconcilePieceMembership`
  （borderCache.ts:135）调用点唯一=Viewport.svelte:894。
- **精确档消费面（逐一核完，四类+五类补充）**：
  1. **拾取**：App.pickElement（App.svelte:99）经 `store.regionIdsOfCell`（store:134，Region.cells
     反查+regionsRev 键控缓存）取焦点层「最后一个命中」。累积化后命中=全部 lo ≤ h 的档，末者恰好=精确档
     ——**但只在数组序按 lo 升序时成立**（heightElements.ts:153 明说用户可拖动改序）→ 必须改显式精确定位（按 h 落档）。
  2. **悬停归属**（App.svelte:290 `elementIds/names`）：累积化会一次列 12 个高度元素（可见变化）→ 同需精确定位。
  3. **检查区计数**（InspectSection.svelte:104 `r.cells.length`）：语义会变成 h≥lo 计数 → 需现算精确计数。
  4. **校验**（validate.ts）：无 overlap 规则；empty/center/adjacency 对区间型无约束；越界断言在反序列化 → 累积同样合法，零改动。
  5. **regionIndex.owners**：height 层 owners 只被绘制预测/steal 用，而高度层绘制走 `paintHeight`（不经 membershipDraw）→ 不消费。
  6. **物化**：height 无 `parentLayerId`（world.ts 全库仅 province 有）→ 不参与。
  7. **祖先切片**（regionsWithCells:154/320）：`displayAncestors` 只沿 parentLayerId，height 是根、无人以它为祖先 → 该不对称面**不触及高度**（latent，不必为 B 改）。
  8. **序列化/克隆**：interval cells 现落盘；累积化后 12 档合计 ≈ n×6（100k 世界 ≈ +500k id，clone/JSON +MB 级）——**本包唯一实质成本**，autosave 主线程 clone 可见。
  9. **核心/标签**：区间元素不设 centerCellId 且无父子（coreRegionId 须指子元素）→ coreCellOf 不触及，零改动。
- **选项**：
  - **A（推荐）彻底退役、需要时现算**：cells 落成累积（=规则产物）；删
    `displayCellsOfInterval`/`displayCellsOfRegion`（件直接用 reg.cells）；拾取/悬停改「按 h 精确定位」
    （`regionIdsOfCell` 跳过 interval 入图、现算该格档位追加 → 调用点零改）；检查区计数走
    heightRev 键控的量档缓存（一次 O(n) 出 12 档计数）。精确集=纯函数（h×HEIGHT_INTERVALS 表），无可存之物。
    - 子选项 **A2（可选）**：interval cells **不落盘**（载入由 heights 重建）→ 存档/clone 体量回到现量级，
      且把「规则产物」落进序列化；代价=serialize/deserialize 白名单改动+载入自愈断言。
  - **B 另存 `attributes.exactCells`**：⚠ 不推荐——exact 是 h 的纯函数，另存=第二份真相（本轮要消灭的对象），
    且序列化=累积+精确双份；唯一收益（免现算）实为 O(1)/次。
- **A 案实施草图**：①三函数写累积（update 数据块并入显示块；normalize 幂等：旧精确/旧累积两代载入皆归一到累积）
  ②display 特例删除 ③拾取/悬停精确定位 ④计数缓存 ⑤reconcile 退役（删函数+Viewport:894+相关测试，先验
  Δ+前缀失效两路覆盖）⑥懒建收敛（保留 unified.ts:378 世界创建补建 + heightElements 内 `!==12` 兜底；
  删 WorkspaceDrawer effect+regionsBump）⑦契约改写（AGENTS §3 DisplayPiece 行/RENDER_LOGIC/记忆）⑧验收照上。
- **反例清单（A 案）**：涂改跨两档（h 5→30 低档各 +1）/ 擦除回 0 / 细化批量 / undo 回环 / 旧档两代载入 /
  用户拖动改档序后拾取（不依赖数组序）/ hover 高峰只出 1 个高度元素 / 隐藏低档拼缝语义不变 / 100k 存档体量。

### 包 C ✓ · 占据写入单一入口（"占据写入器"，2026-10-06 形态 1 落地）
- **现状事实**：改 `Region.cells` 的全部路径=绘制（membershipDraw.ts:113/106/158、stealFromSiblings
  brush:142、flood:427、endpoint drawController:446-469）、生成（unified.ts 各生成器、political.ts:112）、
  物化（materializeParentCells displayCompose:126-152）、高度重算（heightElements 三函数）；失效调用散在
  各写者（touchRegions/Incremental/queuePieceInvalidation/**reconcile 已于包 B 退役**）。
  → 精确写点表（15 处/7 文件）见下方「包内分析」。
- **结论**：建 `core/occupy.ts`（暂名）——**统一入口与协议，不重写算法**：`writeCells(region, next, cause)`
  统一（COW 写 + Δ 记账 + 审计钩子；**失效/物化不在写入器内**——那是包 F 的 cause→touch 表）。
  命令层（MultiRegionCommand history:94 / HeightCellsCommand history:13）与写入器的关系见下方包内分析。
- **做法**：①"写点清单"复核（上列）+ 设计最小接口（热路径零分配约束、$state.raw 原地写禁令）
  ②逐模块迁移（先物化→高度→生成→绘制）③每迁移一步全量回归。
- **必读参考**：本手册 §2；AGENTS §4 拓扑硬规则；记忆 `mapedi-render-diagnosis-*`（失效史）。
- **思考方向**：不做大爆炸重写；接口为"最小可用"（先三件事：COW、patch、审计钩子）；
  placement/allowOverlap 校验钩子在此预留（与 E/F 呼应）；`$state` 深代理 / structuredClone 历史坑
  （记忆 `mapedi-1b-paths-command.md` 的 DataCloneError）。
- **验收**：笔画/生成/物化/undo 四类回归 + 热路径性能采样（p50 不劣化）。**待拍板：接口形态。**

**包 C 包内分析（2026-10-06 执行前，写点逐一核完）**

- **写点清单（`Region.cells` 全部写入，file:line 已核）**：

  | # | 写点 | 域/谓词 | 写后失效（现状） |
  |---|------|---------|------------------|
  | 1 | `core/draw/brush.ts:127` addCellsToRegion | 绘制·并集（COW `[...set]`） | 无（由调用方收尾） |
  | 2 | `core/draw/brush.ts:146` stealFromSiblings | 绘制·抢格（filter 旁者） | 无（同上） |
  | 3-5 | `core/draw/membershipDraw.ts:108/113/121` | 绘制·replace 剥离 / 加 / 减 | 无（commit 后统一） |
  | 6 | `core/draw/membershipDraw.ts:158` applySplitPolicy | 绘制·拆连通块（改本件+新建件） | 无 |
  | 7 | `core/draw/roads.ts:70/72` dragRoadEndpoint | 绘制·端点格迁移（filter+push） | `touchPaint`（move）/`touchRegions`（end） |
  | 8 | `core/displayCompose.ts:139` materializeParentCells | 物化·父=子并集 | 无（被 touchRegions* 在 bump 之后调用） |
  | 9 | `core/layer/heightElements.ts:134` normalize | 高度·全量重导 | 载入路径由 replaceWorld/touchWorld 收尾 |
  | 10 | `core/layer/heightElements.ts:195-196` update | 高度·增量（已自算 Δ） | `flushHeightRegions`→Δ 队列 + bumpHeightRev |
  | 11 | `core/political.ts:63` 逐格 push | 生成·归属（O(n) push，顺序=land 序） | 世界替换→touchWorld |
  | 12 | `core/political.ts:95-112` 行省分区（filter 后建字面量） | 生成·创建（非既有件写入） | 同上 |
  | 13 | `core/history.ts:74/83/120` 快照回放 | 命令·apply/revert（`[...set]`） | `historyEffect` + 调用方 touchWorld/materialize |
  | 14 | `core/history.ts:250/265` Annex/Delete 载荷 | 命令·吞并/移交 | 同上 |
  | 15 | `core/validate.ts:187` 修复 zero_weight | 修复（**当前全库仅测试可达**，ValidatorPanel 已归档 D4=B） | 无 |

  - 生成器（unified.ts 等）全部经**创建字面量**（`cells: [...]` 属对象构造，不是对既有件的写入）→ 写入器不覆盖创建，只覆盖"改已有归属"。
  - 绘制域的失效时机在 **commit**（`DrawController.commitStroke`：快照-diff→MultiRegionCommand + `touchRegionsIncremental` + 逐件 queuePieceInvalidation），不在写点——写入器**不得**顺带失效，否则回到"写一半就失效"的老坑。

- **接口设计（形态 1 · 瘦写入器，推荐）**：
  ```ts
  // core/occupy.ts
  export type OccupyCause = 'paint' | 'height' | 'materialize' | 'generate' | 'undo' | 'repair';
  export interface CellsDelta { regionId: string; layerId: string; added: CellId[]; removed: CellId[]; }
  /** COW 写 + Δ 记账 + 审计钩子；无变化 → null（不换引用/不记账）。
   *  opts.delta 已知差时跳过 diff（高度 update/物化自算、history 回放直取快照引用）。 */
  export function writeCells(region: Region, next: readonly CellId[], cause: OccupyCause,
                             opts?: { delta?: { added: CellId[]; removed: CellId[] } }): CellsDelta | null;
  export function setOccupyObserver(fn: ((d: CellsDelta, cause: OccupyCause) => void) | null): void; // 探针/测试
  export function setOccupyGuard(fn: ((r: Region, added: readonly CellId[], cause: OccupyCause) => CellId[] | null) | null): void; // 包 E 预留（placement/allowOverlap 是否前移）
  ```
  - 三件事：**COW**（`region.cells = next`——调用方保证 next 为独占新数组；写入器防呆：next === region.cells 时视为无变化）、**Δ**（opts.delta 或自算 diff；diff = O(|old|+|next|)，仅用于几百格的绘制/物化档）、**审计钩子**（默认 null，生产零开销）。
  - 不做：失效分发、物化、校验拦截（guard 默认 null；包 E 拍板后才启用）——**写入器是记账点，不是管家**。

- **形态对比**：
  - **形态 1（推荐）瘦写入器**：零行为变更、可逐模块迁移、热路径零额外分配（已知差路径）；为 F 的 cause→touch 表与 E 的写入闸留好单一挂点。
  - 形态 2 胖写入器（按 cause 查表失效/物化）：一步到位但侵入事务边界（笔画须等 commit、生成期世界未安装、载入期无 store）→ 极易复现旧坑，不建议。
  - 形态 3 写入器+命令层合一（生成/载入/物化全部命令化）：最大重构，与"不做大爆炸"及现有 undo 快照机制冲突，✗。

- **迁移顺序（每步一次全量回归）**：① 物化（#8）+ normalize（#9）——最静；② 高度 update（#10，opts.delta 直传现有 Δ）；③ 生成（#11 顺手改批量：收集后每国一次 writeCells，顺序=现 push 序，输出逐位不变）；④ 绘制（#1-7，opts.delta 由 commitStrokeDiff 现有快照差供给）；⑤ 命令回放（#13/#14，cause='undo'，直取快照引用不 diff；Annex/Delete 载荷同理）；⑥ validate 修复（#15）纳入或标注（仅测试可达）。
- **反例清单**：涂改跨档（高度 Δ 与写入同源）/ 撤销回放（引用直取不二次 COW）/ 物化父残留（F 联动）/ 生成同 seed 逐位不变 / 端点拖动 `touchPaint` 轻失效不被改重 / 空并集（无变化返回 null）/ 100k 世界物化 diff 不劣化 p50。

### 包 D ✓ · 规则显式化 + 派生层能力（2026-10-06 用户拍板「A/1/删」后落地）
- **现状事实**：§2 三套词汇；`genConfigFromParams` layer.ts:86-116 逐键覆盖 profile；
  `layerConfig.gen` 无读取者；splitPolicy 仅 `newElement` 有实现（membershipDraw:134）；派生层不存在。
- **结论**：单一规则声明（活配置为准、死配置删、漂移对齐）；规则=**内置判定带参数**（不做表达式解析
  ——北极星原文 §8"不写代码、不解析谓词"；用户公理的"更复杂判定"经**参数集**表达，包内分析确认边界）；
  `splitPolicy` 二选一：兑现 keepEnclave 或删词汇；**派生层**=新 `layerSource:'derived'`（声明规则+
  触发运行+产出普通 Region）——用户例「高度>0=陆海层」作为首个内置 preset 落成。
- **做法**：①死配置清账与词汇收编设计（含两处漂移处置）②splitPolicy 决策 ③派生层最小实现
  （core/generate 新增规则运行器；`genStrategy` 或 `layerSource` 扩展；生成面板/建层入口）④用户例端到端。
- **必读参考**：`docs/地图编辑器数据模型思考记录.md` §5/§6/§7/§9/§11（尤其"快速配置列表"）；
  `docs/GEN_TUNE_DESIGN_2026-10-06.md`；`layer/genTypes.ts` 枚举；
  记忆 `mapedi-gen-unified-four-handle-2026-09-30.md`。
- **思考方向**：派生层与高度档的关系——高度档未来可"重构为内置派生层实例"，但**本包不动高度**
  （B 已样板）；别让"规则"变成第二套注册表（复用 LAYER_GENERATORS 模式）。
- **验收**：用户例端到端（建层→运行→两元素占据正确→渲染/撤销/存档）+ 死配置 grep 归零 + 既有生成回归
  （同 seed 逐位）。**待拍板：规则参数集边界。**

**包 D 包内分析（2026-10-06 执行前，三套词汇与派生能力逐一核完）**

- **三套词汇死活判定（file:line 已核）**：
  | 词汇 | 位置 | 死活 |
  |---|---|---|
  | 活 A `defaultGenConfig(layerId, seed)` | `core/layer.ts:28-90`（**生成唯一真相**）；`genConfigFromParams` :93-119 逐键覆盖 profile params + worldShape 十旋钮 | 活 |
  | 活 B `genStrategy`（scatter/heightmap/elements） | 类型 `types.ts:106`；读 `layer/flags.ts:19-23 genStrategyOf`（缺省 'elements'）；内置声明 world.ts + 旧档回填 :265-268；消费 App.svelte:55 / GenerateSection / unified.ts:376 | 活 |
  | 半死 C `LayerConfig` | `core/layer/config.ts:38-52` | 分字段：`placement` 活（drawController:266→membershipDraw:61）· `style` 活（defaultStyleForLayer:203、resolveLayerStyle）· **`splitPolicy` 事实全死**（唯一实现 applySplitPolicy 只认 'newElement'（membershipDraw:134），而全表无层声明 'newElement'（cells='reject'、其余 'keepEnclave'）→ 行为恒=保留；tests 零引用）· **`gen`（含 diffusion）零读取者** · **`elementSource` 零消费者** · **`workspace.listElements` 零消费者** |
  - **漂移两处（已核）**：country `coreSelector` config:140 `'centermost'` ≠ layer.ts:44 `'visualCenter'`（死表 vs 活表）；culture `placement='any'`（config:175）vs 生成 `scope='landOnly'`（layer.ts:76）——**placement 与 GenScope 是同一语义（能否落在此 cell）的两套表达式**，分叉即漂移（统一归包 E，本包只登记）。
- **派生能力现状**：`generateFromLayer`（unified.ts:248+）= **按源层元素归并**（国家←行省，拓扑聚合）；**无**值域/属性谓词派生——用户例「高度>0 = 陆/海两元素」不存在。
- **结论与不变量**：单一规则声明 = 活 A（参数）+ 活 B（产出策略），C 收编为**能力参数表**（只留 placement/style）；规则 = **内置 preset + 参数集**（不做表达式解析——北极星原文 §8「不写代码、不解析谓词」；"更复杂判定"经 preset 家族+参数表达，判据=新增规则只加 preset、不动存储/渲染）。**派生层 v1**：`LayerDef.layerSource: 'derived'` + `DerivationSpec{preset, params}`；运行=显式「生成/重建」→ 产出**普通 Region**（占据经 `occupy.writeCells` cause='generate'）；**不做自动跟随重算**（高度改动后自动重跑=全局重算，红线否决；将来可做"依赖标记+手动重建"）。首个 preset=用户例 `heightThreshold`（界 t：h>t→元素A 否则元素B）；同族预留 `heightBands`（界列表→n 元素，与高度档同构但**存储平凡**——正是 B 样板的复用点）。
- **选项（拍板）**：
  1. 规则边界：**A（推荐）preset+参数** ／ B 通用谓词 DSL（✗ 违背 §8，且引入用户表达式求值/校验/撤销面）／ C 只做 fromLayer 聚合（✗ 用户例落不了地）。
  2. `splitPolicy` 处置：**①（推荐）删词汇**（keepEnclave/reject 无实现、newElement 无人声明、零测试——"删就真删"，将来要拆块按产品需求重建）／ ② 保留 newElement 并在检查区暴露为层开关（兑现能力但需新增 UI+验证）／ ③ 维持现状（✗ 死词汇续存）。
  3. 死字段删除范围：`LayerConfig.gen`（连 diffusion 声明）、`elementSource`、`workspace` 删；country coreSelector 漂移随 gen 删除自然消失。
- **实施草图（拍板后）**：①词汇收编（config.ts 瘦身；drawController/membershipDraw 同步）②`layerSource:'derived'` 类型 + 建层入口（生成面板第四分支：散点/高度图/元素/派生）③`core/generate/derive.ts` 规则运行器（preset 表 + 参数归一 + 产出 Region + 经 occupy 写入 + 重跑幂等）④用户例端到端（建层→运行→陆/海占据正确→渲染/撤销/存档）⑤验收：既有生成同 seed 逐位不变 + 派生层重跑幂等 + 存档回环。
- **反例清单**：h=0 界点归属（>0 陆、否则海——写死并测）；全陆世界（海元素空 → 结构性保留）；岛屿世界；界设极值（-63/64）；重跑幂等（同结果不产生新命令噪音）；撤销后重跑；旧档（无 layerSource）载入；多派生层彼此独立。

### 包 E · 约束概念化 + 多归属立项
- **现状事实**：字段清单与位置（world.ts builtinLayers / config.ts placement+splitPolicy / gate.ts:12-68
  链约束 / validate.ts:30-147 检查）；"父子"硬编码为 parentLayerId 单值（Max=1 不可配）；多归属不支持。
- **结论**：先**语义映射表**（parentLayerId=被包含+Min0+Max1+反受限开；allowOverlap=层内重叠开关；
  requireAdjacency/requireCenter=校验规则；placement=单向地形门槛；fromLayer=反受限聚合源），落文档+
  命名统一；**多归属/争议区（Max=N）独立评估报告**（影响面：parentId→parents[]、物化、叠放比较器、
  删除策略 policy.ts、校验、UI 显示）——评估后拍板才动。
- **必读参考**：思考记录 §8-§11；`core/hierarchy/policy.ts`；记忆
  `mapedi-hierarchy-redesign-2026-10-02.md`（D1-D8 单源统一史）。
- **思考方向**：require* 只有 validate 消费（写入无闸）——概念化同时决定是否前移为写入闸（与 C 钩子呼应）；
  冻结链约束（每层≤1子 gate:34）与多子层能力（思考记录 §9）的冲突点登记。
- **验收**：文档+（若拍板）独立实现包。**待拍板：多归属做不做。**

### 包 F · 失效/重算规范（支撑包）
- **现状事实（靶子）**：①`incidentCache` 跨世界不复位（borderCache:186-190 只随 geomRev 重建 pairEdge，
  incident 仅退役函数 invalidateBorderCache:71 清）——**先写最小复现确认**（换世界→对存量件
  patchPieceEntry→断言边集属新世界）；②物化窗口：touchWorld 族（changePipeline:42-52）不物化→删层/
  复制层/加层/缩进（commandService:452/394/596/缩进链）残留父 cells；③I-bridge：层缩进/删层链拼接
  （history.ts:426-432）不重校验元素 parentId→仅读档 repairHierarchy 静默清父；④endpoint 无 undo
  （drawController:446-469）；⑤`adjacentElementIds/overlaps` 仅生成期写；⑥tintOf 派生伪装用户编辑
  （commandService:250-262）。
- **结论**：本手册内做「**字段→touch 规范表**」（每字段唯一 touch+消费方）；物化收口（新增
  `touchStructure()` 或统一命令收尾——包内分析性能代价）；其余五项按靶子各修。
- **必读参考**：ROADMAP_REFACTOR 观察表（三条在案观察项）；记忆
  `mapedi-quickfix-batch-2026-10-01.md`（autosave 集中 touch* 先例）。
- **思考方向**：每项"先复现→再修→反例"；touchWorld 加物化的频率成本实测。
- **验收**：各复现用例转绿+回归+性能采样。**待拍板：adjacent/overlaps 策略二选一。**

### 包 G · 管线收口 + 验收基建
- **现状事实**：refine.ts 八阶段（228-446，含 ⑤b）；HANDOFF 156 行超限；探针脆弱（记忆
  `zcode-browser-test-quirks.md`）；测试纪律待批。
- **结论**：refine 显式阶段管线（阶段=纯函数+输入输出+不变量断言函数）+ 参数真值表
  （flatness/anchorFit/coastBreak/护岸 × 效果矩阵，落文档）；**测试固化+探针固化=`__probe`（等"补测试"）**。
- **必读参考**：`docs/GEN_TUNE_DESIGN_2026-10-06.md`；HANDOFF 五十二~五十四轮；记忆
  `mapedi-generation-harness.md`。
- **验收**：同 seed 逐位回归 + 断言可跑。**待拍板：测试启动。**

### 包 H · 使用侧（产品面）
- 依据 `docs/OPTIMIZE_REVIEW_2026-10-04.md` §6/§7：元素搜索 / 测距 / 吞并入口 / 校验 toast；
  球面补完（标签/悬停/填充 evenodd，按 RENDER_LOGIC 对齐）。**验收按各项文档化断言。**

**随带（不单独成包）**：HANDOFF 剪枝归档（纪律在 HANDOFF 内）、记忆按主题拆分、每包结束同步
AGENTS/RENDER_LOGIC/ROADMAP 分层。

## 4. 统一验收口径（每包）

既有量化基线全量回归（档色四类 / 跨线四点 / 锚定 0 误差 / mask 0 破）＋包内新不变量＋存档回环＋
undo 干净＋tsc/svelte-check 0＋（涉及性能的包）p50 采样不劣化。

## 5. 顺序与依赖

A（台账，一切分析底座）→ B（样板：最痛且公理直接点名）→ C（依赖 B 的经验）→ D（依赖 C 的写入器）→
E（依赖 D 词汇）→ F/G（支撑，可插任意间隙；F 的真 bug 可提前）→ H（产品面收心）。
**红线**：显示不打折；不引入双向引用/全局重算；B 与 E 的两处模型级决策先拍板后动、可回退。

---

## 决策记录（倒序追加）

### 包 D ✓（2026-10-06，用户拍板「规则=A preset+参数 / splitPolicy=①删词 / 死字段=删」）
- **规则边界 = A**：`DerivationSpec{preset:'heightThreshold', params:{threshold, aname?, bname?}}`（types.ts）；
  `GenStrategy` += `'derived'`（**复用现有策略词汇，不另立 layerSource 第二套**）；新增
  `core/generate/derive.ts`（PRESETS 表 + `runDerivation`：id 稳定 `${layerId}-a/-b` → 重跑幂等；
  产物=普通 Region 创建字面量——与各生成器同语义，不做自动跟随重算=红线）。
- **运行接线**：`generationService.regenLayer` 的 derived 分支——主线程直跑（不进 registry/Worker）、
  无跨层清除（清壳规则不适用）、运行即可见（visible=true，防"运行了却看不见"隐藏层陷阱）。
- **splitPolicy = 删词**：`SplitPolicy` 类型、`DrawActor.splitPolicy`、`applySplitPolicy`
  （唯一实现只认 'newElement' 而全表无层声明 → 事实恒"保留"）、`DrawResult.elementSplit`
  （零消费者）全删；drawController actor 同步。
- **死字段删**：`LayerConfig` 的 `gen`（零读取者；其 country coreSelector 'centermost' 与活表
  'visualCenter' 漂移）、`elementSource`、`workspace` + `LayerGenParams`/`ElementSource` 类型
  + config.ts 七层条目同步清；`core/layer.ts` 再导出收窄。
- **建层/配置入口**：图层创建行新增 🧭（`CreateRow.onCreateDerived` → `addLayer(name, {derived})`
  → LayerDef 带 genStrategy+derivation 深拷贝）；生成面板第四分支（规则描述 + 高度界/两侧名输入
  → `store.setDerivationParam`=LayerFieldsCommand 可撤销）→「运行派生」。
- **验收（浏览器实测，API 与真实点击双路）**：建层（11→12 层、焦点、声明正确）→ 运行 → 陆地
  21034 = 暴力统计、海洋 78966、mism=0（完备互斥）→ 幂等（重跑 cells 逐位同、恒 2 元素）→
  参数生效（t=20 → 1814 = 暴力统计；名字改「大陆/大洋」✓）→ 参数撤销回 0 ✓ → 存档回环
  （genStrategy/derivation/cells 全保留）→ 面板 UI 渲染 ✓（运行派生/高度阈值/高度界/陆侧名/
  海侧名/界点算海侧）→ 测试层已删（用户世界保留一个「陆海」演示层，可右键删除）。
- **已知边界（诚实）**：撤销「建层」不清理已产元素（与其它图层"生成不可撤销"同现状——登记观察）；
  派生层不进整世界生成（撒点清空后需手动运行一次）。

### 包 C ✓（2026-10-06）：**形态 1（瘦写入器）落地**——按手册思考方向"最小可用（COW/patch/审计）"执行
- 新 `core/occupy.ts`：`writeCells(region, next, cause, { delta? })`——COW 写 + Δ 记账（已知差直用、
  否则自算 diff）+ 审计钩子；`setOccupyObserver`（探针）/`setOccupyGuard`（包 E 预留拒名单闸，
  默认 null 不拦截、已单测）。**不做**失效分发（绘制域=commit 后统一；cause→touch 表化归包 F）、
  物化、校验拦截。不变量：同引用=完全无操作；集合等价仍换引用但 Δ 返回 null。
- **15 处写点全部迁移**（写点表见包内分析）：绘制 7（brush×2 / membershipDraw×4 / roads×1，
  Δ 借 commitStrokeDiff 现有快照差或现场算）、物化 1（delta 在并集循环里顺手收集）、高度 2
  （normalize 全量 / update 分类后逐档一次落写，Δ 与返回给件环的 Δ 同源）、生成 1
  （political 逐格 push → 收集后每国一次写）、命令回放 5（PaintCells/MultiRegion/Annex，
  cause='undo'、Δ 直用命令载荷）、修复 1（validate，cause='repair'）。grep 复核：`Region.cells`
  的赋值只剩 `occupy.ts` 内部（生成器的创建字面量按契约不经写入器）。
- **验收实测**（浏览器，真实世界 + 合成世界）：
  ① 绘制域：membershipDraw 加/删笔、stealFromSiblings 抢格——观察者各 1 条 cause='paint'、
  Δ 数正确（加 1/删 1/剥 1）；无净变化 → 0 条；
  ② 高度域：真实 100k 世界涂改 h25→h47（cause='height'）+ undo 逐位还原；
  ③ 物化：父≡∪子 0 违例、零变化 0 记账、100k 世界 matMs≈0；
  ④ 生成域：**12 组合（4 seed × 3 国家数）新旧实现逐位对照 0 差异**（国家+行省 cells 数组
  逐位置比对；对照法=git 旧文件临时挂载，验毕即删）；
  ⑤ 写入器单测：同引用 no-op / 集合等价 null / 已知差 / 拒名单闸过滤同时修正 Δ 报告 /
  observer 触发；
  ⑥ 热路径：同格涂改 p50=0ms p95=0.1ms（40 次采样，真实 100k 世界）；tsc/svelte-check 0 errors。
- **与后续包的关系**：包 F 在此加 cause→touch 表（写入器已带 cause）；包 E 在此接
  allowOverlap/require*/placement 闸（Guard 已留位、语义=拒名单）。

### 包 B ✓（2026-10-06，**用户拍板 A**：精确档彻底退役、需要时现算）
- **形态落地（单真相）**：`Region.cells` 本身即累积（h ≥ lo）；三路同谓词 `cellInInterval`
  （rebuild 全量 / normalize 幂等——旧精确/旧累积两代载入皆归一到累积 / update 增量；
  update 的 Δ 与落写同源，push 无重复由谓词保证：进入 ⟺ h1≥lo>h0 ⟺ 此前不在集内）。
- **渲染期派生退役**：删 `displayCellsOfInterval` / `displayCellsOfRegion`（件直接用 `reg.cells`，
  displayCompose 特判与注释同步）；`splitRegionForDisplay` 不再吃覆盖副本。
- **对账补丁退役**：`reconcilePieceMembership` + `memberReconcileGate` + `__reconcileN` 探针
  全删（Viewport 调用拆、perfHooks 声明删）。覆盖论证：成员变化只剩两路——高度 Δ 经
  patchQueues→`patchPieceEntry`、成员笔画经 `queuePieceInvalidation`；件集与缓存内容恒同源。
- **精确档现算**（不许存第二份）：`exactIntervalElementOf`（拾取/悬停）、
  `exactCountOfInterval` → `exactHeightBandCounts`（heightRev+world 键控缓存，检查区计数）。
  拾取链：`store.regionIdsOfCell` 跳过 interval 入反查图、现算档位追加（调用点零改）——
  ★旧实现「同层末位命中恰好=精确档」依赖数组序，而数组序可被用户拖动改，已弃。
- **懒建收敛**：`ensureHeightIntervalElements`（幂等）挂在 `store.replaceWorld` 安装点
  （覆盖撒点新世界无高度元素场景；生成/载入后即刻 12 档可拾取）+ update/rebuild 内 `!==12`
  兜底；删 WorkspaceDrawer 的补建 effect 与 `regionsBump` 散补丁（响应性由 world 身份链保证）。
- **契约改写**：AGENTS §3 DisplayPiece 行、RENDER_LOGIC 身份表、记忆
  `mapedi-height-cumulative-display`（标注形态变更、语义 2026-09-30 不变）。
- **成本（诚实记录）**：序列化/克隆体量 ≈ 6×（100k 世界 +~500k id，autosave clone +MB 级）；
  子选项 **A2（区间 cells 不落盘）未做**——先实测体量再定，可回退（手册 §3 包 B 原分析）。
  另：`exportSvg` 对高度档导出嵌套集（视觉等价、体量 ~6×）；`visualCoreCell` 对区间元素
  =累积集视觉中心（与可见形状一致，更自洽）；区间档 `overlaps` 恒 []（生成期快照字段，
  累积后「重叠」语义待包 F）。

### 包 A ✓（2026-10-06，零行为变更）
- 手册落盘：本文；AGENTS §11 与 ROADMAP_REFACTOR §〇 加指针；HANDOFF 第三十七~三十九轮剪枝归档
  （`docs/history/HANDOFF_LOG_2026-10-06.md`，本体 156→137 行）。
- **死物删除（删前 src+tests 双向 grep 取证，删后 grep 归零）**：
  - `resetDataRev`（`core/rev.ts`，全库零引用）；
  - `touchHeight` 的 `_full` 参——实现体本就忽略（`_` 前缀），全链移除：
    `app/changePipeline.ts` → `app/store.svelte.ts`（ctx+门面）→ `app/commandService.ts`
    （接口+私有代理+historyEffect 两调用点）；
  - `app/drawController.ts` 的 `void placementAllows`（import 同步删；placement 闸真身在
    `membershipDraw.ts:61`，不受影响）与同块 `void ctrl` 噪声；
  - brush 四函数 `removeCellsFromRegion` / `adjustWeights` / `regionWeight` / `shareCellsWithOthers`
    （weight 词汇最后遗物；src 零引用、仅测试引用）+ `DrawSession.weightStep`/`weightDir`（零读者）；
  - 测试残骸：`draw.test.ts` 的 `setCenter` 测试块（该导出随「设中心」收敛到
    commandService.setCoreCell 时已删，测试文件当时即悬空=坏文件，本次一并清）+ removal 半段；
    `roads.test.ts` 的 weight 用例 + `adjustWeights` import。
  - 残留说明：`placementAllows`/`setCenter` 等名字仍出现在注释（考古记录，先例已存），
    不属可执行引用。
- **顺带发现 → 观察项**（已写入 ROADMAP_REFACTOR §三，不属包 A 范围）：
  `Region.weights` 现零写入者（读=regionIndex 平局取权/validate/序列化）→ 包 C 处置；
  绘制会话死参数链（`DrawInput.alt` / `paintHeight` 的 shift·ctrl·alt / `paint` 的 ctrl /
  零调用的 `store.paintHeight` 门面）→ 包 C/F 清理（需跨 Viewport→store→controller 签名）。
- 验收：src+tests 双向 grep 归零（除注释）；`npm run check` = svelte-check 0 errors
  （9 条 UI 存量 warning）/ tsc(app+node) 0；改过的两个测试文件单独 tsc 仅剩预存类型窄化提示
  （`resolved!.region`，非本次改动行，测试不在仓库 check 范围内）。
