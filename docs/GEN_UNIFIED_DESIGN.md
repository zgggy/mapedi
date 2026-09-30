# Mapedi 统一图层生成架构（设计稿）

> **定位**：生成子系统的架构设计（2026-09-30 需求“尝试设计为一套统一的架构”+“考虑是不是统一的”的正面回答）。
> **状态**：设计待审。语义接线部分（§4 已完成行）随 UI 重排包已落地；数据模型重构（§6 引擎包）**待本设计过目后实施**。
> **用户原话语义锚点**（2026-09-30）：生成针对图层 / 不再存在总的生成功能 / 地块=重新撒点 / 高度=生成高度图+删除海陆图层 / 环境及以下=无子图层以 cell 为单元、有子图层先生成子图层再以子图层元素为单元（递归）/ 图层不允许有多个子图层但允许多层子图层 / 默认子图层=地块图层（元素=地块）/ 地块层特殊=重新撒点 / 高度层特殊=赋高度 / 不依赖地块的图层（路径类）生成方法待设计先不做。

---

## 1. 动机：现状有三处“层间关系”各自硬编码

| 关系表达 | 位置 | 语义 | 问题 |
|---|---|---|---|
| `LayerDef.parentLayerId` | `world.ts:136`（仅 province→country 一处） | 显示父子（嵌套展示） | 几乎未用；若继续手填会与生成关系漂移 |
| `GenerationProfile.dependsOn` | `profile.ts`（13 层各手写数组） | **混合**了“单元源”与“数据依赖”两种语义 | 语义混装；加层要手写 |
| `CASCADE_ORDER` | `profile.ts:11` 硬编码数组 | 生成时序 | 与 dependsOn 冗余双真相 |
| `GenConfig.fromLayerId` | `layer.ts defaultGenConfig` | 单元源（仅 country） | 单元源散落第三处 |

统一架构的核心动作：**把“生成单元从哪来”提为单一关系 `genParent`，其余关系从它推导**。

## 2. 核心模型：生成链（genParent 单源）

```ts
/** 每层恰好一个生成单元源（unit source）；cells 为默认根 */
genParent(layer): LayerId   // 缺省 = 'cells'
```

**模型规则**（逐条对应用户原话）：

| 规则 | 原话对应 |
|---|---|
| R1 每层**恰好一个**单元源（唯一，出度=1） | “图层不允许有多个子图层”（= 单元来源唯一，不是从多层取单元） |
| R2 链可任意长（生成时递归到底） | “允许有多层子图层，此时生成方法是递归的” |
| R3 无显式单元源的层默认 `genParent='cells'` | “没有子图层的元素其实就是默认的子图层叫地块图层，地块图层的元素就是地块” |
| R4 `cells` 层无单元源，生成 = 重新撒点（破坏性，全上层失效） | “地块图层没有子元素…特殊，生成时是重新撒点” |
| R5 `height` 层单元源 = cells，生成 = 地形算法**赋高度**（+派生海陆） | “高度图层…生成之后…还会赋值高度，所以也是特殊的” |
| R6 普通层生成：先递归生成单元源层（若不可用），再在其元素邻接图上 `randomConnected` 布局 | “有子图层的，首先生成子图层元素，然后以子图层元素为基本单元” |
| R7 路径类（river/road/route）不以 cell 为单元 → **方法待设计，不做** | 原话 |
| R8 生成只写 `Region.cells`（可及 attributes），不碰几何/拓扑 | 统一性约束（§5） |

**递归生成伪代码**：

```
regen(L, params):
  if L == cells:  重新撒点(Voronoi) + 级联全失效上层      # R4
  if L == height: 地形算法 → 赋 cell.height → 海陆删旧建新 # R5
  U = genParent(L)                                        # R1/R3
  if U != cells and U 无可用元素: regen(U)                 # R2 递归
  units = (U == cells) ? cells : U 的元素
  L.elements = randomConnected(units, L 的 scope/pattern)  # R6
```

**生成时序**：`CASCADE_ORDER` 数组删除，改为两条边的**拓扑排序**——
① 单元源边 `L → genParent(L)`；② 数据依赖边（现有 dependsOn 中**非单元源**的部分，如 environment 需要高度值：`environment → height`）。两者取拓扑并集。

**已知链**（现状核对，标注增量）：

| 层 | genParent | 数据依赖 | 现状 |
|---|---|---|---|
| cells | —（根） | — | 撒点 ✓（接线见 §4） |
| height | cells | — | 地形 ✓（接线见 §4） |
| province | cells | height（海陆划分 noCrossLandSea） | ✓ 现状（randomConnected on cells） |
| country | **province** | — | ✓ 现状（fromLayer=province，聚合 3 省成国） |
| environment…military | cells | height | ✓ 现状（randomConnected on cells） |
| river | cells（待设计） | height | ☐ 待设计（R7） |
| road / route | country？（现状 dependsOn=country 仅时序） | country | ☐ 待设计（R7） |
| landsea | **height（派生）** | height | ✗ 特例：非随机生成，由高度派生重建（§3） |

## 3. 海陆层（“删除海陆图层”的两案）

**代码事实**：海陆层从不参与生成级联（无 profile），是高度变化时 `rebuildLandSeaRegions` 派生重建的；显示契约中“海岸”本就挂高度层 cellSet。

- **案 B（已落地）**：图层保留；「生成高度图」= 地形重跑 + **海陆元素删旧建新**（`regenLayer('height')` 内调 `rebuildLandSeaRegions`，2026-09-30 需求原话语义）。派生层概念进模型：`genParent(landsea)=height` 且 `derived=true`（生成 = 派生重建，非随机布局）。
- **案 A（待拍板，不实施）**：产品级删除海陆图层——大陆/海洋分布由高度层 12 档区间元素表达（本就含海陆色）。牵动：内置层列表、旧档迁移、rebuild 调用链、显示契约测试。**需要用户明确决策，本稿不擅自执行。**

## 4. 与整体架构的统一性分析（“是不是统一的”）

**结论：是——且本设计反过来消灭了现状的一处潜在双真相。** 逐条对照：

| 架构红线 | 生成链的符合方式 |
|---|---|
| **归属唯一真相 `Region.cells`** | 生成的全部输出 = 写 Region.cells（R8）；海陆/高度是派生或属性，不另立归属真相 |
| **拓扑单源（禁键反推邻接）** | `randomConnected` 吃的邻接 = 单元层元素的邻接图，最终源自 Delaunay/faces（单元=cells 时直接是 cell.neighbors；单元=元素时由共享 cell 推导）——不引入第二套邻接 |
| **六层定位模型** | 生成链是**数据层**关系（对象由什么构成），与坐标/投影/渲染零耦合；“重新撒点”是数据层事件，渲染只经 touch 失效感知 |
| **显示层特殊性限制在显示层** | 生成不动样式；`genParent` 是数据关系 |
| **一处实现 / 消灭双真相** | `CASCADE_ORDER`+`dependsOn`+`fromLayerId` 三处 → 从 genParent+数据依赖**推导**；`parentLayerId`（显示父子）与 genParent **同构**：`parentLayerId(L) = 唯一以 L 为单元源的语义层 U`（省显示在国下 ⇔ 国由省聚合；environment 无显示父 ⇔ 没人从 environment 聚合）——显示树改为**从 genParent 投影**，不再手填 |
| **与 `randomConnected`/`fromLayer` 现有算法** | 本设计是它们的泛化（单元源参数化），不是重写——生成算法层基本不动 |

**一个诚实的边界**：`dependsOn` 里“environment → height”是**数据依赖**（需要高度值定海陆），与 genParent（单元源=cells）**是两种真实存在的不同关系**——本设计不强行合并二者，而是显式区分“单元源边”与“数据依赖边”，时序=两者拓扑并集。这符合 AGENTS §4“领域定义必须显式”：两个概念各有单源，而不是像现状那样混在一个 dependsOn 数组里。

## 5. UI 语义映射（2026-09-30 四把手包已实现）

左栏工作区 = 图层把手（左轨顶）+ **绘制 / 生成 / 显示**三把手（FoldHandle 单源样式）+ 元素列表常驻：

- **生成把手**按焦点层三分支：`cells`=重新撒点（种子/地块/地形旋钮，整世界重建）；`height`=生成高度图（地形旋钮，海陆删旧建新）；有 profile 的层=单层再生成（params 控件）；路径类/无 profile=把手禁用（“待设计”/“无生成配置”）。长按 900ms 满格触发（D5），单击开合。
- 球面模式：绘制/创建/生成把手隐藏（纯显示），显示把手（StyleSet）与图层/列表保留；球面参数移回顶栏 ⚙（3d/2d 按模式互斥显示）。

## 6. 实施分期

| 包 | 内容 | 状态 |
|---|---|---|
| **语义接线包** | 三分支生成把手、cells=撒点、height=高度图+海陆、路径禁用、四把手 UI、⚙ 挪位、球面组回迁、紧凑统一、搜索按钮化 | ✓ 本包（随 UI 重排落地） |
| **引擎包（待本设计过目）** | ① `genParent` 单源表进 `LayerDef`（或独立 registry）；② CASCADE/dependsOn 删除改拓扑推导；③ regen 递归化（R2）；④ `parentLayerId` 改为 genParent 投影 + 旧档校验/迁移；⑤ 单元邻接图的统一获取（cells=cell.neighbors，元素=共享边聚合） | ☐ |
| **路径生成（R7）** | river/road/route 的非 cell 单元生成方法 | ☐ 待设计（用户明示先不做） |
| **海陆案 A** | 产品级删除海陆图层 | ☐ 待拍板 |

## 7. 待拍板

1. **海陆案 A/B**：B 已按原话语义落地（生成时删旧建新）；A（产品级删除图层）做不做？
2. **引擎包**是否按 §6 范围实施（genParent 单源 + CASCADE 推导 + 递归 + parentLayerId 投影）。
3. `parentLayerId` 投影规则的细节：`cells/height` 作单元源时不产生显示父（底座层），仅语义层聚合产生显示父——认可此规则？
