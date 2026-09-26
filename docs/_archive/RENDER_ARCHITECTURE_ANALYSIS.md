# Mapedi 渲染架构分析报告

> 日期：2026-09-24
> 范围：高度着色、周期贴图、坐标系统、性能
> 参考：geodata.tools《Web Map Performance》、MapLibre GL JS、OpenLayers、Leaflet、D3.js

---

## 1. 当前问题总结

| # | 玻现 | 严重度 |
|---|------|--------|
| P1 | 高度图色块放大后特别糊（矢量元素正常） | 高 |
| P2 | 拖动/缩放/右键平移卡顿 | 高 |
| P3 | 拖动时内容上方缺一块 | 中 |
| P4 | 坐标系统多处翻转/不一致 | 高 |

---

## 2. 系统架构分析

### 2.1 当前渲染管线

```
数据层 (cell.height / Region.cells)
  ↓
几何层 (sharedEdges → boundary rings → Hermite curves)
  ↓
投影层 (Mercator: lon/lat → x/y)
  ↓
显示层 (beginWorld 变换 → Canvas2D 绘制)
  ├─ 周期贴图 (staticLayerCache: 烘焙 → drawImage 平铺)
  ├─ 矢量元素 (elementsLayer: Path2D fill/stroke)
  └─ 覆盖层 (overlay: 笔刷光标/控制点)
```

### 2.2 架构问题

#### 问题 A：坐标系统不统一

**现状**：y 轴翻转散落在 4+ 处：

| 位置 | 翻转方式 | 问题 |
|------|---------|------|
| `beginWorld` | `scale(s, -s)` | 画布变换翻转 |
| `worldToScreenY` | `-(y-cam.y)*s + h/2` | 手动翻转 |
| `screenToContentY` | `-(sy-h/2)/s + cam.y` | 手动翻转 |
| `screenToWorld` | `-(cssY-h/2)/s + cam.y` | 手动翻转 |
| `drawPeriodicStatic` yOff | 手动计算 | 符号容易反 |

**根因**：投影空间 y 向上（数学惯例），Canvas2D y 向下（屏幕惯例）。每处都需要翻转，但没有统一接口。

**业界做法**（MapLibre/OpenLayers）：
- **单一变换矩阵**：所有坐标转换走同一个 `Matrix4`，投影→世界→屏幕一次完成
- **GPU 端翻转**：WebGL 的 NDC y 向上，由 shader 统一处理
- **禁止手动翻转**：任何坐标计算必须通过变换矩阵 API

#### 问题 B：纹理覆盖范围与视口不匹配

**现状**：
```typescript
pixelH = h * dpr;  // 纹理高度 = 视口高度（像素）
// 但纹理覆盖 h / TEX_SCALE 弧度
// 视口显示 h / cam.scale 弧度
// → 当 TEX_SCALE ≠ cam.scale 时，覆盖范围不一致 → 拉伸/糊
```

**根因**：纹理分辨率（TEX_SCALE）和显示分辨率（cam.scale）是两个独立参数，但纹理覆盖范围没有按比例调整。

**业界做法**（瓦片地图）：
- **固定瓦片尺寸**：256×256 或 512×512 像素
- **固定缩放级别**：每个 zoom level 对应固定分辨率
- **按需加载**：只加载视口内的瓦片
- **Mipmap**：GPU 自动选择合适分辨率的纹理

#### 问题 C：高度图色块用 `drawImage` 拉伸 → 糊

**现状**：
```typescript
// 烘焙：低分辨率纹理（128px/rad）
// 显示：drawImage 拉伸到屏幕分辨率
// → 放大后双线性插值 → 糊
```

**根因**：`drawImage` 的双线性插值在放大时产生模糊。矢量元素（Path2D）是分辨率无关的，所以不糊。

**业界做法**：
1. **纹理图集 + Mipmap**（游戏引擎）：预生成多级分辨率，GPU 自动选择
2. **矢量瓦片 + GPU 光栅化**（MapLibre）：几何上传 GPU，shader 光栅化，分辨率无关
3. **实时重烘焙**（OpenLayers）：缩放停止后按新分辨率重烘焙
4. **九宫格拉伸**（UI 框架）：只拉伸边缘，中心保持清晰

---

## 3. 算法架构与选型

### 3.1 高度着色算法

| 方案 | 原理 | 优点 | 缺点 | 适用场景 |
|------|------|------|------|---------|
| **A. 逐格填充** | 每个 cell 用高度色填充 | 精确、简单 | 30k 次 fill → 慢；放大糊 | 小数据量 |
| **B. 纹理烘焙** | 高度色烘焙到纹理，drawImage | 一次烘焙、快 | 放大糊（双线性插值） | 中等数据量 |
| **C. GPU Shader** | 高度图上传 GPU，shader 插值 | 分辨率无关、极快 | 需要 WebGL | 大数据量 |
| **D. 矢量网格** | cell 网格上传 GPU，顶点色插值 | 分辨率无关、精确 | 需要 WebGL + 三角化 | 大数据量 |

**推荐**：短期用 **B（纹理烘焙 + 实时重烘焙）**，长期迁移到 **C（GPU Shader）**。

**关键改进**：
- 纹理分辨率匹配屏幕分辨率（`TEX_SCALE = cam.scale * dpr`）
- 缩放停止后重烘焙（渐进渲染）
- 纹理覆盖范围 = 视口范围（修正比例）

### 3.2 周期贴图算法

| 方案 | 原理 | 优点 | 缺点 |
|------|------|------|------|
| **A. 单贴图平铺** | 烘焙一个周期，drawImage 平铺 | 简单、右键平移快 | 缩放/垂直拖动需重烘焙 |
| **B. 瓦片金字塔** | 多级分辨率瓦片，按需加载 | 缩放快、内存可控 | 复杂度高 |
| **C. GPU 纹理图集** | 所有瓦片打包到一张大纹理 | 一次上传、GPU 采样 | 需要 WebGL |

**推荐**：短期用 **A + 渐进分辨率**，长期迁移到 **B（瓦片金字塔）**。

**关键改进**：
- 拖动中用低分辨率（64px/rad），松手后重烘焙高分辨率
- `isDragging` 不进 cacheKey（拖动中复用低分纹理）
- 纹理覆盖范围 = 视口范围（修正比例）

### 3.3 坐标系统算法

**推荐**：**单一变换矩阵**（业界标准做法）。

```typescript
// 唯一坐标变换入口
class MapTransform {
  // 投影空间 → 屏幕空间
  worldToScreen(x: number, y: number): { sx: number; sy: number } {
    return {
      sx: (x - cam.x) * cam.scale + w/2,
      sy: -(y - cam.y) * cam.scale + h/2,  // 唯一翻转点
    };
  }
  
  // 屏幕空间 → 投影空间
  screenToWorld(sx: number, sy: number): { x: number; y: number } {
    return {
      x: (sx - w/2) / cam.scale + cam.x,
      y: -(sy - h/2) / cam.scale + cam.y,  // 唯一翻转点
    };
  }
  
  // Canvas 变换（beginWorld 用）
  applyToCanvas(ctx: CanvasRenderingContext2D) {
    ctx.translate(w/2, h/2);
    ctx.scale(cam.scale, -cam.scale);  // 唯一翻转点
    ctx.translate(-cam.x, -cam.y);
  }
}
```

---

## 4. 业界方案调研

### 4.1 MapLibre GL JS（推荐参考）

**架构**：
- WebGL 渲染，几何上传 GPU 顶点缓冲
- 矢量瓦片（MVT）按 zoom level 简化
- Shader 光栅化，分辨率无关
- 变换矩阵统一处理坐标

**关键设计**：
1. **单一变换矩阵**：`Transform` 类管理所有坐标转换
2. **瓦片金字塔**：每个 zoom level 独立瓦片
3. **GPU 纹理图集**：所有样式纹理打包到一张图
4. **Mipmap**：GPU 自动选择合适分辨率

**性能数据**：
- 100k+ features 流畅
- 缩放/旋转/倾斜无卡顿
- 内存：GPU 顶点缓冲 + 纹理图集

### 4.2 OpenLayers

**架构**：
- Canvas2D 或 WebGL 可选
- 瓦片渲染 + 矢量叠加
- 分层渲染（底图层 + 矢量层 + 标注层）

**关键设计**：
1. **分层 Canvas**：每层独立 Canvas，合成时叠加
2. **瓦片缓存**：LRU 缓存已渲染瓦片
3. **视口裁剪**：只渲染视口内的元素

**性能数据**：
- Canvas2D：10k-50k features 流畅
- WebGL：100k+ features 流畅

### 4.3 Leaflet

**架构**：
- SVG 或 Canvas2D
- DOM 管理图层
- 事件驱动

**关键设计**：
1. **preferCanvas**：大数据量时切换到 Canvas
2. **Path2D 缓存**：几何路径缓存
3. **视口索引**：R-tree 空间索引

**性能数据**：
- SVG：< 1k features
- Canvas：1k-50k features

### 4.4 游戏引擎（Unity/Unreal）——高度图渲染

**关键设计**：
1. **纹理图集 + Mipmap**：预生成 1x, 2x, 4x, 8x 分辨率
2. **LOD（Level of Detail）**：不同距离用不同精度
3. **GPU 双线性插值**：硬件加速，不糊

**性能数据**：
- 4k 纹理 + Mipmap：任意缩放不糊
- GPU 采样：< 1ms

---

## 5. 根因分析（逐条）

### P1：高度图色块糊

**直接原因**：`drawImage` 双线性插值放大 → 糊。

**根本原因**：
1. 纹理分辨率（128px/rad）≠ 屏幕分辨率（cam.scale*dpr px/rad）
2. 纹理覆盖范围（h/TEX_SCALE 弧度）≠ 视口范围（h/cam.scale 弧度）
3. 没有 Mipmap / LOD

**修正方案**：
```typescript
// 1. 纹理分辨率匹配屏幕分辨率
const TEX_SCALE = Math.min(512, Math.round(cam.scale * dpr));

// 2. 纹理覆盖范围 = 视口范围
const pixelH = Math.round(TEX_SCALE * dpr * h / cam.scale);

// 3. 缩放停止后重烘焙（渐进渲染）
if (!isDragging && texScale !== targetTexScale) {
  invalidateCache();
}
```

### P2：卡顿

**直接原因**：每帧重烘焙贴图 + 边界环重算 + 逐格填充。

**根本原因**：
1. `cam.y`/`cam.scale` 在 cacheKey → 每帧重烘焙
2. `pairEdgeCache` 随任何 rev 清空 → 边界环全量重算
3. 高度纹理用 30k 次 `fill` → 慢

**修正方案**：
```typescript
// 1. cam.y/cam.scale 不进 cacheKey（已修）
// 2. pairEdgeCache 只随 geom rev 失效（已修）
// 3. 高度纹理预烘焙 + drawImage（已修）
// 4. 渐进分辨率：拖动低分、松手高分（已修）
```

### P3：拖动时内容上方缺一块

**直接原因**：纹理覆盖范围比视口小 → 上方露出空白。

**根本原因**：`pixelH = h * dpr` 让纹理覆盖 `h/TEX_SCALE` 弧度，但视口显示 `h/cam.scale` 弧度。当 `TEX_SCALE > cam.scale` 时，纹理覆盖范围 < 视口范围 → 上方缺一块。

**修正方案**：
```typescript
// 纹理覆盖范围 = 视口范围
const pixelH = Math.round(TEX_SCALE * dpr * h / cam.scale);
```

### P4：坐标系统不一致

**直接原因**：y 轴翻转散落在 4+ 处，符号容易反。

**根本原因**：没有统一的坐标变换接口。

**修正方案**：引入 `MapTransform` 类，所有坐标转换走同一入口（见 §3.3）。

---

## 6. 推荐架构

### 6.1 短期（1-2 天）

| 改动 | 效果 |
|------|------|
| 修正纹理覆盖范围（P3） | 内容对齐 |
| 修正 yOff 符号（P3） | 拖动方向正确 |
| 纹理分辨率匹配屏幕（P1） | 高度图清晰 |
| 统一坐标接口（P4） | 根治坐标问题 |

### 6.2 中期（1-2 周）

| 改动 | 效果 |
|------|------|
| 瓦片金字塔 | 缩放流畅、内存可控 |
| LOD 渐进渲染 | 拖动低分、松手高分 |
| 边界环增量更新 | 绘制流畅 |

### 6.3 长期（1-2 月）

| 改动 | 效果 |
|------|------|
| WebGL 渲染 | 100k+ features 流畅 |
| GPU 高度图 Shader | 分辨率无关、极快 |
| 矢量瓦片 | 按需加载、CDN 缓存 |

---

## 7. 实施路线

### 第一步：修正当前 bug（今天）
1. 修正纹理覆盖范围（`pixelH = TEX_SCALE * dpr * h / cam.scale`）
2. 修正 yOff 符号（`+ (cam.y - proxyY) * s`）
3. 纹理分辨率匹配屏幕（`TEX_SCALE = cam.scale * dpr`）
4. 统一坐标接口（`MapTransform` 类）

### 第二步：性能优化（本周）
1. 渐进分辨率（拖动低分、松手高分）
2. 边界环增量更新（只更新 dirty 区域）
3. `composeShownPieces` 记忆化

### 第三步：架构升级（下周）
1. 瓦片金字塔
2. LOD 渲染
3. WebGL 迁移（可选）

---

## 参考资料

1. **geodata.tools《Web Map Performance》**：https://geodata.tools/blog/web-map-performance-optimization
   - 四种渲染路径对比（SVG/Canvas/WebGL/Server）
   - 五种数据传输协议对比（WMS/WMTS/WFS/Vector Tiles/Static）
   - 性能优化十原则

2. **MapLibre GL JS**：https://maplibre.org/
   - WebGL 渲染架构
   - 矢量瓦片 + Shader 光栅化
   - 变换矩阵统一坐标

3. **OpenLayers**：https://openlayers.org/
   - Canvas2D/WebGL 双模式
   - 瓦片缓存 + 视口裁剪

4. **Leaflet**：https://leafletjs.com/
   - preferCanvas 大数据量优化
   - Path2D 缓存

5. **游戏引擎 LOD**：Unity/Unreal 纹理图集 + Mipmap
   - 预生成多级分辨率
   - GPU 自动选择合适级别

---

## 附录：关键代码对比

### 当前实现（有问题）
```typescript
// 纹理覆盖范围错误
const pixelH = Math.round(h * env.dpr);  // ← 应该是 TEX_SCALE * dpr * h / cam.scale

// yOff 符号错误
const yOff = (h - texDisplayH) / 2 - (env.cam.y - state.proxyY) * env.cam.scale;
// ← 应该是 + 不是 -

// 坐标翻转散落
worldToScreenY(y, cam, h) = -(y - cam.y) * cam.scale + h/2  // 手动翻转
screenToContentY(sy, cam, h) = -(sy - h/2) / cam.scale + cam.y  // 手动翻转
beginWorld: ctx.scale(cam.scale, -cam.scale)  // 又一处翻转
```

### 推荐实现（MapLibre 风格）
```typescript
class MapTransform {
  worldToScreen(x: number, y: number): { sx: number; sy: number } {
    return {
      sx: (x - this.cam.x) * this.cam.scale + this.w / 2,
      sy: -(y - this.cam.y) * this.cam.scale + this.h / 2,
    };
  }
  
  applyToCanvas(ctx: CanvasRenderingContext2D) {
    ctx.translate(this.w / 2, this.h / 2);
    ctx.scale(this.cam.scale, -this.cam.scale);
    ctx.translate(-this.cam.x, -this.cam.y);
  }
}

// 纹理烘焙
const TEX_SCALE = Math.min(512, Math.round(cam.scale * dpr));
const pixelH = Math.round(TEX_SCALE * dpr * h / cam.scale);

// yOff（从变换矩阵推导，不手算）
const yOff = transform.worldToScreen(0, cam.y).sy - h / 2;
```
