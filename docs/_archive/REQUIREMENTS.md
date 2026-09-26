# Mapedi 需求文档（最新版）

> 整理日期：基于当前代码库与全部对话历史
> 项目路径：`/Users/zgy/mapedi`

---

## 一、产品定位

**Mapedi** 是一个以球面为唯一真相的星球架空地图编辑器。

核心目标：轻松方便地绘制详细丰富的地图，并以好看且符合世界逻辑的形式展示。

工作理念：**一切以图层为中心**。

---

## 二、投影与视图

### 已确定
- **只保留两种投影**：平面墨卡托 + 球面（无高度）
- 已删除：近景 3D、球面 3D、其它投影、复杂悬浮大面板
- 地图有矩形外框（±180° / ±85°），地块只在矩形内显示
- 跨日界线的格子在矩形两侧各显一半，边界也各显
- 中键拖动 = 平移相机（横向无限；**拖动中不 wrap cam.x**，wrap 会导致地图瞬移）
- 右键拖动 = 拖地图内容相对于矩形的偏移（contentOffsetX，同样不 wrap）
- 滚轮 = 缩放
- 左键在非绘制态无功能；绘制态笔刷圆**画在鼠标屏幕位置**（光标即笔刷）

---

## 三、图层系统

### 图层分类（三类）
1. **依赖地块**（cell）：高度、环境、植物、动物、种族、文化、宗教、国家、行省、军队
2. **不依赖地块**（free）：道路、航线、河流
3. **自定义/预设**（custom）：图片、文字、指南针、比例尺

图层面板按分类分组显示，组间有横线分隔。

### 图层父子关系
- 通过拖拽设置：拖 A 到 B 上 → A 成为 B 的子层
- 拖到「取消子层」区 → 解除关系
- 设置前校验包含关系：子层元素必须被父层元素完全包含，部分重叠则拒绝
- 防循环

### 元素（Region）
- 元素列表 = 第一行添加控件 + 当前层所有元素
- 元素 = 一个 Region；点击展开其子元素列表
- 只有当元素所属层有子层时，才能展开/添加子元素
- 子元素列表复用同一结构（递归）
- 元素行：颜色圆 + 名称 + cell 数；hover 显示 ℹ/🖌/🗑 图标按钮
- 信息面板向左弹出（名称/颜色/描述编辑）

### 国家–行省派生
- 国家存储的子元素是行省（parentId），不是直接存地块
- 行省更新 → 国家渲染自动更新（fillMap/borders 从子层联合派生）

---

## 四、绘制系统

### 笔刷
- B = 笔刷，W = 权重（中文标注）
- Shift = 移除，Ctrl = 分摊权重
- 高度笔刷：左键抬升，Shift 降海，不限陆/海；须进入绘制会话
- 语义层笔刷：只刷陆地（height > 0）
- 笔刷宽度可调（滑块），Alt+滚轮快速调整

### 工具
- 填充（洪水填充）
- 中心（设行省/首都中心）
- 吞并
- 道路端点拖拽

### 已删除
- 套索（已完全移除）

---

## 五、道路/航线/河流

- 改为**不依赖地块的贝塞尔曲线**（BezierPath）
- 有起点、终点、控制点（0–n 个）
- **道路**：细实线（带 casing 暗底）
- **航线**：虚线
- **河流**：从起点到终点逐渐变粗（宽度变化不大）
- 跨日界线自动展开坐标

---

## 六、渲染

### 解耦原则（大陆/元素「穿过地图」）
渲染与「是否显示在矩形框内」分离：

| 层 | 职责 | 不负责 |
|----|------|--------|
| **几何数据** | cell 多边形 / sharedEdges / Region / BezierPath，球面 lon/lat 真相 | 不判断是否跨日界线、不裁剪 |
| **显示几何** | `render/space.ts` + `projCache`：投影后 unwrap 成连续平面坐标 | 不决定可见性 |
| **世界副本** | `worldCopyDxs(contentOffset, cam, w)` → `drawDx = contentOffsetX + k·2π` | 不改数据 |
| **外框裁剪** | 固定 ±180°/±85° 矩形，`clipToMapFrame` | 外框不随 contentOffset 移动 |

参考做法（业界）：
- MapLibre：跨 180° 线要素对后续点 ±360 unwrap；`renderWorldCopies` 横向平铺世界
- D3-geo：projection.stream 默认 antimeridian preclip + clipExtent postclip，几何与裁剪分层
- OpenLayers：数据 CRS 不动，渲染期由 view/extent 决定 wrap 与显示

实现约定：
- `RenderLayer.repeat=true`：锚定内容的层（cells/coast/borders/paths/stripes/symbols），由 `drawWorld` 按副本循环
- `repeat=false`：bg / labels / frame，各画一次；labels 在 `worldDxs` 中挑最优放置
- **禁止**在图层内部自行 ±2π 三连画或覆盖 `contentOffsetX`
- 拾取/笔刷/路径手柄与渲染共用同一 `drawDx=contentOffsetX` 公式

### Cell 渲染
- Voronoi 胞腔是直边多边形，直接 lineTo，不做曲线平滑
- 视口裁剪 + 地图矩形裁剪（`clipToMapFrame`）
- 跨日界线格由世界副本在矩形两侧各显一半
- 默认不画 cell 边界线；仅 hover/高亮时描边（已去掉 hover 高亮）
- 色块填充：Catmull-Rom 平滑（仅色块，不用于边界）

### 边界渲染
- **按 owner 分组**：每个 owner 单独绘制自己的边界
- 边界 = 与不同 owner 邻接的边（含海洋/无主格的外缘）
- 每个 owner 的边界链成闭环后**向质心内收一点**，形成平行不重叠的两根曲线
- 链化算法：段内 unwrap（space.unwrapXAgainst）→ 建链 → 闭环检测 → 二次贝塞尔平滑
- 跨日界线两侧由编排层副本绘制，**边界层内不再三连画**
- 三方交界处不串线（按 owner 分组隔离）

### 海岸线
- 陆–海共享边，链成折线后二次贝塞尔平滑
- unwrap/链化统一走 `space.chainSegments`

### 路径（道路/航线/河流）
- 控制点投影后链内 unwrap，保证曲线连续
- 参与世界副本；裁剪到外框

### 逐层渲染配置（LayerRenderConfig）
- `showBorder`：边界可见
- `borderSmooth`：边界平滑 0–1
- `borderInset`：边界内收（投影单位）
- `borderWidth`：边界宽度（px）
- `borderColor`：边界颜色（含透明度）
- `fillAlpha`：色块透明度 0–1
- UI 放在图层面板元素 hover 信息按钮展开的 panel 里

---

## 七、UI 壳层

### 顶栏
- 收起态：居中 48×16 圆角小横条（iOS Dynamic Island 风格）
- hover 自动展开项目条（地图名 + 自动保存状态）
- 点击 bar 直接向下展开更多内容（生成/视图/项目），再点击收起
- 鼠标移出收起（除非已 pin）
- 无设置按钮、无关闭按钮
- 内容居中

### 图层面板
- 左上角固定，满高（top:0 / bottom:0）
- 按三类分组，组间横线
- 子层缩进显示（depth * 12px）
- 可拖拽设/取消子层关系
- 不可收成按钮

### 工作区面板
- 右侧固定，满高，可拖宽窄（220–560px，默认 320）
- 无标题
- 元素列表：颜色圆 + 名称 + cell 数；hover 显示图标按钮
- 点击名称 = 选中 + 展开
- 信息面板向左弹出

### 状态栏
- 底部居中圆角悬浮 pill

### 绘制 HUD
- 底部居中半透明圆角悬浮
- 「笔刷 B / 权重 W」中文按钮
- 笔刷宽度滑块
- 高度模式显示提示文字

### 光标
- 非绘制态：default
- 绘制态：none（画笔圆跟手）

---

## 八、性能

### 当前状态
- 生成在 Worker 中执行，不卡 UI
- 默认密度 2500；25k 可生成但慢（~68s）
- 渲染有视口裁剪 + 路径缓存 + fill 缓存

### 25k 卡死原因分析
1. **sphericalVoronoi**：O(n·k²) 三角形枚举 + 空圆检验，25k×18² ≈ 4M 候选三角形
2. **deserializeWorld**：21MB JSON 在主线程反序列化
3. **getProjCache**：全量投影所有 cell 多边形顶点
4. **bordersLayer 兜底**：遍历所有 cell 多边形提取边

### 优化方向
- 投影缓存增量更新（只重算变化的 cell）
- sharedEdges 缺失边用预计算索引而非每次遍历
- 考虑 OffscreenCanvas + Worker 渲染
- WASM 加速 Voronoi（用户暂不要求）

---

## 九、数据模型关键类型

```typescript
// 球面真相
LonLat = { lon, lat }
Cell = { id, polygon, center, neighbors, isOcean, height, area }
Region = { id, layerId, name, cells, centerCellId?, parentId?, color, attributes }
BezierPath = { id, layerId, name, start, end, controls, widthStart?, widthEnd?, color }
LayerRenderConfig = { showBorder?, borderSmooth?, borderInset?, borderWidth?, borderColor?, fillAlpha? }
World = { meta, cells, rivers, layers, regions, paths?, continents, climate, biome?, sharedEdges?, layerRenderConfig? }
```

---

## 十、可能的新需求方向

1. **自定义元素**：图片/文字/指南针/比例尺的放置与编辑
2. **导出增强**：SVG 分层导出、高分辨率 PNG、GeoJSON 完整属性
3. **撤销/重做**：已实现基础 History，可扩展为操作树
4. **协作**：多人同时编辑（需要 CRDT 或 OT）
5. **时间轴**：历史地图演变
6. **更多投影**：等面积、圆锥等（用户暂只要墨卡托+球面）
7. **WASM 加速**：Voronoi、气候、路径生成
8. **移动端适配**：触摸手势
9. **插件系统**：自定义图层生成器、渲染器
10. **模板系统**：预设世界风格（中世纪、科幻、写实）

---

## 十一、约束与禁止

- 不用 Rust/WASM（暂）
- 禁止 `class:left` 无表达式（Svelte 会找变量导致白屏）
- 禁止在 `$effect` 里写会再触发同一 effect 的 state
- 海岸/边界禁止「cell 中心连线」，必须贴几何边
- 不重新引入：近景 3D、多投影、路/河默认显示、中心线海岸、无会话高度笔刷
