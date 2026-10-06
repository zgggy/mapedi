# 图层受限架构 · 目标态设计与迁移（2026-10-06）

> 依据：用户《地图编辑器数据模型思考记录》§8/§9/§10/§11/§12（**目标态原文**）+ 用户 2026-10-06 裁定
> （「多归属不是独立概念，它只是图层受限架构下的一种表现形式；受限架构下不存在子图层/父图层」）。
> 现状证据：`docs/CONSTRAINT_SEMANTICS_2026-10-06.md`（file:line 审计快照）。
> 本文是**目标态设计 + 迁移路径**——不把现状当基线、不为旧模型设保留项；分期只服务「每步可独立验收」。

---

## 0. 立场（先划清）

- **唯一机制**：图层之间只有一种关系——「图层 A 受限于图层 B」（集合判定 ＋ Min/Max ＋ 反受限开关）。
- **没有父子概念**：所谓「父子图层」「游离」「多归属/争议区」都只是这套参数的**取值分支**，
  不是并列概念；代码里现存 `parentLayerId` / `parentId` 是这套机制的历史实现形态，将被换底。
- **占据 = 自持 ∪ 聚合**：任何图层任何元素的占据由两类来源构成——①直接绑定的地块；②反受限聚合
  （被它「包含」的受约束层元素的地块并集）。「父元素不能直接持有地块」的旧约束随之作废。
- **多归属内建**：Max=N 时一个元素可同时归属 N 个目标元素——这就是争议区，编辑器负责标出。
- 两条**不动的项目红线**（2026-10-06 前已裁定，语义等价实现）：定向失效 + 增量（不做 §10 式全局重算，
  以 cause→touch 表保证同语义）；`Region.cells` = 渲染唯一占据输入（契约不动，见 §3）。

## 1. 数据模型（目标态）

### 1.1 关系声明（挂在**受约束侧**，单向引用）

```ts
export interface LayerConstraint {
  /** 目标图层：本层元素受「该层元素」约束 */
  of: LayerId;
  /** 集合判定：contained=被包含 | exclusive=互斥 | intersects=相交 | superset=超集 | equal=等价 */
  set: 'contained' | 'exclusive' | 'intersects' | 'superset' | 'equal';
  /** 数量范围：满足该集合关系的目标元素个数（min=0 ⇒ 允许游离；max=null ⇒ 不限） */
  min: number;
  max: number | null;
  /** 反受限：开 ⇒ 目标元素占据 = 满足关系的本层元素占据并集 ∪ 自持；关 ⇒ 单向门槛（本层改动不动目标） */
  backPropagate: boolean;
}
// LayerDef.constraints?: LayerConstraint[]   —— 一个图层可声明**多条**（数组）
```

- 元素级链接只有 `contained` 需要持久化（「a 属于 b」= 归属），其余判定**只校验不存链**：
  ```ts
  // Region.parents?: RegionId[]   —— 只装 contained 关系的目标元素（多归属=数组多值）
  ```
- 不变量：`parents` 中每个 id 必须是「某条 `contained` 约束的 `of` 层」的元素（读档修复负责清理）。

### 1.2 显示树（关系 ≠ 视图，必须解耦）

- `LayerDef.displayParent?: LayerId`（**视图**：叠放序 / 件切片 `displayAncestors` / 标签归属名）。
- 显示树**必须是一棵树**（叠放是视图约束）；受限关系可以是**菱形/DAG**（多归属）。
- 显示树允许**多子**（泛化：`childrenOf(world, layerId): LayerId[]` 取代单子链
  `childLayerIdOf`）；缩进/提升/显示列表操作在树上进行。
- 默认值：新建约束时若目标层尚无显示子 → 自动把本层挂为其显示子（一次设定，之后可改）。

### 1.3 占据与自持

- `Region.cells`（契约不动）= **最终占据** = 自持 ∪ 聚合；渲染/拾取/标签/存档全部照旧读它。
- `Region.selfCells?: CellId[]` = **直接绑定**部分。**仅当该元素有反受限入边**（某条 `backPropagate`
  约束的 `of` 层指向本层）时存在；无入边元素 `cells` 即直接绑定，不写 `selfCells`（省字段省存档）。
- 不变量（任意时刻，物化后）：
  1. 有入边：`cells == selfCells ∪ ⋃{a.cells | a.parents ∋ b.id}`（去重）
  2. 无入边：`selfCells` 缺席，`cells` = 直接绑定
  3. 绘制/生成写入**直接绑定**字段：有入边的元素写 `selfCells`、无入边的写 `cells`（统一走 occupy 写入器）
- 派生性：`cells` 对聚合目标是**可重算派生**（载入时由 `selfCells`+链接重算，见 §5 迁移）——
  「规则/关系在重算期落成占据」与包 B 的高度档同构。

## 2. 计算与失效

### 2.1 聚合（物化）＝ 通用反受限

```
materializeBackPropagate(world):
  for 每条 (A, c) 其中 c.backPropagate:
    acc: Map<目标元素 b → Set<CellId>>
    for a ∈ A 的元素: for b ∈ a.parents: acc[b] ∪= a.cells
    for b ∈ c.of 层: cells(b) = selfCells(b) ∪ acc[b]
```
- 多归属天然成立（一个 a 同时进多个 b）；多层嵌套逐级聚合（联盟→国家→行省：一层一跑，顺序=拓扑序）。
- 复杂度 O(Σ|a.cells|)——与今日 `materializeParentCells` 同阶（现状每次 `touchRegions*` 全量跑）。
- **定向化（后续优化，不改语义）**：脏元素沿 `parents` 上溯只重算受影响目标；挂在包 F 的 cause→touch 表。

### 2.2 触发表（与包 F 共用一张表）

| 编辑 | 失效/重算 | 渲染 |
|---|---|---|
| 画/擦 A 的归属（写 `cells`/`selfCells`） | 上溯重算各 `backPropagate` 目标（含多层） | 受影响元素走既有增量：`queuePieceInvalidation` / Δ 补丁 |
| 断/加链接（parents 增删） | 老目标 + 新目标各重算 | 同上 |
| 目标元素自持编辑（写 selfCells） | 本元素重算（不含上游） | 同上 |
| 删除元素（见 §4 策略） | 子元素的 parents 移除该 id → 重算受影响目标 | 同上 |
| 撤销/重做 | 命令回放后按类型重算（`HeightCellsCommand` 先例） | `touchWorld` 族 |
| 载入/导入 | 读档修复 + 全量物化一次 | 全量重建 |

## 3. 绘制、闸与校验（三层，各司其职）

1. **逐格可判 → 绘制闸**（写入期，用包 C `setOccupyGuard` 或绘制路径直查）：
   `contained` 且 `min ≥ 1` ⇒ 该格必须落在**某个目标元素**内。这就是「单向地形门槛」——
   目标层可以是内置高度层，也可以是包 D 派生层（用户例「陆海层」：宗教只能画在「陆地」元素内）。
2. **计数/非逐格 → 校验器**（`validateWorld` 扩展）：`min/max` 计数、`exclusive/intersects/superset/equal`
   全集判定（含跨图层的争议区报告：一个元素同时满足多个目标 → 标为争议区）。
3. **结构不变量 → 闸**（`gate.ts` 泛化）：悬空/环（沿 `parents` DAG 检测）/桥不变量
   （`parents` 中每个目标都必须来自合法约束层）；**循环受限**（A 受 B 且 B 受 A 且两边 `backPropagate`
   → 冲突警告，不自动解，§10）。

## 4. 删除策略（`policy.ts` 泛化）

四场景表改数组语义：删元素 / 吞并 / 删层 / 撤销——
- 删元素：子元素 `parents` 移除该 id（数组空 ⇒ 游离，Min=0 合法）；
- 吞并（同层重挂）：`parents` 的替换去重（数组 COW，快照随命令）；
- 删层：该层元素的约束声明随层消失；其他层对它的约束一并移除；受影响的目标重算。
- 快照类型 `ChildParentFlip{parentId}` → `{parents: RegionId[]}`。

## 5. 序列化与迁移（formatVersion 3）

- **写**：`LayerDef.constraints` + `displayParent`；`Region.parents` +（必要时）`selfCells`。
- **读（旧档双读，一次迁移）**：
  - `LayerDef.parentLayerId: P` → `displayParent = P` + `constraints += { of: P, set:'contained', min:0, max:1, backPropagate:true }`
    （旧父子 = 该组参数，**行为逐位等价**）；
  - `Region.parentId: p` → `parents = [p]`；
  - 聚合目标的 `cells` 载入后由 `selfCells`+链接**重算覆盖**（存量自持迁移：见 §7 反例「旧档自持」）。
- 旧字段不再写出；读档修复（`repairHierarchy`）改为 DAG 语义（悬空移除、环断开、桥校验）。

## 6. UI（检查区/元素面）

- 图层面新增「受限关系」区：每条约束一行（目标层 · 集合判定 · Min/Max · 反受限开关）；
  **快速配置列表**（§11 原文）：父子从属 / 多归属行政 / 单向地形门槛 / 自定义；可存为模板复用；
  **约束继承**（§12）：一键复制另一层的全部约束参数。
- 元素面：隶属行改多父列表（可跳转）；**争议区徽标**（`parents.length > 1`）；
  悬停归属列表已能列多归属（`store.regionIdsOfCell`）——补争议区视觉标记即可。
- 显示树仍以「叠放/切片」呈现（`displayParent`），与受限关系统一分区展示，但**概念上标明二者不同**。

## 7. 分期（每期一个可独立验收的整包；目标是终态，不是保留旧模型）

| 期 | 内容 | 验收 |
|---|---|---|
| **E1 换底** | `constraints[] + displayParent + parents[] + selfCells` 数据模型与读档迁移；`materializeBackPropagate`（等价今日物化，含多归属能力）；闸/策略/校验/UI 全链改数组/声明（**行为保持**：旧档迁移前后渲染与物化逐位一致） | 旧档迁移逐位（同 seed 载入对比）；绘制/生成/撤销/存档回环全回归；tsc/check 0 |
| **E2 多归属打开** | Max=N：同一元素多目标（争议区）；闸按 Min/Max 放行；删除策略数组语义；UI 多父列表 + 争议区徽标 | 端到端：行省同时属两国 → 两国疆域都含它（聚合）+ 撤销逐位 + 存档回环 |
| **E3 自持地块** | 聚合目标可自持（`selfCells`）；绘制写自持；物化 ∪ 自持 | 端到端：国家自持无人区 + 行省聚合共存；重载逐位 |
| **E4 单向地形门槛** | `PlacementRule` 谓词路径删 → 约束「contained/Min≥1/backPropagate=false」；目标层＝高度层或包 D 派生层 | 端到端：宗教层受限于陆海层「陆地」→ 海上画不上；配置走检查区 |
| **E5 判定扩展 + 配置面** | `exclusive/intersects/superset/equal` + Min/Max 通用校验 + 快速配置列表/模板/继承 UI | 各判定最小案例 + 校验报告 + 模板复制 |

**总验收口径**（沿用手册 §4）：既有量化基线回归（档色四类/跨线四点/锚定 0 误差/mask 0 破）＋
每期新不变量＋存档回环逐位＋undo 干净＋tsc/svelte-check 0。

## 8. 反例清单（每期必过）

多层链（联盟→国家→行省→地块）逐级聚合；菱形（一行省属两国）；游离（Min=0）与重新归属；
删除父元素/父图层后的悬空清理；跨 180° 元素参与聚合（按 cellId 集合，与几何无关 ✓ 需实测）；
自持与聚合重叠（union 去重）；画在聚合目标上的格（写 selfCells）与画在叶层（写 cells）；
撤销多归属编辑逐位；旧档两代迁移（含「旧档里父元素自己画的格」——迁移时这些格当前**不在**任何
`selfCells`，会被物化吃掉 → E3 迁移规则必须显式处理：把"非子并集的父格"搬进 `selfCells`）；
循环受限检测；100k 世界物化性能（p50 不劣化）。
