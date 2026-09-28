# 归档：阴影功能 + Canvas2D 渲染后端（2026-09-28，用户决定）

> **禁止当依据。** 本目录是历史参考代码，不参与构建。
> 用户决定（两次明确）：**阴影永不做**；**Canvas2D 渲染后端退场，渲染只走 GL（WebGL2）**。
> 若未来要恢复，需先向用户确认——这不是遗留待办，是产品层面的否决。

## 归档内容

| 文件 | 出处 | 内容 |
|---|---|---|
| `_layers_excerpt.ts` | `render/layers.ts` | Canvas2D 元素管线：`bgLayer` / `cellsMeshLayer` / `elementsLayer` / `paintPieceParams`（含 clip+blur 内阴影块、选中 glow） |
| `_geometry_excerpt.ts` | `render/gl/geometry.ts` | 内阴影 Φ 剖面渐隐条带 `buildFadeRibbon`（α(u)=Φ(2−2\|u\|)−Φ(−2−2\|u\|)） |
| `_gl_shadow_excerpt.ts` | `render/gl/mapRenderer.ts` | GL 阴影场图集：VERT_FADE / FRAG_FADE / FRAG_FILL_FIELD / FRAG_FADE_COMPOSITE / VERT_SCREEN、`fieldPass`（相位 A 场构建 + 装箱 tile）、`ensureFadeRT`（场 FBO）、`mergeFade`、fill+shadow 一次合成 |
| `staticLayerCache.ts` | `render/staticLayerCache.ts`（整文件） | Canvas2D 周期贴图烘焙 / 增量重烘 / `markDirtyCells` 失效 |

另：`core/layer/style.ts` 的 `ShadowStyle` 通道（含旧档 `innerShadow*` 迁移字段）与
`ui/shell/DisplayStylePanel` 的「内阴影」组、「渲染后端」切换行随本决定直接删除（未留源码副本，
语义见 git 历史 ≤ `342fbcc`）。

## 现行契约（对照用）

- 元素样式两通道：**边界 / 填充**（`ElementStyle`）。
- 渲染：**GL 唯一**（bg / cellsMesh / elements 三通道直绘），2D 画布只画辅助层
  （选中描边、路径曲线、装饰名称/标记、地图框）。GL 不可用 = 清屏 + 提示，**不再回退 2D 代画**。
- 填充/描边几何唯一源 `core/ring/*`（fill / stroke 同吃 DisplayRing）。
