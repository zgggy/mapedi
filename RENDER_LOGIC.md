# Mapedi 显示逻辑一览（供审阅）

> **现行契约**（过时稿见 `docs/_archive/`，勿参考）  
> 统一接口：显隐 = 存储 `layer.visible`（只有眼睛钮写，**对该图层全部内容总控**——隐藏优先于焦点，2026-10-06 用户原话「显隐这个图层是对这个图层的所有内容进行控制的」，推翻 2026-10-02「选中即显示」焦点强制）；唯一边界类 = 元素边界；填充 = 边界内填充

## 核心约定

1. **`isLayerShown`**：唯一真相 = `layer.visible`（眼睛钮写）∧ 祖先链有效显隐；**隐藏优先于焦点**（2026-10-06 用户原话：显隐按钮对该图层所有内容总控，焦点层被隐藏同样全隐）——**行点击只聚焦+开工作区，不改显隐**  
2. **`composeShownPieces`**：所有 shown 层的元素碎片（含父内切分 `c(A)`），**无图层特殊性**  
3. **`elementsLayer`**：唯一绘制入口  
   - 海岸线（陆–海）**默认一直画**（显式常显，不进第二套 pipeline）  
   - 每个 **DisplayPiece**：边界环跟 **`piece.cellIds`**（与填色同一集合身份）  
   - **`prepareDisplayRings` 一次** → 所有可见世界副本合成单个 evenodd 填充遮罩和真实边界路径；填充 / 描边共用  
   - **z 序（后画=高，无图层名特例）**：  
     1. 焦点图层 > 列表上层第一层级 > 列表下层第一层级  
     2. 同树内：子 > 父 > 父父…  
     3. 工作区选中元素最顶  
4. 无逐 cell 语义填充；无独立海岸/国界类；**已删** `_deprecated/` 与 `stripesLayer`  
5. 极区：全域蓝噪声撒点，不强制极点站点、不剔除极区。南北极各归属最近站点的普通 Voronoi cell（极点方向点积最大）；旧存档也从站点派生归属，不另存极点身份。`PROJ_LAT_MAX=89.5`（数值上限）+ `FRAME_LAT=85`（裁剪框）；球面共享边不因经度差大而丢弃，边中点先在球面求出再投影。圆柱投影按实际横向周期展开经度：绕行环的最后一段终止于首点的**相邻世界副本**，仍是真实 Hermite 段；随后沿**环自身贴的那一侧**顶/底框补仅供填充的虚边（sumY 定侧，与集合含不含极点无关——含极集合与不含极集合里的同一条绕行环必须同侧闭合，否则补边穿越全图 = 「圈」）。evenodd 不变量：**成员 ≡ XOR(闭合环) ⊕ flip**；flip 由奇偶探针在**闭合后**的环上按成员/非成员采样判定（裸环不含补边奇偶，带/极冠两案会给出相反结论）；外轮廓缺失时 flip=1，再补**真矩形**框外环一次翻转即「盖成员、排非成员」（框环是渲染临时几何：pts=四角 + virtualFrom=0 全段折线，不走 Hermite、不描边）。开链不补假边。
   所有副本的环一次性 evenodd 填充，不能各副本单独涂半透明色。唯一无环的全世界 cell 集按完整外框填充，不把它当作极点底面。副本身份是整数 `k`；先按 `k` 去重，再计算 `contentOffsetX + k·period`，不得对浮点偏移用 `Set<number>` 去重。极点 cell 的投影拾取多边形按其真实边展开、在自己的周期内沿顶/底框闭合；地块网格只描 `Cell.polygon` 的真实边，不描虚边。相邻副本的极点不跨周期连线。
   若共享边不完整，保留开链以暴露拓扑问题；不得以弦或投影框立柱把它伪装成封闭大陆。
6. **区域边界 ≠ cell polygon**：边界过**边中点** Hermite；cell 贴角多边形只用于网格/几何，两者不可混用

## 渲染（GL 唯一后端）

**显示契约与后端无关**：`buildPieceParams` 是样式链唯一解析（宽度/颜色/选中放大），`core/ring/hermite` 是曲线唯一采样（闭合条件 `closed && (mode==='fill' || virtualFrom===undefined)`）。渲染只走 GL；**阴影功能与 Canvas2D 渲染后端已整体归档**（`docs/_archive/canvas2d-shadow/`，用户决定：阴影永不做、不再使用 Canvas2D），禁止恢复或再引第二条渲染管线。

三画布叠放（z 序即 DOM 序）：

| 画布 | 内容 |
|------|------|
| `canvas.gl`（底） | bg 清海色 + cellsMesh + elements（填充/描边）逐帧直绘 |
| `canvas`（中） | paths / decorations / frame + 选中 cell 描边（透明底）+ 全部输入 |
| `canvas.ovl`（顶） | 笔刷光标、路径控制点 |

- **相机即 uniform**：几何按环对象缓存（WeakMap → VBO），缩放/平移只改 uniform；零重烘、零 drawImage、零读回。世界副本 = 顶点着色器 `aDx` 实例属性。
- **evenodd = stencil 奇偶**（外部参考点三角扇 + INVERT）：含世界副本重叠不叠色；每片 scissor 局部清 stencil（不做全幅清屏）。
- **地图外框 = gl.scissor**（与 `clipToMapFrame` 同矩形）；框外遮罩仍在 frame 层。
- **GL 不可用** = 清屏 + 视口内提示横幅，**不回退 2D 代画**（Canvas2D 已归档）。**已知缺陷**（2026-09-29 评审 P0-2）：当前失败路径无 `contextrestored` 恢复、失败连 2D 余量层也不画 → 永久黑屏；修复是还债步骤 2（`ROADMAP_REFACTOR.md`）。
- 非纯色样式（CanvasGradient）不支持即拒（GL 只吃纯色）。

## 模块边界（`core/ring/*`）

| 模块 | 职责 |
|------|------|
| `displayRing.ts` | MidRing/DisplayRing、`toDisplayRing` 不变量、洞分类 |
| `build.ts` | **`cellIds` → 边界环**（无 owner）；保留所有有效共享边，边中点在球面求值 |
| `normalize.ts` | unwrap + 周期真实终点 + 仅供填充的**环自身极侧**框边（sumY 定侧）→ DisplayRing[]；开链不补假边 |
| `hermite.ts` | **中点 Hermite 唯一实现**（ctx / Path2D / SVG 共用）；fill 走闭环，outline 只走真实段 |
| `trace.ts` | 其他调用点的路径辅助 |
| `path2d.ts` | Path2D 缓存壳（WeakMap 按 ring+smooth+mode）；曲线求值只在 `hermite.appendMidRing` |

`ownerPolygon.ts` 兼容门面已删；`defaultExclusiveColor` 在 `core/layer/style.ts`。

**DisplayRing 不变量**：`verts.length === pts.length`；`virtualFrom` 之前都是过边中点的真实段，之后仅是供填充的直线。真实环不因投影切口增加第二套归属。

## 身份（唯一真相）

| 身份 | 来源 | 派生 |
|------|------|------|
| **Cell.polygon** | Voronoi 焊接后 | `sharedEdges`、网格、球面、拾取 |
| **Region.cells** | 归属真值（区间型 = 精确档） | 标签、拾取、工作区计数 |
| **DisplayPiece.cellIds** | 显示归属：一般 ⊆ region.cells；**区间型（高度档）= 累积 h ≥ lo（直接 ∪ 更高，2026-09-30 用户定）** | 与 dp.cellIds **同一** cellSet 求环（单源 `displayCellsOfInterval`，件环 Δ 同谓词） |

无 owner；海岸 = 高度 continent/lake 的 cellSet 环（与大陆框同 Entry）。

## 管线

| # | 层 | 职责 |
|---|-----|------|
| 1 | `bgLayer` | 海色底 |
| 2 | `cellsLayer` | **空壳死层**（仅 clip/restore 无绘制，2026-09-29 评审确认；还债步骤 7 待删） |
| 3 | `cellsMeshLayer` | 「地块」网格（仅该层选中/显示） |
| 4 | **`elementsLayer`** | 海岸 + 全部 shown 层元素（填充/边界/内缘） |
| 5 | `pathsLayer` | 路/航/河（+ 自由层路径编辑用 `pathPipeline = [cellsLayer, pathsLayer, frameLayer]`） |
| 6 | `decorationsLayer` / `frameLayer` | 名称/标记/符号（**单循环**，四配置 labelMode/coreSymbol/cellSymbol/cellMarker）/ 外框（GL 模式下 1–4 在 GL 画布、5–6 在 2D 画布，z 序不变） |

## 废弃代码

**已物理删除**（`_deprecated/`、`stripesLayer`、`fillStripes`）。勿再引入逐 cell 填色或第二套海岸 pipeline。

## 超参（底部 LayerStyleBar）

边界宽 · 内阴影宽（向内渐隐）· 平滑（样条圆度）· 填充开关 · 填充透明  

**【阴影已整体归档·永不做】**：2026-09-28 用户拍板"不要阴影，所有阴影相关功能全部归档"——`ShadowStyle`、
样式面板阴影组、Canvas clip+blur、GL Φ 剖面场图集已**物理删除**（仅归档目录留档，2026-09-29 grep 确认
src 零残留）。旧的"恢复条件"作废；任何地方不要写"阴影恢复时…"（见 `ROADMAP_REFACTOR.md` §四 已否决项）。

## 元素选中

工作区点元素 → `highlightRegionId` → 该元素 `regionSelected` → **最后绘制**（边界高亮加粗）
