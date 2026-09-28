# Mapedi 显示逻辑一览（供审阅）

> **现行契约**（过时稿见 `docs/_archive/`，勿参考）  
> 统一接口：选中 ≡ 显示；唯一边界类 = 元素边界；填充 = 边界内填充

## 核心约定

1. **`isLayerShown`**：`visible || 选中(focusLayerId)` —— 点选中与点显隐，地图上**同一套**填充+边界  
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
5. 极区：全域蓝噪声撒点，不强制极点站点、不剔除极区。南北极各归属最近站点的普通 Voronoi cell（极点方向点积最大）；旧存档也从站点派生归属，不另存极点身份。`PROJ_LAT_MAX=89.5`（数值上限）+ `FRAME_LAT=85`（裁剪框）；球面共享边不因经度差大而丢弃，边中点先在球面求出再投影。圆柱投影按实际横向周期展开经度：绕行环的最后一段终止于首点的**相邻世界副本**，仍是真实 Hermite 段；随后沿极点归属对应的顶/底框补仅供填充的虚边。区域的极点归属从同一 `cellIds` 求出，不能另铺整幅底面。南北极均在区域内时，各绕行环按自身纬度侧闭合；均不在时两条边同侧闭合，evenodd 得到中间带。开链不补假边。
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
- **GL 不可用** = 清屏 + 视口内提示横幅，**不回退 2D 代画**（Canvas2D 已归档）。
- 非纯色样式（CanvasGradient）不支持即拒（GL 只吃纯色）。

## 模块边界（`core/ring/*`）

| 模块 | 职责 |
|------|------|
| `displayRing.ts` | MidRing/DisplayRing、`toDisplayRing` 不变量、洞分类 |
| `build.ts` | **`cellIds` → 边界环**（无 owner）；保留所有有效共享边，边中点在球面求值 |
| `normalize.ts` | unwrap + 周期真实终点 + 仅供填充的对应极侧框边 → DisplayRing[]；开链不补假边 |
| `hermite.ts` | **中点 Hermite 唯一实现**（ctx / Path2D / SVG 共用）；fill 走闭环，outline 只走真实段 |
| `trace.ts` | 其他调用点的路径辅助 |
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
| 6 | `decorationsLayer` / `frameLayer` | 名称/标记 / 外框（GL 模式下 1–4 在 GL 画布、5–6 在 2D 画布，z 序不变） |

## 废弃代码

**已物理删除**（`_deprecated/`、`stripesLayer`、`fillStripes`）。勿再引入逐 cell 填色或第二套海岸 pipeline。

## 超参（底部 LayerStyleBar）

边界宽 · 内阴影宽（向内渐隐）· 平滑（样条圆度）· 填充开关 · 填充透明  

**【阴影暂时停用】**：按产品决定，架构稳定前**显示不渲染内阴影**（两后端同源停用：`buildPieceParams` 的
`shadowW/shadowAlpha` 归零，样式参数保留）。恢复条件：二期架构落地后按同一 Φ 剖面恢复——去掉归零即可
（Canvas 的 clip+blur 与 GL 的场图集实现都在，只是不被触发）。

## 元素选中

工作区点元素 → `highlightRegionId` → 该元素 `regionSelected` → **最后绘制**（边界高亮加粗）
