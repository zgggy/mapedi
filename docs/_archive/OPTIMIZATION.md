# Mapedi 优化分析（架构 / 抽象 / 性能）

> 基于当前 `web/src` 实测结构（约 8.9k 行 TS+Svelte）。  
> 原则：**先消重复与上帝组件，再抽稳定接口；不为虚荣建继承树。**  
> 范围：不含 Rust/WASM（已另见 `wasm-core/`）。

---

## 1. 现状一览

| 模块 | 规模 | 角色 |
|------|------|------|
| `App.svelte` | **~1800 行** | 状态、生成编排、绘制、工作台 UI、导出、校验、布局… |
| `render/map2d.ts` | ~460 | 全量 2D 绘制（格子/河/路/条带/标注） |
| `core/*` | 分散 | 纯函数式算法为主，耦合面小 |
| `ui/*` | 面板壳 + 视口 + 3D | 边界尚可 |

**已经做得好的**

- Core 大体无 DOM，可测、可进 Worker  
- 投影 / 拾取 / 生成缓存已存在  
- 类型集中在 `types.ts`  
- 测试覆盖核心算法（41 个）

**主要债**

1. **App.svelte 上帝组件**（最大风险）  
2. **生成器函数族签名不统一**，App/Worker/主线程三套编排  
3. **Region 归属查询**到处线性扫 `regions`  
4. **邻接 BFS / 成本场 / 最近邻** 逻辑散落多处  
5. **绘制与视口状态** 用 `$state` 扁平堆在 App，难做撤销边界  
6. **序列化** 体积大（25k ≈ 13MB JSON），Map 往返靠手写展开  

---

## 2. 建议的模块边界（目标结构）

```
web/src/
  app/                     # 从 App.svelte 拆出
    stores/worldStore.ts   # 唯一 World 可变入口 + 订阅
    stores/uiStore.ts      # 焦点层、绘制会话、面板
    commands/              # Undo：DeleteRegion / Annex / Paint / SetCenter…
    pipelines/generate.ts  # 级联定义（Worker 与主线程共用同一表）
  core/                    # 保持纯函数；逐步改为「上下文对象」
    graph/                 # bfs.ts, costField.ts, components.ts
    index/                 # cellGrid.ts, regionIndex.ts
    generate/              # LayerGenerator 接口 + 各实现
    ...
  ui/
    workbench/             # 按 kind 的面板组件（从 App 抽）
  render/
    layers/                # cells, rivers, roads, stripes, labels, selection
```

不必一次搬完；**每刀只抽一个稳定接口**。

---

## 3. 可抽象点（接口 / 工厂 / 注册表，而非继承基类）

TypeScript 项目里优先 **组合 + 注册表**，避免 `class BaseGenerator` 深继承。

### 3.1 `LayerGenerator`（生成注册表）

现状：`generateCultures` / `generateCountriesCost` / `generateRoads`… 签名各写各的。

```ts
export interface GenContext {
  world: World;
  seed: number;
  params: Record<string, number | string | boolean>;
  /** 可选：已算好的场 */
  fields?: { biome?: Map<CellId, BiomeId>; climate?: Map<CellId, CellClimate> };
}

export interface LayerGenerator {
  layerId: LayerId;
  /** 依赖的其它 layerId，用于拓扑排序 */
  dependsOn: LayerId[];
  defaultParams: GenContext['params'];
  generate(ctx: GenContext): void; // 就地改 world.regions / world.cells
}

export const generators = new Map<LayerId, LayerGenerator>();
```

**收益**

- `worker.ts` 与 `generateOnMain` 合并为一张表驱动循环  
- `GenerationProfile` 与实现绑定，单层「重生成」一行代码  
- 自定义图层可注册生成器插件  

**落地**：先包 6 个已有函数为 6 个对象，不改算法。

### 3.2 `Command`（编辑撤销）

现状：`pushUndo()` 对 **整个 regions 快照**（浅拷贝 Map），粒度粗、内存大。

```ts
export interface EditCommand {
  label: string;
  apply(world: World): void;
  revert(world: World): void;
}
```

例如 `AnnexCommand`、`PaintCellsCommand`（记 cellId 增量而非整 Region）。

**收益**

- 撤销内存 O(改动) 而非 O(全图)  
- 生成操作也可做成 `PipelineCommand`  
- 与「绘制会话合并一笔」一致（stroke-level undo）  

### 3.3 `RegionIndex`（归属查询）

现状：`buildCountryFill` / `buildOverlapMembers` / stealFromSiblings / validate 都在扫数组。

```ts
class RegionIndex {
  // layerId -> cellId -> regionId[]
  byLayerCell: Map<LayerId, Map<CellId, RegionId[]>>;
  rebuild(world: World): void;
  onAdd/onRemoveCells(regionId, cells): void; // 增量
  owners(layerId, cellId): RegionId[];
  exclusiveOwner(layerId, cellId): RegionId | undefined;
}
```

挂在 `World` 旁或 `worldStore`；绘制、渲染、校验共用。

### 3.4 `CellGraph`（邻接工具）

重复模式：BFS 大陆、成本场、洪水填充、行省划分、连通检测、道路组件。

```ts
// core/graph/
export function bfsFlood(world, start, pass: (n: Cell) => boolean): CellId[]
export function multiSourceCost(world, seeds: {id,owner}[], cost: (a,b)=>number): Int32Array
export function components(world, members: Set<CellId>): CellId[][]
```

`political.ts` / `culture.ts` / `brush.ts` / `validate.ts` / `roads.ts` 全部改为调用。

### 3.5 `CellGrid`（空间索引，已有雏形）

`pickCell` 内的 2° 网格应抽成 `core/index/cellGrid.ts`，并供：

- 笔刷命中（当前 `cellsInBrush` 是 **全表扫描**）  
- 航线采样  
- 未来标注避让  

```ts
class CellGrid {
  constructor(cells: Cell[]);
  nearest(lon, lat): Cell | null;
  queryRadius(lon, lat, rDeg): CellId[];
}
```

**性能**：25k 笔刷时这是第一刀。

### 3.6 `RenderLayer`（绘制管线）

`drawWorld` 单函数 400+ 行，flags 越来越多。

```ts
interface RenderLayer {
  name: string;
  draw(ctx: CanvasRenderingContext2D, env: RenderEnv): void;
}
// env: cam, proj, cache, style, focus, selection, hover…
// 顺序：ocean → cells → stripes → rivers → roads → selection → labels
```

**收益**：条带/标注/路网可单独关；便于测宽高；避免 `focus === 'x'` 条件蔓延。

### 3.7 视图状态机

四视图已在 App 用字符串分支。建议：

```ts
type ViewMode = 'view-2d' | 'view-3d-near' | 'view-globe-flat' | 'view-globe-3d';
// ui/view/registry.ts: mode -> 可编辑? 需要 Three? 默认相机?
```

避免 `App.svelte` 里 `{#if viewMode === ...}` 继续膨胀。

### 3.8 序列化

手写 `weights` / `endpointOverrides` Map 展开易漏。建议：

```ts
// 使用 JSON replacer/reviver 统一处理 Map
const encode = (w: World) => JSON.stringify(w, mapReplacer);
const decode = (s: string) => JSON.parse(s, mapReviver) as World;
```

并考虑 **结构化克隆** 走 Worker（`postMessage(world)` 若 World 全是可克隆类型；`Map` 可克隆）。  
当前 Worker 传 JSON 字符串是正确的兼容选择，可保留，但 encode 一处化。

### 3.9 工作台 UI

按 kind 的分支已在 App 模板里很长。建议组件化：

```
ui/workbench/HeightWorkbench.svelte
ui/workbench/NestedPoliticalWorkbench.svelte  // 嵌套盒
ui/workbench/FlatListWorkbench.svelte         // 文化/宗教/动植物
ui/workbench/RoadWorkbench.svelte
ui/workbench/EnvironmentWorkbench.svelte
```

用 `svelte:component` 或 `{#if kind}` 映射。**App 只保留 store 接线。**

### 3.10 样式 / 群系表

`biomeColor` 在 Viewport 与 `BIOME_META` 重复；应只保留 `core/biomes.ts` 一处，UI 引用。

---

## 4. 数据结构优化

| 问题 | 建议 |
|------|------|
| `Cell` 对象数组 + 到处 `world.cells[id]` | 保持 id 数组访问；热循环用 SoA 缓存 `heights: Float32Array`、`isOcean: Uint8Array` |
| `Region.cells: number[]` + `Set` 临时 | 维护 `Uint8Array` 或 `Set` 与数组同步的 helper（`addCell/removeCell` 统一） |
| `rivers: Map<string, RiverEdge>` | 可改为 `Array<RiverEdge>` + 边索引；导出仍 JSON |
| 邻居变长数组 | 生成后压成 CSR：`nbrStart: Uint32Array` + `nbr: Uint32Array`，BFS 更快 |
| 序列化 13MB | 可选：多边形量化到 int16 相对坐标；或分块 gzip（浏览器 `CompressionStream`） |

---

## 5. 性能优化清单（按 ROI）

### P0（先做，改动小、收益大）

1. **`cellsInBrush` → CellGrid.queryRadius**（绘制热路径）  
2. **RegionIndex** 增量维护（渲染 fill 表 + stealFromSiblings）  
3. **drawWorld 仅重绘脏层**：相机不变时跳过 cells 层（已有 rAF；可加「世界版本号」）  
4. **标签** 按 scale 分档，过远不测宽  

### P1

5. 生成 **CSR 邻接** + 共享 `multiSourceCost`  
6. Globe/近景 3D：**只 tessellate 视口可见 cell**（与 2D 裁剪同思路）  
7. 球面/近景 **共享一份 geom 缓存**（同一 world+smooth+proj）  
8. `serializeWorld` 量化 + `CompressionStream`  

### P2

9. Canvas 分层：静态世界层 offscreen，交互层叠 hover/笔刷预览  
10. 12k+ 时标注降频（仅 pan 停止后画）  
11. IDB 自存去抖 + 只存 diff（后期）  

---

## 6. App.svelte 拆分路线（建议顺序）

| 步骤 | 抽出 | 之后 App 剩下 |
|------|------|----------------|
| 1 | `worldStore` + `useWorld()` | 生成/绘制调 store |
| 2 | `commands/*` + `undoStack` | 快捷键只 dispatch |
| 3 | `pipelines/generate.ts` | 点按钮 → pipeline.run |
| 4 | `Workbench/*.svelte` | 模板只 `switch kind` |
| 5 | `panels/*` 已有 overlay 迁入 store | 布局逻辑出 App |
| 6 | 状态栏 / gen-dock 小组件 | App ≈ 组装根 |

目标：**App.svelte &lt; 300 行**。

---

## 7. 明确「不要」的抽象

- 不要为每个算法建 `AbstractGenerator` 六层继承  
- 不要在 Core 引入 Svelte store 依赖  
- 不要过早 ECS（当前编辑器语义图层已够用；ECS 留给模拟阶段）  
- 不要把投影坐标当第二真相（已在需求中约束）  
- 不要为「可能的插件市场」预埋微内核——`LayerGenerator` 注册表足够  

---

## 8. 建议实施顺序（仍按迭代，不问选项）

1. **CellGrid + brush/queryRadius**（P0）  
2. **RegionIndex** 接入 map2d / steal / validate  
3. **LayerGenerator 注册表** 合并 Worker/主线程编排  
4. **Command 撤销** 替换全量 regions 快照  
5. **Workbench 组件拆分** + App 减重  
6. **RenderLayer 拆 map2d**  
7. **序列化压缩 / CSR 邻接 / 3D 视口裁剪**  
8. 再评估 WASM 是否仍需要（很多热点在索引后可能已够）  

---

## 9. 验收方式

| 项 | 指标 |
|----|------|
| 25k 平移缩放 | 中端核显 60fps 目标，或至少稳定 &gt;30fps |
| 笔刷 stroke | &lt; 16ms 级反馈 |
| Undo | 100 次绘制后内存不线性爆 |
| App.svelte | 拆完 &lt; 300 行 |
| 新图层 | 实现 `LayerGenerator` + 工作台 kind 映射即可接入，不改 App 主干 |

---

## 10. 小结

当前代码 **功能完整度高、算法可测**；主要债在 **App 巨石、查询无索引、生成无统一协议**。  
优化应走：**索引与热路径 → 生成注册表 → 命令式撤销 → UI/渲染分层**，而不是先上 WASM 或重型框架。

---

## 11. 实施进度

| 步骤 | 状态 |
|------|------|
| CellGrid + 笔刷/拾取 | **完成** `core/index/cellGrid.ts` |
| RegionIndex + fill/overlap/steal | **完成** `core/index/regionIndex.ts` |
| LayerGenerator 注册表 | **完成** `core/generate/registry.ts`（Worker/主线程共用） |
| Command 增量撤销 | **完成** `core/history.ts`（绘制/删除/吞并/新增/中心；Ctrl+Z / Ctrl+Shift+Z） |
| Workbench 组件拆分 | **完成** `ui/workbench/WorkbenchHost.svelte` + `layerMeta.ts` |
| RenderLayer 拆分 | **完成** `render/layers.ts`（bg/cells/stripes/rivers/roads/lasso/labels 管线） |
| 浮层 chrome 组件 | **完成** ViewDock / Validator / Project / GenDock / BrushHud / LayerList |
| CellGraph CSR + 大陆连通 | **完成**；项目导出优先 **.gz** |
| **EditorStore** | **完成** `app/store.svelte.ts` |
| **App.svelte** | **~430 行** |
| **StatusStrip + Profile UI** | **完成**；`runCascade` 支持 profile 参数与 enabled 过滤 |
| **球面蓝噪声 Voronoi** | **完成**（替代 Fibonacci，消除格点感） |
| **邻接重建** | **完成**（共享 Voronoi 顶点 + 网格 kNN，无 O(n²)） |
| **去 d3-delaunay** | **完成** |
| 剩余 | 实机 FPS 分层、Clipper2、App&lt;300 |
