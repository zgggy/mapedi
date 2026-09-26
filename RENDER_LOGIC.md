# Mapedi 显示逻辑一览（供审阅）

> **现行契约**（过时稿见 `docs/_archive/`，勿参考）  
> 统一接口：选中 ≡ 显示；唯一边界类 = 元素边界；填充 = 边界内填充

## 核心约定

1. **`isLayerShown`**：`visible || 选中(focusLayerId)` —— 点选中与点显隐，地图上**同一套**填充+边界  
2. **`composeShownPieces`**：所有 shown 层的元素碎片（含父内切分 `c(A)`），**无图层特殊性**  
3. **`elementsLayer`**：唯一绘制入口  
   - 海岸线（陆–海）**默认一直画**（显式常显，不进第二套 pipeline）  
   - 每个 **DisplayPiece**：边界环跟 **`piece.cellIds`**（与填色同一集合身份）  
   - **`prepareDisplayRings` 一次** → 所有可见世界副本合成单个 evenodd 填充遮罩和真实边界路径；填充 / 内阴影 / 描边共用  
   - **z 序（后画=高，无图层名特例）**：  
     1. 焦点图层 > 列表上层第一层级 > 列表下层第一层级  
     2. 同树内：子 > 父 > 父父…  
     3. 工作区选中元素最顶  
4. 无逐 cell 语义填充；无独立海岸/国界类；**已删** `_deprecated/` 与 `stripesLayer`  
5. 极区：全域蓝噪声撒点，不强制极点站点、不剔除极区。南北极各归属最近站点的普通 Voronoi cell（极点方向点积最大）；旧存档也从站点派生归属，不另存极点身份。`PROJ_LAT_MAX=89.5`（数值上限）+ `FRAME_LAT=85`（裁剪框）；球面共享边不因经度差大而丢弃，边中点先在球面求出再投影。圆柱投影按实际横向周期展开经度：绕行环的最后一段终止于首点的**相邻世界副本**，仍是真实 Hermite 段；随后沿极点归属对应的顶/底框补仅供填充的虚边。区域的极点归属从同一 `cellIds` 求出，不能另铺整幅底面。南北极均在区域内时，各绕行环按自身纬度侧闭合；均不在时两条边同侧闭合，evenodd 得到中间带。开链不补假边。
   所有副本的环一次性 evenodd 填充，不能各副本单独涂半透明色。唯一无环的全世界 cell 集按完整外框填充，不把它当作极点底面。副本身份是整数 `k`；先按 `k` 去重，再计算 `contentOffsetX + k·period`，不得对浮点偏移用 `Set<number>` 去重。极点 cell 的投影拾取多边形按其真实边展开、在自己的周期内沿顶/底框闭合；地块网格只描 `Cell.polygon` 的真实边，不描虚边。相邻副本的极点不跨周期连线。
   若共享边不完整，保留开链以暴露拓扑问题；不得以弦或投影框立柱把它伪装成封闭大陆。
6. **区域边界 ≠ cell polygon**：边界过**边中点** Hermite；cell 贴角多边形只用于网格/几何，两者不可混用

## 静态层烘焙与缓存

静态层（海色底、网格、元素填充/边界/内阴影）按 1:1 分辨率烘焙到离屏贴图，显示时不拉伸。两种模式：

- **period 模式**（缩小视图）：贴图覆盖一整个投影周期带接缝余量。烘焙时相邻周期的几何仍参与同一元素的 evenodd 遮罩；目标画布按设备像素给每个周期分配互不重叠的区间，余量仅供接缝采样，绝不重复合成半透明像素。相机水平位置和内容偏移只决定平铺位置，不参与失效。
- **viewport 模式**（放大视图，period 贴图超预算时自动切换）：贴图只覆盖视口 + 30% 余量。相机位置按余量分桶，余量内平移不失效；出界或缩放/DPR/投影/样式/数据变化时重烘焙。

两种模式都遵守：**不得拉伸低分辨率贴图代替清晰绘制**。缩放改变时重烘焙（1:1）。路径、符号、标签、外框及拾取按实时投影坐标处理。非周期投影和路径编辑走矢量直绘。SVG 导出继续使用矢量路径。

## 模块边界（`core/ring/*`）

| 模块 | 职责 |
|------|------|
| `displayRing.ts` | MidRing/DisplayRing、`toDisplayRing` 不变量、洞分类 |
| `build.ts` | **`cellIds` → 边界环**（无 owner）；保留所有有效共享边，边中点在球面求值 |
| `normalize.ts` | unwrap + 周期真实终点 + 仅供填充的对应极侧框边 → DisplayRing[]；开链不补假边 |
| `hermite.ts` | **中点 Hermite 唯一实现**（ctx / Path2D / SVG 共用）；fill 走闭环，outline 只走真实段 |
| `trace.ts` | 其他调用点的路径/阴影辅助；`elementsLayer` 的内阴影使用合成后的同一 evenodd 遮罩 |
| `path2d.ts` | Path2D 缓存壳（WeakMap 按 ring+smooth+mode）；曲线求值只在 `hermite.appendMidRing` |

`ownerPolygon.ts` 兼容门面已删；`defaultExclusiveColor` 在 `core/layer/style.ts`。

**DisplayRing 不变量**：`verts.length === pts.length`；`virtualFrom` 之前都是过边中点的真实段，之后仅是供填充的直线。真实环不因投影切口增加第二套归属。

## 身份（唯一真相）

| 身份 | 来源 | 派生 |
|------|------|------|
| **Cell.polygon** | Voronoi 焊接后 | `sharedEdges`、网格、球面、拾取 |
| **Region.cells** | 归属真值 | 边界环、填色、标签 |
| **DisplayPiece.cellIds** | 显示切片 ⊆ region.cells | 与 Region **同一** cellSet 环 |

无 owner；海岸 = 高度 continent/lake 的 cellSet 环（与大陆框同 Entry）。

## 管线

| # | 层 | 职责 |
|---|-----|------|
| 1 | `bgLayer` | 海色底 |
| 2 | `cellsLayer` | 选中高亮描边 |
| 3 | `cellsMeshLayer` | 「地块」网格（仅该层选中/显示） |
| 4 | **`elementsLayer`** | 海岸 + 全部 shown 层元素（填充/边界/内缘） |
| 5 | `pathsLayer` | 路/航/河 |
| 6 | `symbolsLayer` / `labelsLayer` / `frameLayer` | 符号 / 文字 / 外框 |

## 废弃代码

**已物理删除**（`_deprecated/`、`stripesLayer`、`fillStripes`）。勿再引入逐 cell 填色或第二套海岸 pipeline。

## 超参（底部 LayerStyleBar）

边界宽 · 内阴影宽（向内渐隐）· 平滑（样条圆度）· 填充开关 · 填充透明  

## 元素选中

工作区点元素 → `highlightRegionId` → 该元素 `regionSelected` → **最后绘制**（边界高亮加粗）
