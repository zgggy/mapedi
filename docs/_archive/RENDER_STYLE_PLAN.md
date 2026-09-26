# Mapedi 渲染与样式系统方案

> 日期：2026-09-24
> 范围：通用图层样式、局部重绘、随机种子、高度图层修正、架构约束
> 参考：Cocos Creator 脏区域算法、geodata.tools、damage-rects、Flutter Canvas 优化

---

## 0. 架构约束（必须遵守）

### 0.1 回归教训

**曾经的错误**：把 `elementsLayer` 从烘焙层移到动态层 → 每帧全量画所有矢量元素 → **破坏了周期贴图优化**。

| 优化 | 之前 | 被破坏后 |
|------|------|---------|
| 右键平移 | 周期贴图 `drawImage`（120fps）| 每帧全量画（卡）|
| 中键拖动 | 周期贴图 `drawImage`（快）| 每帧全量画（卡）|
| 缩放 | 周期贴图 `drawImage`（快）| 每帧全量画（卡）|

**教训**：改动必须考虑已有优化是否被破坏。整体重构可以影响，但局部优化不能被无脑覆盖。

### 0.2 正确架构：周期贴图 + 局部重绘（互补，非替代）

```
周期贴图（烘焙）：bg + cellsMesh + elements → drawImage 显示
  ↑ 样式变/绘制变 → 局部重绘（只更新贴图的受影响区域）
  ↑ 缩放/拖动/平移 → 直接 drawImage（不重烘焙）
```

| 场景 | 用什么 | 效果 |
|------|--------|------|
| **缩放/拖动/平移** | 周期贴图 `drawImage` | 快（已有优化，**不能破坏**）|
| **样式调整** | 局部重绘（只更新贴图局部区域）| 快（新增优化）|
| **绘制** | 局部重绘（只更新贴图局部区域）| 快（新增优化）|

**关键**：局部重绘是**更新贴图的局部区域**，不是绕过贴图直接画矢量。

### 0.3 禁止事项

- ❌ 禁止把烘焙层移到动态层（破坏周期贴图优化）
- ❌ 禁止全量重烘焙替代局部重绘
- ❌ 禁止样式变触发全量重烘焙
- ✅ 局部重绘 = 更新贴图的脏区域
- ✅ 周期贴图 = 缩放/拖动/平移的显示基础

---

## 1. 需求汇总

| # | 需求 | 来源 |
|---|------|------|
| R1 | 随机种子旁加「随机」按钮 | UI |
| R2 | 高度图层无内阴影 | 样式 |
| R3 | 通用图层样式系统（每层独立参数）| 架构 |
| R4 | 高度层：cell 填充（按高度图映射），不显示 cell 边界；区域边界显示（可调粗细/颜色），不显示区域填充 | 样式 |
| R5 | 地块层：只显示区域边界和地块边界 | 样式 |
| R6 | 样式调整可局部重绘（边界/阴影关联 cell，可分片获取重绘区域）| 性能 |

---

## 2. 通用图层样式系统

### 2.1 样式参数 Schema

```typescript
interface LayerStyle {
  // ── Cell 渲染 ──
  cellFill: boolean;              // 是否填充 cell
  cellFillMode: 'solid' | 'heightmap';  // 填充模式：纯色 / 高度图映射
  cellFillColor: string;          // 纯色填充色（cellFillMode='solid' 时用）
  cellBorder: boolean;            // 是否显示 cell 边界
  cellBorderColor: string;        // cell 边界颜色
  cellBorderWidth: number;        // cell 边界粗细

  // ── Region 渲染 ──
  regionFill: boolean;            // 是否填充区域
  regionFillColor: string;        // 区域填充色
  regionBorder: boolean;          // 是否显示区域边界
  regionBorderColor: string;      // 区域边界颜色
  regionBorderWidth: number;      // 区域边界粗细
  regionSmooth: number;           // 边界平滑度（Hermite 张力 0–1）

  // ── 内阴影 ──
  shadow: boolean;                // 是否显示内阴影
  shadowWidth: number;            // 阴影宽度
  shadowColor: string;            // 阴影颜色
  shadowAlpha: number;            // 阴影浓度
}
```

### 2.2 各图层默认样式

| 参数 | 高度层 | 地块层 | 国家/行省/文化等 |
|------|--------|--------|----------------|
| `cellFill` | ✅ | ❌ | ❌ |
| `cellFillMode` | `heightmap` | — | — |
| `cellBorder` | ❌ | ✅ | ❌ |
| `regionFill` | ❌ | ❌ | ✅ |
| `regionBorder` | ✅ | ✅ | ✅ |
| `shadow` | **❌** | ❌ | ✅ |

**高度层**：cell 按高度图填充（矢量 Path2D），不显示 cell 边界；区域边界显示（可调粗细/颜色），不显示区域填充；无内阴影。

**地块层**：只显示区域边界和地块边界。

**语义层**（国家/行省/文化等）：区域填充 + 区域边界 + 内阴影。

### 2.3 样式参数与渲染元素的映射

| 样式参数 | 影响元素 | 局部重绘范围 |
|---------|---------|------------|
| `cellFill` / `cellFillMode` / `cellFillColor` | cell 填充 | 该 cell 的填充区域 |
| `cellBorder` / `cellBorderColor` / `cellBorderWidth` | cell 边界描边 | 该 cell 的边界 |
| `regionFill` / `regionFillColor` | 区域填充 | 该区域的填充区域 |
| `regionBorder` / `regionBorderColor` / `regionBorderWidth` | 区域边界描边 | 该区域的边界 |
| `regionSmooth` | Hermite 曲线张力 | 该区域的边界曲线 |
| `shadow` / `shadowWidth` / `shadowColor` / `shadowAlpha` | 内阴影 | 该区域的阴影区域 |

---

## 3. 局部重绘方案

### 3.1 核心洞察（用户提出）

> "样式调整也可以局部重绘，因为边界、阴影其实都有相关联的 cell，其实是可以分片获取要重绘的区域的。并非全量的。"

**关键**：边界和阴影**关联到具体 cell**。样式变化时，可以识别受影响的 cell，只重绘那些区域。

### 3.2 局部重绘 = 更新贴图的脏区域

**不是绕过贴图直接画矢量**，而是：

```
样式变 / 绘制变
  → 计算脏区域（受影响的 cell）
  → 只重烘焙贴图的脏区域（不是全量）
  → 显示时仍用 drawImage（快）
```

**与周期贴图的关系**：
- 周期贴图是显示基础（缩放/拖动/平移用）
- 局部重绘是更新机制（样式/动作用）
- 两者互补，不替代

### 3.3 脏区域追踪

```typescript
interface DirtyRegion {
  cellIds: Set<number>;      // 受影响的 cell
  elementIds: Set<string>;   // 受影响的元素（边界/阴影/填充）
  bbox: Rect;                // 受影响区域的包围盒
}
```

**样式变化 → 脏区域计算**：

| 样式变化 | 脏区域 | 局部重绘效果 |
|---------|--------|------------|
| `cellBorderWidth` | 所有有 cell 边界的 cell | 只重绘边界描边 |
| `regionBorderWidth` | 所有有区域边界的 cell | 只重绘边界描边 |
| `shadowWidth` | 所有有阴影的 cell | 只重绘阴影 |
| `regionSmooth` | 所有有区域边界的 cell | 只重绘边界曲线 |
| `cellFillColor` | 所有有 cell 填充的 cell | 只重绘填充 |
| 笔刷绘制 | 笔刷覆盖的 cell | 只重绘笔刷区域 |

**关键优化**：
1. **元素级脏区域**：不只按区域分片，而是按**元素类型**分片（边界/阴影/填充分开）
2. **viewport 裁剪**：只重绘可见区域内的脏元素
3. **Path2D 缓存**：边界曲线的 Path2D 缓存，样式变只改 stroke 参数，不重算曲线

### 3.3 与分层的关系

**用户问题**："如果说调节样式、绘制等各种东西都可以用局部重烘焙来实现，是不是也没必要分层了？"

**答案**：局部重绘 + 元素级分片 可以替代分层。

| 方案 | 绘制 | 样式调整 | 复杂度 |
|------|------|---------|--------|
| 纯分层 | 全量重画样式层 | 只重画样式层 | 中 |
| 纯局部重绘 | 只重绘笔刷区域 | 只重绘受影响元素 | 中 |
| **局部重绘 + 元素分片** | 只重绘笔刷区域 | 只重绘边界/阴影/填充 | **低** |

**结论**：不需要分层。用**元素级脏区域追踪**：
- 每个元素（边界/阴影/填充）关联到 cell
- 样式变化 → 识别受影响元素 → 只重绘那些元素
- viewport 裁剪 → 只重绘可见元素

---

## 4. 高度图层修正

### 4.1 无内阴影
高度层 `shadow = false`。

### 4.2 Cell 填充（高度图映射）
- `cellFill = true`
- `cellFillMode = 'heightmap'`
- 填充色 = `heightGradientColor(cell.height)`
- 不显示 cell 边界（`cellBorder = false`）

### 4.3 区域边界
- `regionBorder = true`（可调粗细/颜色）
- `regionFill = false`（不显示区域填充）

---

## 5. 随机种子按钮

### UI
```
[随机种子] [输入框] [🎲 随机]
```

### 逻辑
```typescript
function randomSeed(): number {
  return Math.floor(Math.random() * 0xFFFFFFFF);
}
```

---

## 6. 渲染架构（周期贴图 + 局部重绘）

```
┌─────────────────────────────────────────────────┐
│                  渲染管线                         │
├─────────────────────────────────────────────────┤
│  1. 周期贴图（烘焙）                              │
│     - bg + cellsMesh + elements                  │
│     - 显示：drawImage（缩放/拖动/平移）           │
│     - 更新：局部重绘（样式/动作用）               │
│                                                 │
│  2. 几何缓存（Path2D）                           │
│     - cell 多边形、区域边界 Hermite 曲线          │
│     - 失效：dataRev 变化（几何变化）              │
│                                                 │
│  3. 样式参数（每层独立）                          │
│     - LayerStyle schema（见 §2）                 │
│     - 变化：触发局部重绘（见 §3）                 │
│                                                 │
│  4. 脏区域追踪                                    │
│     - 元素级：边界/阴影/填充分开追踪              │
│     - cell 级：每个元素关联到 cell                │
│     - viewport 裁剪：只重绘可见脏元素             │
│                                                 │
│  5. 局部重绘（更新贴图脏区域）                    │
│     - cell 填充：Path2D fill（高度图映射）        │
│     - cell 边界：Path2D stroke                   │
│     - 区域填充：Path2D fill（evenodd）           │
│     - 区域边界：Path2D stroke（Hermite 曲线）     │
│     - 内阴影：Path2D stroke（8 遍渐隐）          │
│     - 只重绘脏区域，不是全量                      │
└─────────────────────────────────────────────────┘
```

### 样式调整流程（局部重绘，不破坏周期贴图）
```
用户拖动 borderWidth 滑块
  → 更新 LayerStyle.regionBorderWidth
  → 计算脏区域：所有有区域边界的 cell
  → viewport 裁剪：只取可见的
  → 只重烘焙贴图的脏区域（边界描边）
  → 显示仍用 drawImage（快）
  → 完成（不重绘填充/阴影/cell 边界）
```

### 绘制流程（局部重绘，不破坏周期贴图）
```
用户笔刷绘制
  → 更新 cell.height
  → 计算脏区域：笔刷覆盖的 cell
  → 只重烘焙贴图的脏区域（填充）
  → 显示仍用 drawImage（快）
  → 完成（不重绘边界/阴影）
```

### 缩放/拖动/平移流程（用现有贴图，不重烘焙）
```
用户缩放/拖动/平移
  → 周期贴图不动
  → drawImage 移动/缩放（快）
  → 完成
```

---

## 7. 实施计划

### 第一步：通用样式系统
1. 定义 `LayerStyle` schema
2. 每层默认样式（见 §2.2）
3. `LayerStyleBar` 改为按层显示对应参数

### 第二步：高度图层修正
1. 去掉内阴影
2. cell 填充（高度图映射）
3. 不显示 cell 边界
4. 区域边界可调粗细/颜色

### 第三步：局部重绘
1. 元素级脏区域追踪
2. 样式变化 → 只重绘受影响元素
3. 绘制 → 只重绘笔刷区域
4. viewport 裁剪

### 第四步：随机种子按钮
1. UI 加随机按钮
2. 点击生成随机种子

---

## 8. 性能预期

| 操作 | 当前 | 方案后 |
|------|------|--------|
| 缩放/拖动/平移 | 周期贴图（快）| **同（快，不破坏）** |
| 样式调整 | 全量重烘焙（卡）| 局部重绘脏区域（快）|
| 绘制 | 全量重烘焙（卡）| 局部重绘脏区域（快）|
| 清晰度 | 矢量（清晰）| 同（清晰）|

**关键约束**：缩放/拖动/平移的周期贴图优化**不能被破坏**。

---

## 参考资料

1. **Cocos Creator 脏区域算法**：https://github.com/JIE1991/creator-docs/blob/master/en/advanced-topics/dirty-region.md
   - 只重绘变化区域，drawCall 366→28（93% 削减）
   - 阈值机制：移动物体过多时自动关闭

2. **geodata.tools《Web Map Performance》**：https://geodata.tools/blog/web-map-performance-optimization
   - Debounce 交互、匹配投影、简化几何

3. **damage-rects（Rust）**：https://lib.rs/crates/damage-rects
   - 累积脏矩形，合并后局部更新

4. **Flutter Canvas 优化**：https://openvela.csdn.net/6a260fa6662f9a54cb7b1c00.html
   - 脏区域重绘替代全量重绘
