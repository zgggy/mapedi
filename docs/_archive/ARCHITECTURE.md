# Mapedi 显示系统架构与算法调用图

> 2026-09-23 · 与 `RENDER_LOGIC.md` 配套

## 1. 分层总览

```mermaid
flowchart TB
  subgraph Data["数据层（真相）"]
    Cell["Cell：多边形 / 中心 / 邻接 / 高度"]
    SH["sharedEdges：邻接共享边"]
    Reg["Region：cells[] + coreCellId + nameStyle"]
    Layer["Layer：parentLayerId / visible / opacity"]
  end

  subgraph Index["索引层 O(k)"]
    CI["CellIndex：owners / coreHolders"]
    OI["ownerMap + ownerBoundaryEdgeIndex"]
  end

  subgraph Compose["合成层（无图层特殊性）"]
    Shown["isLayerShown = visible ∨ 选中"]
    Pieces["composeShownPieces → DisplayPiece[]"]
  end

  subgraph Draw["绘制层（唯一算法链）"]
    Prep["prepareDisplayRings\nunwrap + 极区/日界线正规闭合"]
    Trace["traceMidRing\n边中点 Hermite 样条"]
    Fill["fill evenodd（挖洞）"]
    Shadow["strokeInnerShadow / strokeHoleShadow"]
    Stroke["stroke 元素边界"]
  end

  Cell --> OI
  SH --> OI
  Reg --> CI
  Reg --> Pieces
  Layer --> Shown
  Shown --> Pieces
  OI --> Prep
  Pieces --> Prep
  Prep --> Trace
  Trace --> Fill
  Trace --> Shadow
  Trace --> Stroke
```

## 2. 单元素绘制调用链（同一算法，只换参数）

```mermaid
flowchart LR
  Rings["ownerBoundaryRings\n→ MidRing pts=边中点 verts=转角"] --> Prep["prepareDisplayRings"]
  Prep --> Piece["closed MidRing[]"]
  Piece --> T["traceMidRing smooth"]
  T --> F["fill"]
  T --> S["stroke 宽度/色"]
  T --> H["内阴影 多遍 clip"]
  T --> HO["洞缘阴影 朝外"]
```

**不变式**：fill / stroke / 内阴影必须共用 `prepareDisplayRings` + `traceMidRing`，禁止各自 unwrap / 各自闭合。

## 3. 极区 / 日界线

```mermaid
flowchart TB
  R[MidRing] --> J{大跳?}
  J -->|否| OK[原环]
  J -->|是·绕极| P[沿外框纬线闭合 closeChainWithCorners]
  J -->|是·日界线| D[拆开链 + 沿 x=±π 立柱闭合]
  P --> Out[closed MidRing verts 对齐]
  D --> Out
  OK --> Out
```

极点判定：环平均 |y| ≳ 0.55 × 外框 y(±85°)（**必须用真实投影 y**，禁止写死 ±8）。

## 4. 管线

```mermaid
flowchart LR
  BG[bg 海色] --> HL[高亮描边]
  HL --> Mesh[地块网格]
  Mesh --> EL[elementsLayer]
  EL --> Coast[海岸 同算法]
  EL --> Parts[shown 层元素 fill+stroke+shadow]
  EL --> Paths[路径]
  EL --> Sym[符号/标签/框]
```

## 5. 选中与显示

```mermaid
flowchart TB
  ClickLayer[点图层] --> Sel[选中 focusLayer]
  ClickLayer --> Vis[双击 visible]
  Sel --> Shown
  Vis --> Shown
  ClickElem[点元素] --> Top[regionSelected 最后画 + 高亮]
```
