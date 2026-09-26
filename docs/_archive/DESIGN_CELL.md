# Cell 中心数据结构 · 设计契约

> 版：v1.0 可实施 · 2026-09-23  
> 原则：**Cell 是唯一几何原子**；元素 = id 引用 + cell 集 + 核心格 + 标签槽；查询走索引，复杂度 O(1)～O(k)。

---

## 1. 分层

```text
Cell（原子）          多边形 / 中心 / 邻接 / 高度…   ← 真相
   ↑ 引用
Element（元素）       layerId + cells[] + core + name…
   ↑ 引用
Layer（图层）         显示开关 / 透明度 / 显示父子
   ↑
Label / Display       由 Layer + Element 派生，不另存一套几何
```

**禁止**：元素自带与 cell 无关的第二套多边形真相；标签不得绑死在某一图层的临时 UI 状态里。

---

## 2. Cell

```ts
interface Cell {
  id: CellId;
  polygon: LonLat[];     // 球面环
  center: LonLat;
  neighbors: CellId[];
  height: number;
  isOcean: boolean;
  area: number;
  continentId?: number;  // 可选缓存，真相仍在 Element.cells
}
```

Cell **不**存「属于哪个国家」——那是 Element→cells 的引用；反向查询走索引。

---

## 3. Element（现 Region 扩展）

```ts
interface NamePlacement {
  /** 锚定：优先 cell 中心，可偏移 */
  cellId?: CellId;
  lon?: number; lat?: number;
  dx?: number; dy?: number;     // 屏幕/投影微调
  rotateDeg?: number;
  fontSize?: number;
  visible?: boolean;            // 缺省 true
}

interface Region {
  id: RegionId;
  layerId: LayerId;
  name: string;
  cells: CellId[];              // ← 正向：元素包含哪些 cell
  /** 核心地块：首都 / 省会 / 文化中心… */
  coreCellId?: CellId;
  coreLabel?: string;           // 「首都」「省会」「圣城」
  /** 名称显示位置与参数 */
  nameStyle?: NamePlacement;
  parentId?: RegionId;          // 数据行政（国家⊃行省）
  color: string;
  exclusiveColor?: string;
  attributes: Record<string, unknown>;
  weights?: Map<CellId, number>;
  endpointOverrides?: Map<CellId, LonLat>;
}
```

每层固定语义槽位（attributes 或强类型字段）由 **Layer.kind** 约定模板（政治=政体/附庸，文化=语言…），schema 另见 `DESIGN_ENTITIES.md`。

---

## 4. 索引（查询复杂度）

`core/cellIndex.ts`，编辑后 `invalidateCellIndex()`。

| 接口 | 含义 | 复杂度 |
|------|------|--------|
| `owners(cellId)` | 该格被哪些元素占据（全部层） | **O(k)**，k=重叠元素数（通常 0–3） |
| `ownersOn(layerId, cellId)` | 某层上占据该格的元素 | **O(k)** |
| `cellsOf(elementId)` | 元素含哪些格 | **O(1)** → 直接 `region.cells` |
| `coreHolder(cellId)` | 谁把该格当核心地块 | **O(k)** |
| `isCore(cellId, elementId)` | 是否核心 | **O(1)** |
| `elementsOf(layerId)` | 层内元素 id 列表 | **O(1)** 均摊 |
| `labelOf(elementId)` | 名称 + 放置参数 | **O(1)** |

**重建**：`O(Σ|e.cells| + |regions|)`；仅归属/核心/名称变更时失效。

**实现要点**：
- `cellOwners: CellId → RegionId[]`（邻接表，不用 Set 迭代）
- `coreHolders: CellId → RegionId[]`
- `byId: RegionId → Region`（查找）
- `byLayer: LayerId → RegionId[]`

---

## 5. 标签跟图层

- 标签**只画当前焦点层**（或最上可见语义层）的元素名 + `coreLabel`（首都图标/文字）。
- 放置：`nameStyle` 若有则用之；否则元素 **有效 cell 质心**（unwrap 后平均，见 `displayCompose.effectiveRegionCells`）。
- 显示切分碎片时，标签用碎片名 `c(A)`，但锚点仍在碎片 cell 质心。
- 不为「每个图层各存一份标签图层」；图层显隐 = 标签显隐。

---

## 6. 默认「区域」虚拟层

| 项 | 规则 |
|----|------|
| 触发 | **没有任何语义色层可见**（高度/国家/文化…全关；地块网格、路航河除外） |
| 填色 | **全部 cell = 大海色**（`style.ocean`） |
| 划分 | 按 **大陆连通**（height>0）与水体，**与高度层建元素同一套 flood** |
| 边界 | 只描区域外轮廓（直线，不平滑） |
| 标签 | `大陆 n` / `海洋 n`（可关） |
| 数据 | **不写入** `world.regions`；运行时由 `buildDefaultRegionPieces(world)` 得到 |
| 与高度层 | 高度层打开 → 高度着色，**不再**走默认区域填色 |

---

## 7. 与显示合成关系

```text
cellsLayer        地形底（高度开=高度色；否则默认区域=全海色）
defaultRegions    （仅无语义层时）区域边界 + 标签
displayStack      各可见语义层自己的 Element（含 c(A) 切分）
cellsMesh         仅 focus==='cells' 时描 cell 边
labelsLayer       仅焦点层名 + 核心格标签
bordersLayer      可见语义层 owner 环
```

---

## 8. 迁移

1. `Region.coreCellId` 已有；补 `coreLabel?`、`nameStyle?`（缺省可空）。  
2. `RegionIndex` 并入/委托给 `CellIndex`（owners 核心查询）。  
3. 默认区域为纯函数 + 渲染，**零迁移**。  
4. 后续 WorldEntity/Relation 只引用 `RegionId`/`CellId`，不复制 cell 列表。

---

## 9. 实施顺序

1. ✅ 本契约  
2. `cellIndex.ts` + 测试  
3. `defaultRegionPieces` + 底色/边界  
4. `labelsLayer` 收束到焦点层 + coreLabel  
5. `Region.nameStyle` UI（后续）
