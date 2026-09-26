# Mapedi 下一轮优化（代码 / 功能 / 性能审查）

> 更新：路径编辑 / 笔刷覆盖层 / 高度标签 / 星系与边界重构之后  
> 原则：先修显示与交互，再压每帧成本；**不以「换引擎」为默认答案**。

---

## 1. 架构：设想 vs 现状

| 维度 | 设计初稿 | 现状 | 差距 |
|------|----------|------|------|
| 数据 | 球面真相，core 无 DOM | 保持 | 大量 `{...world}` 浅拷贝（可接受） |
| 渲染 | Canvas2D + 视口裁剪 + 缓存 | 边界环缓存、路径轻量管线、覆盖层分离、**worldCopy 按 worldBBox 收紧** | 25k 全图 pan 仍可再压 |
| 编辑 | History 栈 | 有；touch 已分层；高度命令结构共享 + 拓扑门闩 | 大命令可再 COW |
| 路径 | 未定 | PathFeature + Catmull-Rom + 指针编辑 | 工作区 1 元素 : 1 曲线 |
| 笔刷 | 画进地图层 | **覆盖层光标**；数据交互才重绘 | 语义层绘制仍会触发 render（节流） |
| 球面 | 3D 预览 | lon/lat **原生**上球 | 与 2D 同一 cellColor |
| WASM | 暂不做 | 仍无 | 热点在 TS 循环与全量 fill |

**结论：** 卡顿主因是「全量管线 + touch 过粗 + 边界每帧算」，不是缺 WASM；已消掉大半。

---

## 2. 功能审查

| 优先级 | 项 | 状态 |
|--------|----|------|
| P0 | 指针拖放 / 兄弟序插入 / 降级升级 | **已完成** |
| P0 | 选中高亮（cell 亮边 + 边界 glow） | **已完成** |
| P0 | 边界假闭环 / 穿屏 | **已完成**（不 closePath + 大跳拆段 + hide 跳过） |
| P0 | 框外不显示 | clip + frame 遮罩 |
| P0 | 路径：控件、虚线幽灵、1 元素 1 曲线 | **已完成** |
| P0 | 笔刷=鼠标替身，移动不全图重绘 | **已完成**（覆盖层 + 节流） |
| P0 | 高度 hover/地块上标高度 | **已完成** |
| P0 | 高度笔刷 Shift=归零 / Ctrl=降低 | **已完成** |
| P1 | 大陆/湖/海自动归属 + 身份保留 | **已完成** |
| P1 | 面板同构 / 双击信息 / 添加组件 | **已完成** |
| P1 | 球面参数进顶栏 + 球面原生渲染 | **已完成** |
| P2 | 球系公转可选模式 | 已拆出；当前默认仅本星 |
| P2 | 附庸关系 | **已完成**（attributes.suzerainId / enemies / allies + 信息面板） |
| P2 | 导出 SVG/PNG | **已完成**（高度着色 + 国家 + 路径；PNG/高度图/GeoJSON 已有） |

---

## 3. 性能审查（已做的缓解）

| 场景 | 原风险 | 现状缓解 |
|------|--------|----------|
| 进道路绘制卡 | 全量 borders/labels/fill | **轻量管线** + **singleWorldCopy** |
| 拖路径点卡 | 每次 touchWorld | 拖动仅 overlay/轻量 render；up 才 touch |
| 进高度层 | countryFill 全量重建 | 路径层跳过 fill；高度靠 overlay 标签 |
| 边界每帧 O(owners×edges) | 热点 | **borderCache** + bbox 视口剔除 + **owner 边表预计算** |
| 高度 stroke | projCache 被打穿 | **touchHeight** 不失效投影；**rAF 合并 notify** |
| 高度 commit | 每次全量 flood | **拓扑未变则跳过**；脏 cell **增量 flood** |
| History 高度 | 笔刷大快照 | **HeightStrokeCommand** 只存脏样本 + **相邻 coalesce** |
| History Region | 删除/吞并深拷贝 | **COW**（splice 后引用转移；编辑时换新数组） |
| History 绘制 | 多笔画堆栈 | **保持多步 undo**（Paint 不合并；高度手势才 coalesce） |
| 序列化体积 | sharedEdges 全量 | autosave **stripSharedEdges**；加载时从 cells 重建 |
| pan 副本 | 空 pass 仍画 | **projCache.worldBBox** 收紧 worldCopy + 视口过滤 |
| 海岸每帧扫 sharedEdges | O(edges) | **coastEdges 缓存**（高度拓扑失效） |
| 高度层白算 countryFill | 焦点无关 | **ensureFills 按焦点** 跳过 |
| cell 陆地色每帧算 rgb | 热循环 | **landColorLUT** 32 档量化 |
| 大陆标签中心每帧 unwrap | O(cells) | **continentCenters 缓存** |
| 拖放面板 | 每次 move 读 layout | **rect 缓存**；拖拽中 **禁用展开动画** |
| 工作区长列表 | 全量 DOM | **虚拟化** ≥72 行 + 合成 rect（含路径列表） |
| 右键菜单干扰 | 浏览器 contextmenu | canvas preventDefault |

仍待实测：2.5k / 25k 拖拽帧时间。

---

## 4. 下一轮路线

### A. 渲染
1. **已完成** 边界环缓存 + 视口剔除  
2. **已完成** 路径编辑轻量管线 + 单副本  
3. **已完成** 笔刷/标签/控件 → 覆盖层  
4. **已完成** 全图 pan：worldCopy 按 worldBBox 收紧 + 空副本过滤  
5. 待做：OffscreenCanvas + Worker（25k 时）

### B. 数据与编辑
6. **已完成** touchWorld / touchRegions / touchHeight / touchView  
7. **已完成** 高度：拓扑门闩 + 脏 cell 增量 rebuild  
8. **已完成** History 大命令结构共享（高度 coalesce + Region COW；Paint 保持多步 undo）  
9. **已完成** 序列化 sharedEdges 可选剥离 + cells 重建

### C. 算法（WASM 可选）
10. Voronoi / 侵蚀 / 边界链化热循环 — 待 profile  
11. **部分** 预计算边表 bbox（owner 边表 + span + coast 缓存）

### D. UI
12. **已完成** 列表虚拟化（工作区/路径 ≥72 行：固定行高窗口 + 合成拖放 rect）  
13. **已完成** 拖放 rect 缓存  
14. **已完成** 拖拽时禁用展开动画

---

## 5. 验收指标

| 指标 | 目标 |
|------|------|
| 2.5k 平移/绘制 | 主观流畅 |
| 路径编辑 | 控件可见、可拖、虚线幽灵正确 |
| 高度 | 图上可见高度值；Shift 删陆 |
| 选中边界 | 可见、不穿出框 |
| 25k 浏览 | 可拖；边界可关降级 |

---

## 6. 本轮已落地清单

| 项 | 状态 |
|----|------|
| borderCache + 边界视口剔除 | **完成** |
| touchWorld / Regions / Height / View 拆分 | **完成** |
| 高度 touchHeight 不失效 projCache + 脏标记 rebuild | **完成** |
| 路径：Catmull-Rom、投影加点、Shift 删点、端点晋升 | **完成** |
| 路径控件覆盖层 + 拖点虚线幽灵 + hidePathId | **完成** |
| 1 工作区元素 = 1 条曲线；选中后编辑 | **完成** |
| 笔刷=鼠标替身；overlay 与地图分离 | **完成** |
| 高度：地块标注 + Shift/Ctrl 语义 | **完成** |
| 球面：参数顶栏 + lon/lat 原生上球 | **完成** |
| 河流图层 ensureBuiltinLayers | **完成** |
| 路径编辑 singleWorldCopy（少画两份世界） | **完成** |
| 高度拓扑门闩 + 增量 rebuildHeightRegions(dirty) | **完成** |
| HeightStrokeCommand 结构共享 + History coalesce | **完成** |
| sharedEdges 序列化剥离 + rebuildSharedEdgesFromCells | **完成** |
| owner 边界边表预计算（borderCache） | **完成** |
| projCache.worldBBox 收紧 worldCopy | **完成** |
| 高度笔刷 rAF 合并 notify | **完成** |
| 拖放 rect 缓存 + 拖拽禁用展开动画 | **完成** |
| History Region COW + 高度手势 coalesce | **完成** |
| owner 边表 lon/lat span 粗剔除 | **完成** |
| 工作区列表虚拟化（≥72 行） | **完成** |
| 海岸边缓存 + 大陆中心缓存 + 陆地色 LUT | **完成** |
| ensureFills 按焦点跳过 | **完成** |
| SVG 导出增强（高度/国家/路径） | **完成** |
| 附庸 / 敌对 / 同盟（国家层信息面板） | **完成** |
| OffscreenCanvas / WASM | 待做（profile 后再上） |

下一步：用 DevTools Performance 录 2.5k/25k 基线；若 pan 仍卡，考虑 Worker。
