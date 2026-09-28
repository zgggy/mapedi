# Mapedi 交接提示词（直接粘给下一个 AI）

你继续开发 **Mapedi**（球面奇幻地图编辑器）。工作目录：`/Users/zgy/mapedi`，应用在 `web/`，`npm run dev`。

**先读**：`AGENTS.md`（规则，已重构为 0–11 节：身份 → 六层定位模型 → 根因流程 → 硬规则 → 交付纪律 → 反例 → 踩过的坑 → 自检）、`RENDER_LOGIC.md`（显示契约）。`docs/_archive/` **禁止当依据**。

必须遵守：整包交付；每次改动写清 **问题 / 原理 / 预期效果**；发现双真相/坏选型要指出，不要打补丁；**显示不打折**；**除非用户明确说 test，否则不要跑测试**；默认焦点层是 **地块（cells）**，不是高度；**视觉差异先打印数据层实际值再怀疑渲染**（AGENTS.md §8 坑 5）。

---

## 当前状态（截至交接）

**第四十三次（2026-09-28）— 100k 球面 Voronoi 超线性根治（方向桶播种）+ 悬停小项**

- **超线性根因（实锤）**：quickhull 播种行走失败 → **全扫兜底 O(面数)**：100k 下 671 次全扫
  ≈ 90% 平面测试（71M 次）≈ 超线性主体。行走失败是「可见域梯度行走卡局部极大」（跨距随机
  探针命中率 3/8000——随机面几乎不在可见域里）。
- **修复**：① **方向桶播种**：面法线入 32³ 方向桶；新点按自身方向查 27 邻桶，法线朝向它的面
  即可见面（近球面点定理：外点的可见域 = 朝向它的面），桶命中即播种 → 行走 O(1)。
  全扫 671→12，planeDist 调用 71M→28M。② 面法线缓存（planeDist 每步 4 次平面测试，免重算叉积）。
- **性能**：100k createWorld **8-22s → 4.8-6.9s（分载波动）**；全链（100k）= 4.8s + 级联 0.65s +
  序列化 0.25s + 反序列化 0.83s。30k ≈ 1s。
- **等价性**：新旧代码逐格对照（30k）——邻居集 0 差异、圆心 0 差异；仅 **10/30000 胞**的多边形
  有第 9 位小数的顶点焊接差异（三角化遍历序不同 → snap 先到先得的偶然差，拓扑/显示无差异）；
  同种子重生成全等（确定性 ✓）；5000 档与旧版逐位一致。
- **悬停小项**：「偶发不显示」是探测器假象（桥丢第二结果）；真实小不一致 = 绘制中 hover 只在
  高度层更新 → 已改所有层。
- **验证**：check 0 errors；/tmp/eq_hull_detail.mjs（结构不变量+确定性）、/tmp/hull_dump.mjs
  新旧对照、bench_hull2、genprof 全链。
- **待办**：可选——per-cell 颜色图集（渲染更优路线，另行立项）；顶点 snap 先到先得可改
  规范代表（最小键）使输出与遍历序完全无关（当前 10/30000 的微差即源于此）。

**第四十二次（2026-09-28）— 修复包 C：删 BrushHud + 项目面板 PanelShell 化 + 显隐契约变更**

- **删绘制悬浮窗（BrushHud）**：内容并入工作区（工具切换 笔刷 B/权重 W、宽度滑块、提示行
  "左键刷选定值 · 右键擦除 · 空白点击 / Esc 退出"）；完成按钮=空白点击/Esc 已有。文件已删。
- **项目面板 PanelShell 化**：TopBar 的 hover 展开/胶囊样式废除，改 PanelShell 浮动面板
  （"项目 · {mapName}"，可拖动/收起）；Dock 增 🗃 项目 钮（togglePanel 'project'）。
- **显隐契约变更（用户要求）**：图层行点击 = **持久切换显隐**（与眼睛同一开关）+ 聚焦 + 开工作区；
  焦点/选中不再强制显示（废「选中 ≡ 显示」——它与 3 树上限叠加产生"点行只临时显示"）。
  isLayerShown 只看 layer.visible；focusLayerForDraw 不再补灯。AGENTS.md §3/§6 契约行已同步。
  实测：连点行状态栏依次"显示「植物」/隐藏「植物」" ✓。
- **笔刷帧成本（修复后实测）**：输入 0.22ms/move；松手（无翻转）1.5ms；拖动中重绘帧 0.2ms、
  增量件环补丁帧 ~10.7ms（30 格笔触）；常规重绘 CPU <1ms（重暖风暴已由 A/B 包收敛）。
- **验证**：check 0 errors；浏览器实测 BrushHud 消失、工作区工具钮/提示在、项目面板可开、
  行点击持久显隐、GL 渲染正常。
- **待办**：100k 球面 Voronoi 超线性（凸包/Delaunay 6-8s，用户已批"开动"但按其指示暂缓）；
  悬停信息偶发不显示（遗留小项）；可选：per-cell 颜色图集（渲染更优路线评估）。

**第四十一次（2026-09-28）— 修复包 A+B：颜色滞后 / 显隐失效过宽 / 选中黄框 / 远海深海颜色根治**

- **A2 颜色滞后（"改了颜色不变，切图层才对"）**：提交后**无重绘触发**——渲染 effect 只盯
  cells.length/regions.length/focus 等，笔刷提交一个都不变 → 屏幕停在旧帧。修复：effect 增加
  `void world`（world 身份 = 任何数据触碰；笔刷热路径已不再逐 tick 翻新 world，可安全作信号）。
  实测：涂改后即时变色（无需任何图层操作）。
- **A3 选中黄框**：startHeightDraw 原先清空 selectedRegionId（绘制中工作区无选中）。改为
  selectedRegionId = 目标区间 → 工作区行 `.sel` 黄框 ✓ 与图层面板选中语义一致。
- **A1 显隐失效收窄**：toggleLayerVisible/setLayerOpacity 原走 touchRegions →
  invalidateBorderCache（清全部件环）→ 全量重暖。改为 `touchLayerView()`：bumpRegionsRev
  （只失效合成缓存）+ world 身份 + notify；件环/几何缓存不碰（显隐不改任何 cell 集）。
- **B 远海/深海颜色根治（问题 1）**：
  ① 区间改**精确档**（lo ≤ h ≤ hi，互不相交）——嵌套累积（h≥lo）废除：可见色不再取决于行叠放序，
  件从 31 万格缩到 10 万格，增量归属与全量重建一致（/tmp/eq_bins.mjs）。
  ② **奇偶探针 + 框矩形外环**：borderCache.computeFrameFlip 用成员/非成员探针判定环集 evenodd
  是否"盖成员、排非成员"；需翻转时 preparePieces 注入框矩形环（MidRing 语义 = 4 边中点+4 转角，
  外扩 0.08 rad 在可见框外）。贴框/含极集合的外轮廓缺失（远海=轮廓环之间的带）由此修正。
  浏览器实测：远海点像素距远海色 38 vs 距深海色 58（修复前距深海仅 7——即"反了"）。
- **验证**：check 0 errors；/tmp/eq_bins.mjs（12 档覆盖口径含 flip + 增量=全量）；
  浏览器实测远海/近海/浅滩/低地像素各归其色、涂改即时变色、选中黄框。
- **发现的遗留小项**：① 悬停信息在绘制会话后偶发不显示（StatusBar hover 空），未查；
  ② 画布像素验证须避开浮动面板遮挡（测试方法教训）。
- **待办**：修复包 C（删 BrushHud、项目面板 PanelShell 化、点行显隐契约）→ 笔刷帧率复测。

**第四十次（2026-09-28）— 八项问题分析（只诊断不修，凸包等其余暂缓）**

1. **远海/深海颜色"反了" = 件环拓扑 bug（实锤）**：高度区间元素是嵌套集（h≥lo，h0=全部格），
   可见色=叠放序最后盖上的一层。实测存档成员正确（h1=99438 精确、远海格 0 缺失）、色表/行序正确，
   但 **h1（远海）的件环 evenodd 覆盖 = 0/201**——其 35 个环全是深海补丁的**内洞环**，
   **外轮廓环缺失**（该集合的外边界贴地图框/极区，求环把它丢了）→ evenodd 填进洞里：
   远海区露出下层 h0 深海色、深海补丁反而染远海色 = 用户所见"反了"。h2/h3 覆盖 201/201 正常。
   复现：/tmp/eq_ringcover.mjs。修复方向：A 修求环外框闭合；B（推荐）区间改**精确档**
   （lo≤h≤hi，非嵌套）→ 边界全为内部海岸线（已证正常的拓扑），顺带解决顺序依赖/半透明叠加/
   h0 全图巨件（件环 158ms）。
2. **图层显隐全量重绘 = 视图态走了数据失效**：toggleLayerVisible → touchRegions() →
   invalidateBorderCache()（**清空全部件环缓存**）+ materializeParentCells + world spread。
   显隐只是「一层内容显不显示」，几何缓存（键=setKey+proj+geomRev）根本不受影响——
   应只 bump 视图信号（bumpRegionsRev 即可失效 compose 缓存）+ notify。12 件环冷求取实测 255ms，
   全部件集 = 秒级。
3. **笔刷慢 = 帧率而非输入**：实测每 move 同步处理 0.2ms、down 1.6ms、up 0.7ms（100k）——输入链路极快。
   慢在绘制中每 90ms 全图重绘（12 个嵌套区间件 = 31 万格三角化 + GL 提交）+ 松手后 touchHeight(true)
   → 件环全失效 → 重暖风暴。区间改精确档（件从 31 万格→10 万格）+ 显隐/失效收窄后应显著改善。
4. **渲染方法**：现行「件环几何 + 相机 uniform + 副本实例化」对少量大件合理；弱点=件环求取 O(cells)
   且失效过宽、嵌套半透明叠加、每帧全量提交。更优路线：**per-cell 颜色图集**（1 texel/cell 的
   纹理 + 网格直绘，填充一通道完成，成本与元素数无关），描边走共享边表（28 万边，同 cellsMesh 桶化）；
   渐进做：先做 1-2 的失效收窄与精确档，再评估图集。
5. **重绘前卡（fps 1-2）= 件环重暖风暴 + 冷件跳过**：warmQueue 逐件 requestIdleCallback（每件
   20-200ms），期间未暖的件被**整件跳过**（渐现），故"卡一阵→内容才刷出来"。刷新/切层/绘制完成/
   显隐四处触发同一风暴。根治 = 失效收窄（1/2）+ 件环求取降本（精确档、图集化）。
6. **只有眼睛才能切换显隐 = `选中 ≡ 显示` 契约**：isLayerShown 对焦点层 `return true`（无视 visible），
   点行=聚焦+开工作区+（focusLayerForDraw）强制点亮 → "临时显示"；眼睛才改持久 visible。
   这是现行显示契约（AGENTS.md §3）——要改需改契约：建议"点行=切换显隐+聚焦开工作区"，
   或"点行仅聚焦，不隐式显示"。另发现：进入绘制会话清空 selectedRegionId（元素信息变"未选中"）。
7. **项目面板 PanelShell 化**：项目栏=TopBar.svelte（固定顶栏：种子/密度/生成/导入导出/球面参数），
   改为 PanelShell 浮动面板（同 DisplayStylePanel）即可，纯 UI 包。
8. **删除绘制悬浮窗**：BrushHud（工具钮/笔刷宽度/提示/完成）与工作区重复（宽度滑块、空白点击=完成），
   唯一无处安放的是笔刷/权重工具切换（B/W 快捷键仍在）——可并进工作区或走快捷键。
   附带：startHeightDraw 清空 selectedRegionId 的行为建议顺手修。

**本轮已处理（2026-09-28，第三十九次）— 生成小头：撒点/级联/反序列化提速**

- **撒点（blueNoiseSphere/tryPush）**：桶结构 Map<number,number[]> → 开放寻址 Int32 槽表
  （gk+1 存键、0=空、probe 到空位）+ next 链；距离 `** 2` → 乘法。100k **4.19s → 1.69s（×2.48）**，
  30k 0.87s → 0.34s。**随机抽点顺序与接受/拒绝判定逐位不变**（只换查找力学）——同 rng 下
  点列逐点一致（/tmp/eq_gentails.mjs，500/3k/20k/100k 四档对拍旧实现）。
- **反序列化**：大头是 `rebuildSharedEdgesFromCells`（每邻面对每角点做字符串键 ≈ 500 万次模板拼接）。
  加 `lonlatNumKey`（与 lonlatKey **同分桶**：0.001° 网格 + ±180 缝归一的数值键），
  canonicalize 的 snap 表与边重建全部数值化；共享端点改为「邻格多边形里前两个相异命中即早停」
  （原实现收集全部交点再取前二）。输出与旧实现**逐条一致**（端点同序）。100k 反序列化
  **1.1-1.5s → 0.64-0.75s**；边表重建自测 1.0-1.2s → 0.48-0.52s。
- **级联（runCascade）**：实测 0.53-0.71s（100k），已优于旧记录 1.2s，无需再动。
- **全链（100k）终值**：createWorld 9.0s（球面 Voronoi/凸包 6-8s 是大头）、级联 0.67s、
  序列化 0.24s、反序列化 0.66s。
- **下一个大鱼（不在本包）**：100k 的球面 Voronoi（convexHullTriangles/planeDist/tryPush 段）
  相对 30k 超线性（3.3× 规模 ≈ 5-6× 耗时），如需再压生成时间应先动它。
- **验证**：`npm run check` 0 errors；/tmp/eq_gentails.mjs 输出逐位一致；未跑仓库测试。

**本轮已处理（2026-09-28，第三十八次）— 归档阴影全部功能 + 归档 Canvas2D 渲染后端（GL 唯一）**

- **用户决定（原话要点）**："不要阴影，所有阴影相关功能全部归档，现在全部 canvas2d 也是，归档，不要用了"。
  两条都是**产品层面的否决**——不是待办。todo/注释里凡写"阴影恢复时…"都只是归档约束，不是要做的事。
- **阴影归档**（`docs/_archive/canvas2d-shadow/`）：
  - 样式通道 `ShadowStyle`（ElementStyle 现两通道：边界/填充）、DisplayStylePanel「内阴影」组、
    旧档 `innerShadow*` 迁移字段（静默丢弃）。
  - Canvas clip+blur 内阴影块（paintPieceParams 整体归档）、GL Φ 剖面渐隐条带（buildFadeRibbon）、
    GL 场图集（VERT_FADE/FRAG_FADE/FRAG_FILL_FIELD/FRAG_FADE_COMPOSITE/VERT_SCREEN + fieldPass
    相位 A + ensureFadeRT + fill+shadow 一次合成）。fill→stroke 为唯一顺序。
  - 选中 glow（ctx.shadowBlur）随 Canvas 管线一并归档；选中语义不变（1.6× 描边 + 专属色）。
- **Canvas2D 渲染后端归档**：bgLayer / cellsMeshLayer / elementsLayer / paintPieceParams /
  staticLayerCache（周期贴图烘焙 + markDirtyCells 增量重烘）整批退场；`renderBackend` 切换
  （store/面板/StatusBar）删除，StatusBar 后端位固定 GPU。**GL 不可用 = 清屏 + 视口横幅提示，
  不再回退 2D 代画**。2D 画布仅剩辅助层：选中 cell 描边、路径曲线、装饰名称/标记、地图框。
  （范围说明：辅助层暂留 2D 绘制——砍掉=地名/路径直接消失；如需全清请明示，那是 GL 文字/曲线渲染包。）
- **RENDER_LOGIC.md** 同步为「GL 唯一后端」契约；归档目录 README 写明禁止当依据。
- **验证**：`npm run check` 0 errors；测试无引用被删符号（不动 tests）。浏览器实测 GL 唯一渲染
  正常（gpuRan>0、海陆像素齐、无阴影 UI、无后端切换、StatusBar=GPU）。
  **教训**：批量切除后 `ensureMapGl` 里残留 `if (renderBackend !== 'gpu') return null;` ——后端开关
  删除后 GL 永不启用、整图黑屏且零报错（drawWorld 早退）。**删开关要连同全部门槛分支一起清**，
  验证必须看"真的画了"（gpuRan/drawCount 计数或像素），不能只看无报错。
- **待办**：无（本轮清单已清空）。可选后续：100k 球面 Voronoi 超线性（见上）。

**本轮已处理（2026-09-28，第三十七次）— GPU cellsMesh 视口裁剪（100k 网格）**

- **问题**：GL 后端的 cell 网格每帧把全表边条带 instanced 直绘（100k cell ≈ 数十万顶点），无视口
  裁剪；Canvas 侧 cellsMesh 早有 ViewIndex 裁剪，GPU 是缺口。
- **原理**：`buildCellMeshStrips` 产出条带时按**均匀桶**（0.35 投影格，行主序、每桶顶点段连续）
  归置；画前按可见行取连续顶点段逐段 `drawArraysInstanced`。三个安全边界：① 副本平移只影响 x
  → 可见 x 取各副本并集（只多画不少画）；② **跨度 > 桶格的长线段（极区框边/跨桶边）进 wide 段恒画**
  （中点分桶会漏长段）；③ 短段查询 pad = 半线宽 + 桶格（段可见 ⇒ 中点距视口 ≤ 半段长 ≤ 半格）。
- **验证**：`/tmp/eq_meshcull.mjs` 不变量——段集合不丢不重 + 8 种视口下「与视口相交的段必被画」
  零漏画；浏览器**同页 A/B**（裁剪开 vs 整表直绘）**逐像素 0 差异**（显示不打折）。
  注：跨页截图对照会被存档/相机/渐现状态漂移污染（实测 94% 假差异）——后端对照必须同页切开关。
- **预期效果**：放大视口后平移/缩放更顺（提交顶点量随可见行数下降，放大到一角时仅几行）；
  显示与裁剪关断完全一致。回退开关已删（不留护栏）。
- **待办**（不变）：阴影恢复时走场图集路径（勿回包围盒）；生成小头（撒点/级联/反序列化）。

**本轮已处理（2026-09-28，第三十六次）— 拓扑翻转增量连通分量 + 修「区间绘制」与「翻转后 UI 停更」两回归**

- **拓扑翻转松手 O(n) 重建 → 增量连通分量**（本包核心）：
  - **问题**：造陆/造海松手重建与全量同价（实测 dirty=20 → 255ms ≈ 全量 250ms；dirty=556 超线性
    2405ms）。根因四条：dirty 分支仍跑 3× 全图 floodComponents；pickOld 对每个新块扫全部旧 region
    （二次）；computeRelationships 成对 Set 重建 O(els²×cells)（94ms）；keepOld 恒空（newCells 含全部
    新块 cells）。
  - **原理**：① 触及 = 含翻转格或翻转格邻居的旧实体（其 cells 可能变化的全部）；未触及实体原样保留
    （身份/命名/颜色稳定）。② 免全扫分裂判据：区域连通 ⇒ kept 子图每件必含 removed 的 kept 邻居
    （front）→ 从 front[0] BFS 到达全部 front 即单件（早停不扫全图）；否则逐 front 起件。③ 翻转格与
    同标签邻接（kept 块/翻转格）并查集成组合并。④ pickOld 只在触及候选里认领身份。⑤ manual 海不拆
    不并（enclave 合法）；rest comp 邻接 manual 归并改为**最大邻接 manual 海（join 前大小）**——旧
    实现取扫描序第一个，双路径不确定，注释本来就写「最大邻接」。⑥ 排序/命名平手取最小 cell id。
    ⑦ computeRelationships 划分快路径：cells 互不相交（海陆层不变量）时整型 owner 扫描 + 重叠恒空，
    双属即回退通用版；通用版重叠改单次 owners 对扫描（输出敏感）。
  - **等价性**（/tmp/eq_landsea.mjs，非仓库测试）：8 场景（海岸造陆/远海造岛/切陆桥/挖大湖/无翻转/
    manual 海拆分+join/连续 6 笔/小世界乱翻）对拍全量重建——分区、种类、manual 身份、关系签名
    （相邻+重叠，与 id 无关）全等；不变量全过（id 唯一、覆盖恰一、continentId 索引=数组序、非
    manual 连通、关系对称）。
  - **性能**（100k，warm）：incr dirty=2 ≈ 23-32ms（原 255ms）；dirty 规模不敏感（原 dirty=556 超线性）；
    全量 ≈ 43-57ms（原 250ms）。默认 30k 约 1/3。/tmp/bench_landsea.mjs、bench_loop.mjs 可复跑。
- **修回归①「点区间不进高度绘制」**（92ac586「选中即绘制/删绘制按钮」时引入）：点高度区间行走
  `startDraw` 通用区域归属，值直刷（`__height__` 协议）丢失——实测悬停高度不变。修：`startDraw` 对
  `kind==='interval'` 元素路由 `startHeightDraw`（数据驱动规则，未来区间型元素同语义）。
- **修回归②「翻转后 UI 停更」**（本包新代码引入，已根治）：重建输出**复用旧 Region 对象**（原地改写
  $state 代理 + 旧代理混入新 regions 数组）→ Svelte 更新管线静默停摆：状态全对（selectLayerTop 等
  日志正常）但 DOM 不再刷新、undo 的 redoStack.push 被跳过。修：**重建输出一律新对象**（字段级保
  id/名称/颜色/属性），manual 补丁落在输出副本上。教训：**热路径不要复用 $state 树里的对象引用**，
  重建产物与旧状态解耦（旧全量路径本来就是全新建对象）。
- **命名防撞**：铸造名避让已有名（kept/自定义名不改）——修复「两个大陆 8」与跳号。
- **撤销/重做一致性复验 ✓**：Ctrl+Z → 高度回退 + 增量重建溶解大陆（land:0）；Ctrl+Shift+Z → 复原
  （land:1）。浏览器实测 + 临时日志观测（验后已删）。
- **验证方法教训（浏览器自动化）**：① 合成指针/键盘事件里触发**重同步工作**（重建/撤销）会顶穿 MCP
  桥报 Internal error——事件其实已执行，读后续状态判断；② 多事件塞一个 evaluate 同理，逐个派发；
  ③ Playwright click 的 actionability 在本页会挂，用 evaluate `el.click()`；④ Svelte dev 把
  console.log 包成 log_if_contains_state，抓日志要直写全局数组；⑤ CUA 组合键偶发不送（同一热键
  有时要发两次）；⑥ 模型看不了截图时用 PIL 做像素级对比验证（找海/陆落笔点、涂改前后 diff）。
- **待办**（不变）：100k 网格视口裁剪；阴影恢复时走场图集路径（勿回包围盒）；生成小头
  （撒点/级联/反序列化）。

**本轮已处理（2026-09-28，第三十五次补充）— 死代码整包清理（删就真删，18 件）**

- **删除（全仓零引用）**：shell 遗留 12 件（GenDock/HeightIntervalList/LayerStyleBar/LayersDrawer/
  ProjectPanel/Rail/Rails/SideDrawer/SliderField/ViewDock/Sheets/panelTokens）+ workbench 5 件
  （ElementList/GenerationProfiles/InfoPanel/ToolsPanel/WorkbenchHost）+ render/globeTexture。
  ElementList 的滑块是 CapsuleSlider 的双份旧实现，一并消失。world.ts 注释去掉已删的 GenDock 提法。
- **保留（勿删）**：core/political、core/nature、core/relief、core/ring/trace——src 内已零调用
  （unifiedGenerate 链之外的旧生成器），但 **tests/ 大量覆盖**（generatePolitical/childrenOf/
  generateFauna/generateVegetation/cellReliefHeights/traceMidRing…）。测试是业务规则显式载体
  （AGENTS.md §6「测试纪律」），删它们=删规则+改测试，属产品决策，不属清理包。
  如确认旧生成器彻底退场，需连同 tests/ 对应用例**一次性整包**处理并明确业务结论。
- **核实方法**：import 图可达性（含 import()/new URL 动态引用）+ tests/ 真实 import 逐个核对；
  删后 grep 全仓零残留；`npm run check` 0 错误；浏览器冒烟（15 层行 / 12 区间行 / 胶囊滑块 / 错误 0）。
- **注意**：core/generate/worker.ts 曾被误判死代码——它经 new URL 动态引用可达，**不可删**；
  命令行 grep 宽泛词（Rail/InfoPanel 等）会误命中子串（Rails/LayerInfoPanel），必须核对 import 语句。
- **剩余待办**：拓扑翻转增量连通分量、撤销/重做一致性复验、生成小头（撒点/级联/反序列化）、
  100k 网格视口裁剪、阴影恢复时走场图集路径（勿回包围盒）。

**本轮已处理（2026-09-28，第三十五次）— 面板/按钮契约二轮：胶囊滑块 + 右键菜单 + 抬起式拖动 + 长名称不省略**

- **用户契约（8 条）**：① 面板可拖动、高度随内容增至 ≤0.8 屏高、内滚不显条；② 图层操作说明删除；
  ③ ItemButton 右键菜单（显示/隐藏、上移一层、下移一层、复制一个、删除），去掉行侧删除按钮；
  ④ 所有 ItemButton 等高、名称不省略；⑤ 滑块改「大胶囊套小胶囊」样式（两端 min/max，值随小胶囊右端，
  >50% 值在内/否则在外，拖动时右端上方气泡，整数离散/浮点连续）；⑥ 元素按钮去简介；
  ⑦ 所有 ItemButton 用单列网格排布；⑧ 拖动 = 整个按钮被拿起来（浮动件跟指针，动画不瞬移），
  最近格 = 临时占据格，该格与下方元素让一格。
- **新组件**：`CapsuleSlider`（胶囊滑块，window 监听）、`ContextMenu`（右键菜单，导出 MenuItem）、
  `liftDrag.ts`（抬起式拖动数学：liftTransforms 紧凑+目标格开口净位移 / insertIndex 指针上方中心数 /
  insertPlan 父展开行与首子间 = nest-first）。`ItemButton` 重写（等高 var(--ibtn-h)、名称换行不省略、
  onMenu 右键、拖动来源行 visibility:hidden=被拿起来）；`PanelShell` 重写（header 拖动、max-height 80vh、
  scrollbar-width:none）。
- **store 新操作**：`toggleItemHidden`（元素/路径级 hidden，displayCompose + pathsLayer 过滤）、
  `moveItemStep`（图层/元素/路径同父兄弟内上移/下移一层）、`copyItem`（图层复制设置/元素空胞副本/路径点列副本）、
  `deleteItem`（自定义图层 + 元素 + 路径）。Region/PathFeature 加 `hidden?: boolean`（仅显示层过滤）。
- **根因修复（顺手）**：`updateHeightIntervalElements` 原按**下标**耦合 `HEIGHT_INTERVALS[i] ↔ els[i]`——
  用户拖动改变区间顺序后，增量归属会写错区间。改为**按 lo 匹配**元素（顺序只影响叠放）。
  另：区间元素是派生数据，右键菜单的复制/删除对派生项禁用（重建会冲掉）。
- **拖动模型核对**：liftTransforms 的「紧凑 + 目标格 p 开口」净位移与用户描述的
  「该网格和下方网格的所有元素往下让一格」在紧凑坐标系下逐位一致；命中用拖动起点缓存 rect
  （transform 不反馈，防让位动画影响命中）。建子行同高占格；行高统一由 MutationObserver 测量
  （measureSlot：全表取最大内容高，名称换行也等高）。
- **验证（浏览器，100k 世界）**：面板 maxH=580px=0.8×725、滚动条隐藏、可拖动 ✓；操作说明已删 ✓；
  单列网格 ✓；等高（40px 常规 / 长名称下全表 88px 等高）✓；长名称 5 行全显不裁剪 ✓；
  胶囊滑块（两端 min/max、值随右端、>50% 值在内、拖动气泡 -29、松手消失、整数离散）✓；
  右键菜单（图层：显隐/上下移/复制/删除-内置层禁删；元素：同；派生项复制/删除禁用）✓；
  上移/下移/复制/删除逐项实测 ✓；抬起拖动（浮动件跟指针 + 让格 transform + 松手重排）✓；错误 0。
- **测试污染清理**：自动化测试复制出的「远海 副本」已删；被拖乱的图层顺序与高度区间顺序已恢复原序
  （图层：地块/高度/海陆/环境/植物…；区间：深海/远海/近海…）。
- **注意**：HMR 半热态会让右键菜单等失灵（验证前必须 reload）；页面 timer 被节流时 evaluate 内长
  setTimeout 会超 3s 预算（用拆步 evaluate + waitForTimeout）；DOM 直改不触发 Svelte 响应
  （paintValues 曾因普通对象不回显，改 $state 修复）。
- **待办**：死代码整包清理（Sheets/Rails/GenDock/ViewDock/ProjectPanel/SideDrawer/LayersDrawer/
  LayerStyleBar/HeightIntervalList/SliderField/ElementList/ToolsPanel/InfoPanel/WorkbenchHost
  + core/nature、political、relief、ring/trace、render/globeTexture；其中 ElementList 滑块是
  CapsuleSlider 的双份旧实现）；沿上轮：拓扑翻转增量连通分量、撤销/重做一致性、生成小头、
  100k 网格视口裁剪、阴影恢复走场图集。

**本轮已处理（2026-09-27，第三十四次）— 面板/按钮统一重构（PanelShell + ItemButton + Dock + 长按拖动）+ 修图层错位回归**

- **用户报告回归**：图层显示错位、图层内容全部不显示。
  **根因**：上一轮模板 splice 丢了 `.lp-head` 的 `</div>` → hint/`.list` 被嵌进 `.lp-head`（flex 横排），
  列表被挤成 16px 并被 `overflow:hidden` 裁掉（行压成 2px 宽、x≈280 溢出面板）。**教训**：
  模板 splice 后除 svelte-check 外还要量几何（DOM 在 ≠ 布局对）；验证只查 DOM 结构会漏掉这类回归。
- **附带运行时问题（见一例修一例）**：`main.ts` 的「启动中…」占位从不移除（Svelte5 `mount` 是**追加**
  不是清空）→ 修：mount 前 `target.innerHTML = ''`。
- **交互契约（用户定）**：
  1. 每个 button = 显隐眼睛（指示或切换）+ logo（图层 emoji/元素色）+ 名称 + 可选简介 + 可选控件
     （高度元素 = 滑块「区间=元素高度范围」+ 右侧当前值；其他元素暂无控件）；
  2. 图层信息 / 图层显示参数 / 元素信息 与图层同级：独立面板，可收起展开；
  3. 全部面板用统一壳（header 标题**居中**、**收起按钮在最左**、下方内容区）；
  4. 收起 = 面板消失为屏幕**左下角 Dock 图标**（从左往右排列；黄框=打开，无黄框=收起；点击切换）；
  5. button **不可直接拖动**：长按 → 背景进度条从左到右填满 → 解锁拖动；拖动时其他元素让开成缝，
     松手触发新顺序重算；进度未满松手=单击，进度未满位移=取消。
- **实现**：
  - 新增 `PanelShell.svelte`（统一壳）、`PanelDock.svelte`（左下图标栏）、`ItemButton.svelte`
    （统一行按钮 + 长按进度条 + 拖动回调）、`EntityInfoBody.svelte`（信息内容体，从弹窗抽出）、
    `LayerInfoPanel.svelte` / `ElementInfoPanel.svelte`（PanelShell 化信息面板，跟随焦点图层/选中元素）。
  - `LayersPanel` / `WorkspaceDrawer` 重写为 PanelShell + ItemButton 行；拖动改长按解锁；
    让位 = `gap-above/gap-below` 边距动画（替代 drop-line）；nest 高亮保留；松手走
    `editor.dragLayer/dragRegion` 重排重算。区间滑块语义不变（拖滑块=选中+涂改值）。
  - `DisplayStylePanel` 去掉自己的浮动壳/×，接 PanelShell；双击图层行 = 打开显示参数面板。
  - App：`panels` 五态 + Dock 接线；元素信息/图层信息由**选中驱动**（行内 ℹ 按钮删除）；
    行动区只留 ▸ 展开 / 🗑 删除（在 button 外）。
  - 删孤儿：`EntityBox` / `EntityRowShell` / `EntityInfoModal` / `WorkspacePanel` / `PanelHeader`。
- **验证（浏览器，100k 世界）**：回归修复（图层行 182px 名字可见）；「启动中…」残留 0；
  header 收起钮最左+标题居中 ✓；Dock 5 图标切换开关 ✓；高度行（简介=区间+滑块+当前值）✓；
  普通元素行（色块+名字+3123c 简介+无滑块+眼睛仅指示）✓；拖滑块 -45=选中+涂改值 ✓；
  选中即绘制/空白退出 ✓；眼睛显隐 ✓；双击开显示参数 ✓；长按拖动（300ms 进度 92/182 → 解锁出
  ghost → 环境/植物让位开缝 → 松手「高度」移到「环境」后）✓；运行时错误 0。
- **待办**：① 死代码整包清理（Sheets/Rails/GenDock/ViewDock/ProjectPanel/SideDrawer/LayersDrawer/
  LayerStyleBar/HeightIntervalList/SliderField/workbench 五件 + core/nature、political、relief、
  ring/trace、render/globeTexture——引用图确认不可达，但属既有遗留，单独清包防误伤测试引用；
  ElementList 与 WorkspaceDrawer 滑块是双份实现，删 ElementList）；② 沿上轮：拓扑翻转增量连通
  分量、撤销/重做一致性、生成小头、100k 网格视口裁剪、阴影恢复走场图集。

**本轮已处理（2026-09-27，第三十三次）— UI 交互重构（眼睛显隐 / 选中即绘制 / 悬浮图层面板）**

- **用户定交互契约**：① 工作区**删除全部拖动功能**；② 滑块放进 button 里，**只有选中行是黄色外框**；
  ③ 图层面板删"双击显隐"，button **左侧加眼睛图标**（睁眼=显示、闭眼=隐藏，点击切换）；
  ④ 双击图层行改为**弹出显示面板**（DisplayStyle）；⑤ 图层面板改**悬浮面板 + 左上角收起**；
  ⑥ 点图层行 = **打开工作区**；⑦ 工作区里**选中任何元素直接进入绘制**（删除绘制按钮）；
  ⑧ 退出绘制 = 完成/Esc/**点工作区空白处（无选中元素）**。
- **实现要点**：
  - `EntityBox`：眼睛按钮（`.eye` / `.closed` 用 scaleY 压扁表示闭眼）在 main 左侧；双击 = onStyle；
    acts 只留 ℹ/🗑（👁/🖌 动作按钮删除）。
  - `LayersPanel`：悬浮卡片（shadow/radius）+ `collapsed` $state + `.lp-head` 收起按钮（☰/⊟），
    `{#if !collapsed}` 包列表；行单击 = handleSelect + onDrawLayer（选中并开工作区）。
  - `WorkspaceDrawer`：拖动机制整体删（collectRects/pointer*/shellHint/parentHl/dragId/dropHint…）；
    行卡 `.rowwrap.sel`（黄框）内 `.rowbtn` 含滑块（input stopPropagation 不触发选中）；
    `handleSelect` = onSelect + onDraw（选中即绘制）；`onBlankClick` = onSelect(null) + onDrawMode()
    退出绘制；🖌️ 绘制按钮删除；虚拟列表行统一 `{@render rowNode(item.node)}`。
  - App：onSelect(null) 空白=取消选中；onPaintValue 推送滑块值。
- **验证（浏览器自动化，100k 世界）**：eyes=15、眼睛 hidden↔vis↔hidden ✓、双击弹出
  "DisplayStyle · environment" ✓、rowbtns=12 内含 12 滑块 ✓、绘制按钮=0 ✓、选中后
  `.viewport-root.draw` ✓、空白点击退出（class 去 draw）✓、运行时错误 0 ✓。
- **注意**：图层面板**保留**拖动排序（用户只要求删"工作区的拖动"）；EntityRowShell 的
  dragging/hint props 仍被 LayersPanel 使用。
- **待办**（沿上轮）：拓扑翻转增量连通分量；撤销/重做一致性复验；生成小头；cell 网格 100k
  视口裁剪；阴影恢复时走场图集路径。

**本轮已处理（2026-09-27，第三十二次）— 绘制语义 v2（选定值直刷）+ 工作区滑块联动 + 修绘制回归**

- **用户报告**：① 修改期间只有第一次点击"变成大陆"、后续不变；② 现在绘制完全不能用，
  且点绘/绘制完成都触发**全图重载**；③ 定改造：先在工作区选定高度值（区间型元素配滑块，
  滑块区间=元素高度区间，拖滑块=选中该元素），笔刷只刷这一个值到 cell；单值型元素不需要滑块；
  未来区间型元素同样处理（数据驱动）。
- **"全图重载/绘制不能用"根因**：skipCold 渐现 + 真空闲预热 → 松手把 landsea 件标冷后**消失且
  活跃期永不回来**（无空闲可跑补热）✗✗ → 修：**skipCold 只限首启渐现**（`progressiveBoot` 门控，
  预热完成后同步重建，件不得消失）。
- **绘制语义 v2（改）**：
  - `heightDraw.ts` 重写为 `setHeightStroke`（左=写选定值，右=擦 0）；旧的整数档步进
    （落下赋 min/再点 +1/Shift±档）整体移除。
  - store：`heightPaintValue`（滑块值；未选过用区间 min 兜底）+ `setHeightPaint(id, v)`；
    撤销样本改为**每 cell 首次触碰即记录**（旧版只记首批 = 拖涂撤销不完整）。
  - **UI 联动（数据驱动）**：区间型元素（`region.attributes.kind === 'interval'`，自带 lo/hi/min）
    在工作区行下渲染滑块——拖滑块 = 选中该元素 + 涂改值 = 滑块数字；点行名也推送该元素滑块值
    （不拖滑块直接画不会用错值）。单值型元素无滑块；未来任何区间型元素自动获得滑块。
  - WorkspaceDrawer（右工作区）与 ElementList（Sheets 列表）两处同语义。
- **验证**：12 个区间滑块渲染（深海 -63~-55、远海 -54~-40…区间正确）；拖「远海」→ -45 状态
  "涂改值 -45（远海）" ✓；海值连涂 3 点全部生效（此前"只有第一次"）；**造陆**（海岸 2）
  两点均从海色变为陆色（拓扑翻转路径 ✓ 用户原场景）；运行时错误 **0**。
- **待办**：拓扑翻转的陆海重建仍 O(n)（松手一次 ~百 ms 级，非阻塞）——增量连通分量；
  撤销/重做一致性复验；ElementList/工作区行点选的推送路径已在代码层接好，界面微调可再验。

**本轮已处理（2026-09-27，第三十一次）— 生成提速 8-10×（凸包 O(n²) 清除）+ 预热让路**

- **用户点名**：重新生成太慢（100k ≈ 2 分钟）。
- **剖析**（Node 直测生成函数，/tmp 一次性脚本）：30k 总 16.3s，其中 **球面凸包（=Delaunay）16s（98%）**；
  级联 0.2s、序列化 0.06s 无辜。凸包 = 增量插入，旧实现**每点全量扫面 O(n²)**：
  30k ≈ 18 亿次平面测试；100k ≈ 200 亿 ≈ 2 分钟 ✓ 与用户实测吻合。
- **修复（quickhull 行进式可见域）**：
  - 边→面邻接 + **Morton 序插入**（相邻点相邻落位）+ **提示面爬山** + 可见域 BFS + 地平线；
    爬山失败时用「最近新建面 FIFO」重播种（分片函数会卡局部极大，不能只靠单提示面）；
    全量扫面仅作最后兜底。
  - **Morton 键教训**：JS 位运算 32 位溢出（`<<3b` 位移 ≥32 归零）→ 键完全乱序 → 爬山失配 → 每点退化
    全扫（首版越修越慢 16s→19s）。改 10 位×3 乘法 Morton（double 精度内精确）后立竿见影。
  - 提示面死亡时从其邻接找活面起步（旧实现退 0 号面——0 号面也死则行走秒断）。
  - 撒点网格键字符串 → 数字键（每尝试 27 次模板拼接是撒点 5s 主因）。
- **效果**：30k 凸包 16s → **1.76s（9×）**；100k 全链（计算+反序列化+陆海重建）**12.9s**，
  浏览器端（Worker+回传+解析）实测 **15.3s**（原 ~2 分钟，约 8×）✓。
- **预热让路**：预热/冷件补热的 requestIdleCallback 去掉 timeout 强派发（忙碌时抢主线程会在
  涂改中打出 50-70ms 尖峰）→ 真空闲才跑，元素渐现允许稍慢、交互永不被抢。
- **回归**：生成物渲染正常（703KB 画面）；涂改帧 0.2-0.5ms（剩余尖峰来自预热分片，已让路）；
  运行时错误 0。
- **剩余**：拓扑翻转的增量连通（不变）；撤销/重做一致性；生成的进一步提速（撒点 ~4s、
  级联 1.2s、反序列化 1.1s——都已非数量级问题）。

**本轮已处理（2026-09-27，第三十次）— 绘制模型重做：cell 色块高亮（拖动零重算）+ 首入渐现**

- **用户定模型（以此为准）**：「绘制应该是先将 cell 色块高亮，然后松手才做各种重算」+ 卡顿不可避免时
  「多线程 或 不影响交互只拖缓元素出现」。另列：绘制高度/其他图层都卡、绘后切层卡、首入特别卡、生成太慢。
- **绘制模型落地**：
  - 拖动中：store 只改数据（heights/归属）+ 回传命中 cell，**零区间/环/rev 重算**；Viewport 覆盖层画
    cell 色块高亮（只存 cell id，渲染时投影 → 跟随相机）✓ 实测拖动中仅 3 次地图渲染（旧模型 14+）。
  - 松手：一次重算（区间净差 + 件环补丁 + rev）→ **单帧 32ms**（旧 1-4s）✓ 高亮清除由真实件接替
    （ovl 残余金色 79px = 笔刷光标 ✓）。
  - 成员笔刷同模型；顺带补了 strokeAdd/strokeRm 记录（此前从未填 = 归属笔刷撤销记录缺失）与
    提交时的定向失效（守「全清/补丁」不变量）。
- **首入渐现**：buildPieceParams 支持 warmQueue——环未预热的件跳过入队，drawWorld 空闲逐件补热，
  就绪回调 onGeometryReady 触发重绘（元素渐现，不阻塞交互）。实测首入最差帧 **85ms**（原秒级）。
  预热触发改挂世界令牌（meta.seed+cells.length）——严禁挂 world 对象身份（每 tick {...world} 换新
  会让 $effect 每 tick 重跑，这是上一轮 4s 冻结的真凶，教训已记）。
- **运行时错误（见一例修一例）**：① 上轮 setPointerCapture 已修；② 本轮自己埋的 onStrokeEnd 未定义
  引用（写错文件）——发现即还原，色块清除标志改放 Viewport 自己的 pointerup ✓。
- **二期剩余**：① **生成提速**（用户点名：100k 生成 ~2 分钟，太慢）——生成管线（球面 Voronoi +
  各层区域构建）待剖析，可能走 Worker/算法优化；② 拓扑翻转笔刷的陆海重建增量连通；
  ③ 撤销/重做增量一致性验证。

**本轮已处理（2026-09-27，第二十九次）— 松手 4s 冻结根因：预热触发器挂在 world 身份上**

- **用户复现**：点一下松手后 ~4s 才见图像变化；期间笔刷不跟鼠标、整页卡死。
- **真凶**：切层预热的 `$effect(() => { void world.cells.length; ...; scheduleWarm(); })` ——
  **`{...world}` 每个笔刷 tick 都换新对象**，effect 依赖 world 身份 → 每 tick 重跑 → `scheduleWarm`
  被反复 clearTimeout/setTimeout(600) 推迟，**笔刷停手 600ms 后预热全量开工**，逐件重建
  （每件 50-500ms）连续吃满主线程 = 4s 冻结 ✓ 与用户描述逐字吻合（松手后卡、光标不动、整页死）。
- **修复三件**：
  1. 预热触发改挂「世界令牌」`world.meta.seed + world.cells.length`（仅载入/生成变化）；
     注释明令：严禁挂 world 对象身份。
  2. `touchHeight` 永不全清环缓存（forward 只定向失效 landsea 件；undo 只定向失效 height 件）——
     全清 = 下一帧重建全部可见件 = 秒级冻结，与「松手即响应」冲突。
  3. 三角化组缓存回填的 `parts.push(...大数组)` 改逐项（超大会炸栈）。
- **复现验证（点一下 + 15 动拖涂）**：松手到出帧 **0ms**（tick 渲染先于松手）；整段最差帧 **0.6ms**、
  松手后最差帧 **0.2ms**；38 动 38 渲染；运行时错误 **0**。此前 4s 冻结消失。
- **教训**：Svelte `$effect` 依赖读取的对象字段 = 依赖**对象身份**；对每 tick 重建的对象
  （`{...world}`）挂 effect = 每 tick 重跑。触发器要用**业务令牌**（seed/cellCount 等慢变量）。
- **二期剩余**（不变）：拓扑翻转笔刷的陆海重建 O(n)（增量连通分量）；撤销/重做增量一致性。

**本轮已处理（2026-09-27，第二十八次）— 二期开工：笔刷实时生效 + 切层顺滑 + 默认 100k**

- **用户四项**：① 手感达标确认（160fps/拖动几乎不掉/缩放 110）；② 切图层要顺滑；③ 运行时错误见一例修一例；
  ④ 开工二期；⑤（附带）默认参数改 100000，调试基准 100k。
- **默认密度 100000**：`core/world.DEFAULT_DENSITY`、store、TopBar、GenDock 五处一致 + AGENTS.md §6 同步。
- **二期核心落地（笔刷实时生效）**：
  - `core/ring/incremental.ts`：**BoundaryBook**——成员变化 Δ 只翻转 Δ 的关联边（O(|Δ|·deg)），
    环由 `edgeListToRings` 重链（O(边界)），**环恒等匹配**让未变环复用旧对象（下游 hermite/三角化缓存命中）。
  - `borderCache`：环缓存键去掉 O(n) 内容指纹（热路径反模式），改为 **setKey|projKey|geomRev**；
    不变量：`region.cells` 变化要么 `invalidateBorderCache`（全清）要么 `patchPieceEntry`（增量），二者互斥必居其一。
    `patchPieceEntry` = 增量补丁入口；`invalidatePieceEntries(prefix)` = 定向失效。
  - 笔刷链路：`paintHeight` 每 tick 调 `updateHeightIntervalElements`（区间归属增量）+ Δ 入队；
    Viewport 渲染前消费 Δ 打件环补丁（渲染层持投影器）。**每 tick 0.2-0.4ms，涂中即见**（涂前/涂中/涂后三帧验证）。
  - `updateHeightIntervalElements` 改为返回每区增减 + 基线语义（多次触碰用「上次基线→当前」净差）。
  - **commit 路径两修复**：① tick 已增量应用归属，commit 严禁二次套用（会重复入列）→ `flushHeightRegions(skipIntervals)`；
  ② `touchHeight` 全清环缓存 = 松手卡顿 → 非拓扑笔刷只定向失效 landsea 件（`invalidatePieceEntries`）。
    实测：松手 handler **0.7ms** ✓（spec ≤0.2ms 的"能做操作"达标）。
  - **三角化组缓存**：按「外环+其洞签名」缓存（tick 只重建受牵连组）。
- **切层顺滑（逐件空闲预热）**：`warmLayerGeometry` 按件分片（requestIdleCallback，timeout 100ms 兜底）预热
  环/样条/Path2D/三角化；实测冷启动切层 1.2-1.7s → 预热后 **0.4-2.4ms/层**（params 0.2-0.3ms、submit 0.2-2.1ms）。
  逐件分片是必须的：逐层预热本身会 1-2s 阻塞（首版教训）。
- **cellSetBoundaryEdges 伪边表**：第二循环原为 O(全部边) 解析 ek（60 万/件）→ `pseudoEdgeList` 一次构建
  （不在任何 neighbor 表里的边，极区补边等），每件只扫小表。
- **运行时错误（见一例修一例）**：`setPointerCapture/releasePointerCapture` 对已释放/合成指针抛
  NotFoundError 炸穿 handler ×2 → `capturePointer/releasePointer` 安全包装（捕获失败不影响拖动状态机）。
- **二期剩余（下轮）**：① 拓扑翻转笔刷（造陆/造海）的陆海重建仍 O(n)（`rebuildLandSeaRegions` 全量 flood +
  件重建 ~1s/次，只发生在松手）——**增量连通分量**是核心算法缺口；② 涂改时 landsea 件的实时更新（现延到松手）；
  ③ 撤销/重做的增量一致性验证。
- **验证口径**：100k 调试基准 ✓（用户重新生成 + 默认 100k）；涂改三帧（涂前/涂中/涂后）像素级验证实时性 ✓；
  运行时错误收集器 0 残留 ✓。

**本轮已处理（2026-09-27，第二十七次）— 阴影废弃 + 填充回归修复（奇偶漏绑着色器）**

- **用户两项**：① 阴影整体废弃（后续显示不考虑阴影，架构搭好后最后再做；所有优化按无阴影前提）；
  ② 我的优化引入填充回归：有些图层总不填、低倍不填、部分元素不填。
- **填充回归真因（显示契约级 bug）**：副本重叠件的 stencil 奇偶绘制**漏了 `useProgram(progFan)`**——
  绘制沿用上一件的描边着色器（属性布局不同）→ 画出垃圾几何 → stencil 奇偶全乱 → 填充整片消失。
  修复一行（奇偶绘制前绑定程序）；验证：强制全件走奇偶路径，画面与老路径/关奇偶三条路一致（1.14MB 级截图）。
  这是真 bug，与阴影无关；此前「整层不填/低倍不填」即宽件（件宽≥世界周期）走奇偶路径被击中。
- **阴影停用（单点）**：`buildPieceParams` 的 `shadowW/shadowAlpha` 归零（注释含临时性与恢复条件），
  两后端同时停用；GL 的场图集/Φ 剖面与 Canvas 的 clip+blur 代码保留但不触发（二期后恢复）。
- **无阴影口径验证**（同相机双后端截图比对）：缺填充候选 **0.003%**、big(>32) **0.31%**、avg 2.08、
  横线/竖线扫描 0 ✓。此前的比色差异（>10%）是阴影路径的场/图集缺陷 + 陈旧烘焙干扰，现已不在显示口径内。
- **一并修过的场路径缺陷**（阴影恢复时直接受益）：图集 UV 换算（屏幕→图集）、合成四边形的
  位置/UV 矩形分离、装箱死循环（8192 仍失败时 while 不退出——曾冻死渲染）、Vector2 匹配
  （three 的 removeDupEndPts 要 `.equals`）、三角化输入用 hermite 采样点（与 fan 同源）。
- **性能口径提醒**：本轮多次拖动测到「moves=2 / rAF=0 / timer 1Hz」是**页面失焦被 Chrome 节流**
  （`hasFocus=false`），非真实性能；有效数据仍是上一轮的 55-115fps 对比。用户机器复测为准。
- **测量工具保留**：`window.__glSeg`（params/submit 分段）、`__drawSamples/__drawCount`（帧成本）、
  `__restSeg`（2D 余层）；`__glForce*`/`__fillDiag` 等临时探针已删。
- **待办**：① 用户复测填充/拖动手感（无阴影口径）；② 阴影恢复时用场图集路径（勿回包围盒合成）；
  ③ cell 网格 100k 全量光栅的视口裁剪（canvas 侧有 cellsInView，GL 侧待做）；④ 二期（实时生效）。

**本轮已处理（2026-09-27，第二十六次）— 拖动跟手：热路径 O(n) 指纹清除 + 状态栏后端标识**

- **用户反馈**：GPU 缩放已与 2D 持平，但**中键平移/右键内容拖动仍 2D 更流畅（GPU 不跟手、掉帧）**；状态栏要显示当前后端。要求从整体设计层面考虑。
- **分段计时定位**（常驻 `window.__glSeg/__restSeg`：params=内容构建 / submit=GL 提交 / rest=2D 余层）：三层+阴影+100k 下每帧 3.3ms 里 **params 占 2.5ms（75-80%）**，GL 提交仅 0.2-0.3ms——**不是 GPU 慢，是每帧在 CPU 侧重建内容**。
- **根因（正是 AGENTS.md §8/9 的"热路径 O(n) 指纹扫描"）**：`borderCache.ringCacheKey` 每帧对每个件的**全部 cellIds 做 O(n) FNV 指纹**（10 万 id/帧 = 2.5ms）；而件集数组跨帧引用稳定（`composeShownPieces` 已 rev 缓存）。修复 = **cellIds 指纹按「数组引用 + dataRev」WeakMap 记忆**（一次 O(n)/rev；长度校验兜底；前提与 composePieces 缓存相同：cellIds 内容变化必伴随 dataRev）。另把 `styleOf` 按层每帧解析一次（原按件×帧做对象合并）。
- **效果**（同场景同手势）：params 2.5→**0.2ms**、帧总中位 3.3→**0.8-1.0ms**、尖峰 18.8→**2.3-2.8ms**。对照 Canvas：中位 0.2-0.4ms 但**平移尖峰 13-15ms**（烘焙/GC），GPU 反而更稳（max 2.8 vs 15.4）。用户"拖动不跟手/掉帧"的直接原因 = 旧 GPU 的 3.3ms CPU/帧 + 18ms 尖峰阻塞输入。
- **状态栏**：显示当前渲染后端（`GPU` 高亮 / `Canvas2D`），App → StatusBar 传 `editor.renderBackend`。
- **回归**：比色 big(>32) 0.01%（远离边界 >32 为 0）、横线/竖线扫描 0——rev 记忆无陈旧。
- **遗留观察项**（ROADMAP）：副本出窗裁剪/扇形光栅面积目前不是瓶颈（submit 0.2ms），件数若增 10× 再做；二期（笔刷实时生效）不变。
- **测量口径**：本环境一次性 rAF 会饿死（合成器不出帧），所有帧计时在 `window.requestAnimationFrame = setTimeout(0)` 垫片下测得；用户真机无此问题。

**本轮已处理（2026-09-27，第二十五次）— 一期：GL 直绘架构（烘焙链退役）+ 100k 上限 bug + 二期方案（实时生效）**

- **回答用户「为什么感受不到 GPU 性能」**：旧 GPU 链是**烘焙架构**——每帧把世界光栅进离屏贴图再 drawImage 回 2D，缩放每 tick 全量重烘+合成回读，GPU 只当了 Canvas 的贴图打印机；而 Canvas2D 本身已被浏览器 GPU 化（Skia/Metal），所以烘焙链结构上**只能 ≤ Canvas**，"打平"就是它的天花板。真正吃到 GPU 必须**相机 uniform 逐帧直绘**（几何缓存、缩放只改 uniform、零重烘/零回读）。
- **100k 生成 bug**：`store.generate` 隐藏 `Math.min(count, 50000)` 与 UI（软上限 100k 确认解锁 / 输入上限 200k）矛盾 → 收敛为 `core/world.HARD_MAX_DENSITY=200000` **唯一钳制点**（生成链），`SOFT_MAX_DENSITY=100000` 只是 UI 解锁策略。已验证 100000 地块生成成功。
- **一期落地（GL 直绘）**：
  - `render/gl/geometry.ts`：环几何缓存（fan=evenodd 奇偶 / strip=条带宽度 uniform / fade=内阴影条带）；闭合语义只取 hermite 的 closePath 条件（virtualFrom 开环不强闭）。
  - `render/gl/mapRenderer.ts`：`MapGlRenderer` 三通道直绘（bg 清海色 / cellsMesh 共享边去重条带 / elements）。evenodd=stencil INVERT 奇偶（含副本重叠不叠色）；副本=顶点着色器 aDx 实例属性；内阴影=**Φ 剖面渐隐条带** α(u)=Φ(2−2|u|)−Φ(−2−2|u|)，与 Canvas「clip(fill)+blur(2w)」沿直线段数学等价（σ=w/2 矩形描边高斯剖面），外侧由填充 stencil 裁掉→不需要内外/洞方向判定；外框=gl.scissor；缓冲定额清扫（600 帧未用 deleteBuffer）。
  - **样式链一处实现**：`layers.buildPieceParams`（宽度/颜色/选中放大 1.6/1.15/阴影 +0.12）同时喂 Canvas `paintPieceParams` 与 GL；禁止两后端各推一遍。
  - **三画布**：`canvas.gl`（底，bg/cellsMesh/elements）→ `canvas`（中，paths/decorations/frame 透明底+输入）→ `canvas.ovl`（顶）。`drawWorld` 的 `glScene` 通道：GL 成功则 2D 不铺海色、不走静态烘焙；失败（shader/上下文/非纯色样式）**整帧回退 Canvas2D（显示不降级）**。
  - **死代码已删**：`render/gpuFill.ts`、`render/gpu/*`（gpuElements/regionMesh）、`gpu-bench/`、`gpu-fill-bench/`、两个 bench html——烘焙链的 GPU 填充通道整个退役。
  - `RENDER_LOGIC.md` 增「渲染后端（同一契约，两个光栅化器）」节。
- **二期方案（下一阶段，核心=绘制实时生效，不是异步化）**：笔刷按住拖动时，cell 高度变化必须**同帧/下一帧**出现在地图上，松开鼠标**立即**可拖动/缩放：
  1. **同步增量环**：笔刷只改 N 个 cell → 受影响 DisplayPiece 的 cellSet 环增量重算（边界链只在变化 cell 的邻域重接，不全量 `cellSetBoundaryRings`）；环几何（fan/strip/fade）随之只重建受影响环。
  2. **就地重绘**：直绘架构下无需重烘——下一帧 `buildPieceParams` 直接吃到新环；GL 缓冲对新环 upload，旧环由定额清扫回收。
  3. **松手即响应**：mouseup 不做任何全量提交（归属/拓扑已在拖动中增量维护），只落盘（IndexedDB 异步）；若有必须全量的收尾（如大陆重算）放 idle，不阻塞输入。
  4. 关键算法债：`commitStroke` 的 Region 归属增量维护 + 增量环算法（`core/ring/build` 包一层"变化 cell 邻域重接"）是二期主体；先出最小几何案例再动。
- **验证方法**（自动化环境坑）：rAF 被节流（3s 0 回调）→ 帧计时须 rAF+setTimeout 垫片；层显隐=**双击主按钮**（👁 只开样式面板）；浏览器验证前先看 `__gpuErr` 空 + `__gpuRan>0`（否则是静默回退 Canvas）。
- **一期验证结果 + 一次真 bug 修复（阴影并集）**：
  - **发现并修复**：渐隐条带最初直接 over 合成，多环邻近时**叠加求和**（阴影宽 18.5px 时条带 ±46px 几乎处处重叠 → 阴影强度叠到数倍；剖面峰值两边吻合 205/203，问题只在"求和 vs 并集"）。修复 = **渐隐场先 GL_MAX 归并进 RT，再一次 over 合成**（= Canvas「描边并集再模糊」语义）。修后决定性比对 big(>32) **12.79% → 0.06%**、纯填充 >8 从 6.5% → 1.11%（= 历史接受的阴影带口径）。
  - **比对口径教训**：Canvas 静态烘焙在「件集变化但 layoutSig 不变」时可能做**陈旧增量**（`layoutSig` 不含 `pieceSignature`，脏矩形外沿用旧贴图）——比对前必须用「样式真值变更」强制 key 变化全量重烘，否则测的是陈旧贴图（曾误判"Canvas 无阴影/填充偏移"）。GL 直绘无贴图态，天然免疫（spec 3 优势）。
  - **逐场景比对**（截图 + Python 网格采样，UI 区排除）：默认视图 big(>32) 0.00%；zoom22 高倍 0.00%（横线/竖线扫描 0）；跨界+内容偏移 0.00%（列突变扫描 0）；纯海区网格 maxDiff 10、>8 仅 0.02%（网格 AA 剖面形态略软，数值级差异）；拖动中帧 vs 松手帧（同相机）big(>8) 0.00% = **无残影**；极区/大阴影场景残差全部落在阴影渐变带/AA 边（内部 maxDiff≤37，>32 归零）。
  - **性能**（rAF 垫片还原"帧即刻服务"）：用户场景连续缩放 85 tick/1.2s 全部跟上，**116.7 fps 持续**，帧成本中位 3.0ms / p90 4.2ms / max 7.1ms（GPU 提交 0.7-6ms）。对照 Canvas：拖动期 0.3ms/帧（贴图延后）但夹 77ms 烘焙尖峰 + 手势后 255-270ms 补烘（内容滞后）。100k 生成 ✓（100000 地块）。
  - 常驻计时器：`window.__drawSamples/__drawCount`（drawWorld 咽喉点，两后端可比）。
- **待办**：① 用户实测一期缩放手感 + 目视验收（阴影观感、网格、极区）；② 确认后默认切 GPU；③ 二期实施（实时生效）。

**本轮已处理（2026-09-27，第二十四次）— GPU 缩放性能追平 Canvas（用户实测 20fps→修复）**

- **用户实测**：Canvas 无阴影 110fps / 带阴影 30-80fps；GPU 无阴影 20fps / 带阴影个位数 → "走错路还是没做好？"。**结论：路没走错，是三个执行层浪费 + 一次测量教训**。
- **诊断教训**：此前我的"受控 A/B"用低频 wheel（120ms 间隔）+ rAF 垫片，测到的多是缓存命中帧——**没复现用户的高速连续缩放**。本轮起 `staticLayerCache` 常驻 `window.__bakeMs`（烘焙耗时）、gpuElements 常驻 `__gpuMs/__gpuBlurMs`，用 40ms 间隔来回缩放 burst 测真实重烘路径。渲染器确认为 Apple M4 Metal（非软渲染）。
- **根因三连（ bake 内 GPU 侧浪费）**：
  1. **每件全画布 stencil 清零**：12 件 × 15M px × 4×MSAA ≈ 每 bake 7 亿次 sample 清写 → 改为**件盒 scissor 清零**（画前清，读写都在件盒内，正确性不变）；
  2. **逐帧 realloc 尖峰**：period 模式贴图宽随 TEX_SCALE 每 tick 涨数百 px → 256px 分桶每 tick 跨桶 → MSAA 画布 + 2 RT 重建 = 500-1400ms 尖峰 → 改**1024px 只增不缩**（缩到一半以下才收缩）；
  3. **阴影全屏 blur**：旧版无 scissor 时逐件两次全屏 9 抽头；新版已在条带盒内，再按 σ 自适应降清（σ≥10px→1/4、≥5px→1/2，低清渲条带+blur、全清 stencil 裁剪+线性上采样；σ/k≥2.5 保证 spacing≥1）→ 对齐 Skia 金字塔 blur 成本。
  另加**副本出窗裁剪**（±period 平移后与窗口不相交的副本扇形/条带整体不画）与**初始清屏 scissor 到联合盒**。
- **结果**（40ms 间隔来回缩放 burst，M4）：gpuElements.render 中位 10.9→**5.8ms**、p90 47→**11.4ms**、max 590→**15.4ms**；bake 尖峰 1417→**207ms**。同起点受控 A/B（阴影 24px）：**GPU bake 中位 33.9ms ≈ Canvas 33ms**，尖峰 GPU（1138ms）还优于 Canvas（1339ms）——剩余尖峰为两侧共享的 Canvas 侧烘焙成本。
- **视觉回归**：横线扫描（默认/缩放平移）0；平坦区比色 maxDiff≤1；大阴影（k=4 低清链）全画布网格比对 >8/255 差异 **1.11%**（均分 1.39/255，集中在阴影渐变带，优于旧版全清链的已接受口径）。
- **中途坑**：HMR 会命中中间版本模块（`it.copyMinX is not a function`）→ 浏览器验证前必须确认 `__gpuErr` 为空；GPU render 失败会**静默回退 Canvas**（`__gpuRan=0` 即没在跑 GPU）。
- **下一步**：① 用户复测两后端缩放手感 → 确认后默认切 GPU；② 100k 压测；③ 剩余尖峰在 Canvas 侧烘焙（makeSurface 每 tick 新建大画布），若仍感知卡顿再开增量优化。

**上一轮已处理（2026-09-26，第二十三次）— GPU 横线/缩放卡顿：闭合语义 + 预乘 + 热路径重设计**

- **用户报告两问题**：① 高度图约 -36° 纬度一条横线（GPU 独有）；② GPU 缩放比 Canvas 更卡（"切换 GPU 但很多东西没好好设计"）。
- **横线根因（第 5 层渲染临时几何）**：`gpuElements` 的条带拼接强制 `closed=true`，而 `hermite.appendMidRing` 的 closePath 条件是 `closed && (mode==='fill' || virtualFrom===undefined)`——outline 模式遇 `virtualFrom`（跨界尾巴）是**开环**，强制闭合把首尾连成横跨地图的直线段，描边色 = `darkenHex(region.color, 0.7)`（实测线色 rgb(58,111,142) = 0.7×海域蓝，吻合）。**修复 = 闭合语义单源**：条带闭合只取 hermite 的 closePath 条件，禁止在拼接处另立规则。高度图的海域条带恰好在 -36° 附近有跨界环 → 只有高度图看得到。
- **平坦区色差根因**：GL 混合（SRC_ALPHA）写入的缓冲 rgb **已预乘 α**，但上下文声明 `premultipliedAlpha:false`（直通）→ drawImage 再乘一次 α → 半透明填充整体偏暗（实测深海 [11,28,51] vs Canvas [13,31,61]，二次乘 α 模型精确吻合）。修复 = `premultipliedAlpha:true`。修后 GPU vs Canvas 采样差 ≤1/255（舍入级）。
- **缩放卡热路径重设计**（缩放 = 每 tick 全量重烘焙，GPU 必须 ≤ Canvas）：
  1. **几何缓存**：Hermite 折线/三角扇/条带按环对象 WeakMap 缓存（键同 `ringPath2D`）；条带改"基点+方向"布局、**宽度走 `uHalfW` uniform** → 缩放零重建零重采样；
  2. **VBO 缓存**：按数据数组 WeakMap 持有缓冲，跨帧零重传；矩形罩色走共享动态 VBO；
  3. **RT/画布 256px 分桶增长**：缩放 tick 不逐帧重建 MSAA 绘图缓冲与离屏 RT（活动区锚定缓冲左下，全屏 pass vUv 按 `uVP` 收窄、drawImage 源 y 补 `allocH-devH`）；
  4. **阴影 scissor**：清屏/条带/两级 blur/合成全部裁到「条带盒+2×blurReach」，合成重新挂填充 stencil（内阴影不溢出元素外缘）；
  5. **合成子矩形**：drawImage 只贴画过内容的联合包围盒（9 参 1:1；5 参会把整图缩进子矩形）；烘焙窗口外的件整体跳过；参考点收近到环包围盒外侧（扇形光栅面积 ∝ 元素）。
- **验证**（固定 1280×720 + 相对坐标采样 + `__gpuRan` 确认 GPU 在跑）：横线扫描（满宽异常行）初始/平移缩放/回退/高倍 16 tick/跨界平移**全部 0**；平坦区比色 GPU vs Canvas **maxDiff ≤1**；受控缩放 A/B（同起点 12 tick）GPU 中位 1.0ms/p90 2.6ms vs Canvas 0.9/1.7（同量级，首帧冷启动 GPU 略高）。
- **注意**：自动化环境 rAF 被掐死（3s 0 回调）→ 帧时测量须用 setTimeout 垫片包 rAF 回调测同步耗时；图层显隐开关是**双击主按钮**（👁 只开样式面板）。
- **下一步**：① 用户目视验收（横线消失、缩放跟手）→ 确认后默认切 GPU；② 100k 压测；③ 视需要烘焙期 GL 直渲纹理。

**上一轮已处理（2026-09-26，第二十二次）— GPU 显示错乱修复（`fb13239`）**

- **用户实测 GPU 后端错乱（斜线/斜色块/光斑）**。根因三连：① 扇形 `drawArrays` 的 count 传了"点数"（应 3×）→ 只画 1/3 扇形 → stencil 奇偶错乱 = 斜线斜色块；② blur pass 未关混合 → 光斑；③ Viewport effect 依赖缺 `renderBackend` → 切换后端不触发重烘。另修：填充罩色 quad 曾带副本偏移。
- **验证方法教训（重要，防再犯）**：
  1. 动态 `import('/src/app/store.svelte')` 在 Vite HMR 后与应用实际模块**不是同一实例**（`?t=` 版本化 URL）——通过它调 store 是"幻影操作"，此前 A/B 的"0 差异"其实是两个 Canvas 的对比；
  2. 两次渲染的画布分辨率会翻转（1280/2560），采样必须按**相对坐标**或固定 `setViewportSize`；
  3. 可信验证锚点 = **应用代码内的计数器**（`window.__gpuRan`）+ localStorage 切后端 + 重载。
- **最终验证**（固定视口 1280×720，GPU 计数确认激活）：结构性大差异 0.2%（曲线边缘 AA），小差异 58% 集中于阴影渐变/描边羽化带（= 用户已接受的纹理 blur 近似）；Canvas 对照组噪声底 0。
- `npm run build` 通过；147/147 测试通过。**待用户目视验收 GPU 渲染**（斜线/色块/光斑应消失）。

**上一轮已处理（2026-09-26，第二十一次）— GPU 后端第一版（`a7d184b`）**

- **WebGL2 RegionMesh 元素渲染器落地**（`render/gpu/gpuElements.ts`）：填充=Hermite 环三角扇+stencil 奇偶（= evenodd 含副本）、内阴影=描边纹理 blur（可分离高斯，σ 自适应抽样）按填充 stencil 合成、描边=细长四边形（端头外延）。平滑曲线仍由 `core/ring/hermite` 唯一采样（smooth 同源）。
- **elementsLayer**：GPU 优先 + 逐件 Canvas2D 回退闭包（显示不降级）；宽度/alpha 口径与 `drawPreparedElement` 一致。
- **显示样式面板新增「渲染后端（全局）」切换**（Canvas2D / GPU 实验，localStorage 持久化，切换即重烘焙）。
- **验证**：高度图层 ×1/×6 两档 Canvas↔GPU 逐像素对照 14400 采样点，>8/255 差异 **0 个**。
- `npm run build/check` 通过；147/147 测试通过。
- **下一步**：① 用户验收 GPU 显示 → 确认后默认切 GPU；② 100k 压测（目标达成路径）；③ 视需要做烘焙期 GPU 直渲纹理（省 drawImage）。

**上一轮已处理（2026-09-26，第二十次）— 副本带深海消失修复（`0acf58e`）**

- **用户实测："副本里面的深海还是消失"**（定位极准）。根因与上次裁剪框同族：h0（深海）的**整框底色填充**矩形钉在绝对 ±π，而 `clipDxBias` 已把裁剪口径移到「可见带」`[fr − clipDxBias]`——右键平移后可见带滑出 ±π（= 副本区域），填充够不着 → 副本带丢深海底色、其上叠色全变调（"又变色了"）。**与上次同一类：凡钉在绝对 ±π 的绘制，都必须随裁剪口径平移。**
- 修复：整框填充与 `clipToMapFrame` 同口径（bias 同步）。`frameLayer` 框线/遮罩钉 ±π 是设计本义（外框固定），不动。
- **验证**（像素锚定，副本带深海锚点）：右拖半屏使可见带进入副本区 → 取最暗海洋像素 [13,31,61] → 放大至 ×17.45（视口模式深处）同点颜色不变。
- `npm run build` 通过；147/147 测试通过。
- **下一步：GPU**（用户指示"完全修好之后开始"——本轮修复验证通过即开工；RegionMesh 数据层已就位）。

**上一轮已处理（2026-09-26，第十九次）— 深海/远海变色修复 + 错误处理改造（`e454863`）**

- **用户实测：>2.4× 后深海/远海变色**（用户点破方向："是不是跳过不可见元素的判定有问题"——是）。根因：h0（深海）是**无环整框底色片**，ringBBox 退化为原点——跳过判定只在窗口含原点时放行；×2.4 = 视口模式阈值（平铺窗口恒含原点、视口窗口随视点走）→ 深海底色被跳过、其上全部半透明叠色变调。
- 修复：无环片永不跳过；有环片副本相交改**精确周期解**（k 区间求交，替代 ±2 猜测）。
- **错误处理**（用户拍板）：运行期错误 → 状态提示 + 继续运行（main.ts）；挂载失败仍整屏报错。
- **验证**（用户指路：用高度图）：像素锚定跨缩放色彩不变——右拖半屏后海洋锚点 [66,128,167]，放大至窗口不含原点（bug 条件）颜色不变。
- **重要教训（测试环境）**：自动化探针与**用户手动测试共用同一浏览器标签/世界**——测量会被用户操作干扰（曾误读为回归）；验证要 CSS 坐标全程折算 + 选安静时段。本轮曾误判"测试侵蚀了世界"（右键拖=平移不画图，不成立）。
- `npm run build` 通过；147/147 测试通过。**下一步：GPU**（用户指示"完全修好之后开始"——等用户确认本轮修复后动工）。

**上一轮已处理（2026-09-26，第十八次）— 放大元素消失修复（`93cebac`）**

- **用户实测：放大后部分元素消失（高度档位/其他图层）**。根因：增量烘焙的元素包围盒跳过只比较未平移包围盒——元素经 k±1 世界副本平移后落入窗口（跨缝/平移后）会被误判不可见而跳过。修复：跳过判定按 k∈[-2,2] 周期移位比较。
- **验证方法教训**（写给后续会话，勿再踩）：
  1. 新生成世界的语义层**默认隐藏**（产品默认，焦点=地块只显网格）——"看不到陆地"先查图层可见性，不是渲染 bug；
  2. 右键拖动走平移分支、**不触发画笔**（曾误判测试侵蚀了世界，不成立）；
  3. 合成指针的 `setPointerCapture` 抛错会经 `window.onerror` → `showFatal` **整屏报错**——自动化测试前先打 `setPointerCapture` 空补丁；该容错本身值得改进（输入路径错误不该杀死应用，待拍板）；
  4. 像素探针要与画布同步坐标系（dpr/backing 变化后注意）；验证用**像素锚定**（同点前后对比）而非仅比率。
- **验证结果**：×4 平铺档与 ×11.7 视口档，整周期平移前后中心像素一致、陆地占比一致（0.571≈0.568）；深放大元素完整。
- `npm run build` 通过；147/147 测试通过（**perf 用例须在 web/ 目录跑**：仓库根无 vitest 配置会用 5s 默认超时误报）。

**上一轮已处理（2026-09-26，第十七次）— 世界副本消失修复（`a19e466`）**

- **用户实测：2.4× 以上左右平移时"为循环地图增加的旁边副本"消失**。2.4× = period 贴图预算（16M 像素）耗尽、切 viewport 模式的阈值。副本机制两模式不同：period 靠贴图平铺隐式重复（一直正常）；viewport 需显式画副本，但烘焙裁剪框是绝对 ±π，把副本平移后的像素全部裁掉。
- 修复：**裁剪补偿按模式取值**（`clipDxBias = viewport ? contentOffsetX : 0`）——period 补偿有害（裁掉贴图，上一轮误加后回退的就是这个）、viewport 补偿必需（放行副本）。两个裁剪口径不同是本 bug 与上轮误判的根源，改裁剪/贴图类代码前务必分清模式。
- **循环不变量验证**（用户判据）：×2.59 平移整世界周期，陆地占比前后一致（0.185 = 0.185）；副本缺失时应掉到 ~0。
- `npm run build` 通过；147/147 测试通过。

**上一轮已处理（2026-09-26，第十六次）— 半显/漂移真根因 + 点击卡顿 + 缩放级别（`b271f19`）**

- **半显/放大漂移（用户实测"还是只显示一半/上下不贴"）**：真根因 = **dpr 变化不触发 ResizeObserver** → backing store 过期 → 渲染坐标系（canvas.width/dpr）与输入坐标系（rect.width）错位 → 内容半显 + 缩放定锚漂移（锚点像素逐格走色带）。修复：`syncBackingStore`（渲染前对齐）+ matchMedia dpr 监听。浏览器像素追踪验证：12 格放大锚点恒定。
- **注意**：期间曾误判"裁剪框口径"并加 `clipDxBias`（已回退）——周期贴图只裁 pad 毛边，图框由 frameLayer 遮罩执行；做裁剪/贴图类修改前先分清这两个职责。
- **点击卡顿**：移动 ~1ms（首帧 139ms 惰性索引）；主体 = 提交后重烘焙。增量烘焙改单次合并裁剪 + 元素包围盒跳过 + 增量跳过 bg（其 clearRect 抹拷贝）→ 陆地点连点阻塞 <25ms。**残留**：拓扑翻转（造陆/造海）仍一次全量烘焙（~0.8s@30k）——GPU 后端解决。
- 状态栏新增缩放级别（×倍率）。
- `npm run build` 通过；147/147 测试通过。GPU：RegionMesh 数据层已落（`accc837`），下一步 WebGL2 三 pass + 显示 panel 后端切换。

**上一轮已处理（2026-09-26，第十五次）— 半显/卡顿根因修复 + GPU 开工**

- **增量烘焙半显/错位修复（`193347c`，浏览器复现定位）**：① 脏矩形逻辑无底图也只画脏区——"脏标记残留+缩放换键"同帧 → 空白底+脏矩形的残缺贴图被缓存（"只显示了一半"）；② 增量拷贝换锚重画 → 整张贴图错位（"上下不贴视口"）；③ 脏矩形映射只对 period 窗口成立。修复：增量必须有同布局底图（无则全量）、沿用底图取景锚点、脏矩形按实际覆盖窗口映射。
- **渲染看门狗**：requestRender/requestOverlay 加 250ms 兜底——rAF 被丢弃时 dirty 闸永久卡死（渲染停摆至重挂载；浏览器复现稳定触发）。同时是环缓存内容寻址（点击提交不再全量重链 12 个嵌套区间边界环——"点击卡 2 秒"根因）。
- **GPU 开工**：`render/gpu/regionMesh.ts` 数据层落地（纯函数：cell 扇形三角化/边界细长四边形/合并）。平滑=边中点 Hermite 同源采样（回答用户：平滑保留）。下一步：WebGL2 上下文 + fill/border/shadow(纹理 blur) 三 pass + Canvas2D 回退 + **显示 panel 后端切换选项**（用户要求第一版带切换）。
- 浏览器复现验证：右拖半屏+放大 ×15 → 全画布不透明、陆地铺满、无半显。
- `npm run build` 通过；svelte-check 0 errors；147/147 测试通过。

**上一轮已处理（2026-09-26，第十四次）— viewport 半显/残影修复 + 卡顿包 2/3/4**

- **viewport 半显/残影修复（`320337d`，用户实测）**：三根因——drawWorld 从不清屏（贴图露边即残影）；viewport 烘焙 `worldDxs:[0]` 单副本（窗口跨周期缝缺半边）；分桶键弧度/像素单位混用（恒 0，分桶失效是死代码，滑出余量永不重烘）。修复：每帧清屏+海色底；副本走 worldCopyDxs 按窗口选 k；分桶改屏幕像素单位（桶宽=2×余量）。
- **卡顿包 2/3/4 全部落地**（详见「最近在处理的问题 0」）：增量烘焙（同布局旧贴图作底+脏矩形）、路径 poly 缓存、装饰视口裁剪、标签记忆化、hover 只刷 overlay。
- `npm run build` 通过；147/147 测试通过。
- **GPU 讨论待继续**：用户明确长期想走 GPU——下一步出 RegionMesh/WebGL 设计。

**上一轮已处理（2026-09-26，第十三次）— 显示修复 ×2 + 卡顿包 1 + 100k 可行性**

- **显示修复（`13d0bc2`，用户实测报的两个 bug）**：
  - 标签随右键平移不动 → decorations 的标签/cellMarker 文本手算屏幕坐标漏了内容偏移（违反 MapTransform 唯一换算点契约）；已统一走 MapTransform。
  - 放大过阈值后元素闪回到标签位置 → 静态贴图 viewport 模式定位漏 contentOffsetX 且取景窗口没按"可见内容窗口"（cam.x−内容偏移）；已统一 viewCenterX 口径，period/viewport 两模式一致。
  - 地块全显 cell id → builtinLayers 的 `cellMarker:'id'` 调试遗留默认值；改 'none' + ensureBuiltinLayers 同步修复旧档。
- **卡顿包 1（`91135dc`）**：失效域拆分落地——geomRev 分域、pairEdgeCache 只订几何域、ensureRev 去 world 引用判断、环缓存键补内容指纹（setKey 可选）、端点拖动 move 阶段不再 touchWorld（projCache 591ms 级重建消除）。
- **100k 可行性结论**（详见「最近在处理的问题 0」）：平移/绘制/选中/悬停/编辑 CPU 侧包 1-4 可达标；**缩放动画达标依赖 GPU 后端**（RegionMesh/WebGL）；"手势期瞬态"方案按用户"不打折"约束**作废**。
- `npm run build` 通过；147/147 测试通过。

**上一轮已处理（2026-09-26，第十二次）— 测试修复整包 + 卡顿全盘分析设计**

- **测试修复包（`b0bbafa`）：147/147 全绿**（此前 7 红含 2 文件收集失败）。修根因不改规则：
  - 真 bug ×3：① `landSea` claimId/pickOld **双重占位**（preferred 分支不可达 → 每次重建 ID 漂移，选中/名字样式丢失）→ claimId 唯一占位点；② `heightToMeters` 浮点高度时代映射（整数模型下珠峰=38 万米、赤道均温 -619°C）→ 整数域映射（陆 0..8848 / 海 0..-11000）；③ `unified generateFromLayer` 分组失败吞源省 → 孤儿省，收尾挂接（共享邻接边最多的新元素，覆盖旧档残留 parentId）。
  - 陈旧测试迁移：height/hierarchy 的 layer filter `'height'→'landsea'`；networks/validate/perf 旧生成器 → `unifiedGenerate`（生产路径）；sphereVoronoi 极点规则 → 「极点归属最近站点的普通 cell」；prepareDisplayRings/projections 的孤儿导入（ownerPolygon/polarPoly）→ ring/* + projCache/polarCellIds 现行契约。
  - **culture.ts 退役**（第七轮条件「等用户要求改测试时删」达成，零引用删除）。
  - spike 断言从旧平铺多边形 0.75π 密度约定迁到结构不变量（相邻点 |Δx|≤π=unwrap 保证；近极大跨角是球面真实几何）——**规则适配已记入提交信息，供复核**。
- **卡顿全盘分析 + 设计 + 四包规划**：根因三条链（失效域/烘焙粒度/实时层）逐文件核实完毕，方案写在下方「最近在处理的问题 0」，**未动实施代码，等用户审方案**。

**上一轮已处理（2026-09-26，第十一次）— 技术债务整批清理（5 个整包）**

- **git 仓库建立**：基线提交（214 文件）+ `.gitignore`（node_modules/dist/dev.log/target/.DS_Store）；后续每包独立提交（共 7 个 commit）。
- **文档修正**：`RENDER_LOGIC.md` 模块表补 `path2d.ts`、删已不存在的 `ownerPolygon.ts` 行（`defaultExclusiveColor` 现居 `layer/style.ts`）；`DESIGN_ENTITIES.md` 配套引用改指现行契约（旧 REQUIREMENTS/DESIGN_SPEC 已归档）。
- **死代码清理**：`ui/chrome/` 并入 `ui/shell/`（GenDock/ProjectPanel/ViewDock/ValidatorPanel 迁移，引用改相对路径；无引用的 BrushHud/LayerList/StatusStrip 删除）；删 `FloatingPanel.svelte`+`panelStore.ts`（旧悬浮面板壳，零引用）、脚手架残留（`lib/Counter`、`assets/*`）、**`wasm-core/` 空壳**（16 行，与「明确不做 WASM」一致）、`web/scripts/` 19 个历轮 diag/patch 一次性脚本、`dev.log`、`dist/`。
- **`world.continents` 第二真相删除**（架构债）：大陆分组唯一真相 = landsea 层 continent `Region.cells`。删 `World.continents` 字段与序列化往返、死算法 `computeContinents`（与 `cellGraph.landContinentsCSR` 重复且零调用）；新增派生访问器 `landSea.continentCellGroups(world)`（顺序与 `cell.continentId` 一致）；`cell.continentId` 保留为笔刷多数票缓存（assignContinents 生成期 / rebuild 改归属后同步）；`borderCache` 大陆中心的 kind 判定统一走 `landSeaKindOf`。测试引用迁移：`w.continents` → `landContinentsCSR` / `continentCellGroups`（断言语义不变；`displayCompose.test` 移除已删 API `effectiveRegionCells` 的残留断言，同规则已由 `materializeParentCells` 的 `A.cells` 断言覆盖）。**旧档 JSON 的 `continents` 字段读取时忽略，无需迁移。**
- **一处实现：高度 12 档单源化**（架构债）：heightRegions 的 HEIGHT_BINS/LEVEL_NAMES/色表与 `layer/heightIntervals` 逐值重复、`heightToLevel ≡ heightToIntervalIndex` 重复算法——现全部从 `HEIGHT_INTERVALS` 派生（heightRegions 176→71 行，显示语义不变）。**连续渐变时代死配置链整链删除**：`heightFillMode`/`LayerExtraParams`/`defaultExtraParams`/`resolveLayerParams`/`LayerConfig.extra`/`World.layerRenderParams`/store 的 `layerExtraParams`/`setLayerExtraParams`（零读者、不进序列化、UI 无入口）。双份兼容别名收敛：`rebuildHeightRegions`/`heightKindOf` 只留 heightRegions 一份（tests 在用），store 改用真名 `rebuildLandSeaRegions`；死导出清除（heightRampColor/heightRampGradient/HEIGHT_COLOR_STOPS/heightColor/LAND_BASE_COLOR/levelTo* 等）。
- **layer.ts barrel**（架构债）：`GenConfig` 形状移入 `layer/genTypes.ts`（与枚举单源）；layer.ts 只留各层默认值；不留 re-export 门面。
- **TS 存量错误清零**（架构债）：svelte-check **23 → 0 errors**（4 条 svelte runes 提示保留）、tsc 1 → 0。其中**两个是被类型暴露的真 bug**：① `map2d.drawWorld` opts 缺 `gpuFill` 字段 → GPU 离屏填充通道从未激活（env 恒 undefined），补全转发后按设计工作（Canvas2D evenodd 兜底不变）；② `catmullRomPolyline` 丢 z → GlobeView 球面路径 hypot(NaN) **实际不可见**，现按同一公式插值 z（2D 输出形状不变，paths.test 的 toEqual 不受影响）。另修复：WorkspaceDrawer/ProjectPanel 解构漏声明回调（外交按钮附庸/敌/盟、高程图导入**此前断线**）；WorkbenchHost 重复 `onApplyPreset` ×2；`num()` 接受 input 的 string 值；App 对 TopBar 不存在的 `settingsOpen` 绑定 + `shell.settingsOpen` 死状态删除；Sheets `onGenerate` 补 `Number()` 解析；**孤儿组件 `SettingsDrawer.svelte` 删除**（零引用，被 Sheets 取代）；vite.config 改用 `vitest/config` 的 defineConfig。
- `npm run build` 通过；`npm run check` 0 errors。**按纪律未跑测试**。
- **需用户目视验收**：① GPU 填充边缘 vs Canvas2D 兜底一致性（回退杠杆：Viewport 去掉 `gpuFill` 传参一处即回退）② 球面视图路径/航路（此前 NaN 不可见，现应显示）③ 外交按钮（附庸/敌/盟）④ 高程图导入按钮。
- **两份测试已陈旧**（待用户拍板再改）：`heightRegions.test.ts`/`hierarchy.test.ts` 用 `layerId === 'height'` 期望海陆元素，海陆层独立后应在 `'landsea'`——规则仍有效，改 filter 即恢复。

**上一轮已处理（2026-09-25，第十次）— 渲染统一 + 过度设计清理 + 架构修复**

- **渲染统一（单一路径）**：删除 `drawHeightRegions`（每帧从 `cell.height` 临时重算 12 档）、`coastRingsFromHeight`（第二套海岸求环）、`isHollowRegion`（湖泊特判）。所有图层（含高度/海陆/湖泊）走同一 `Region.cells → cellSetBoundaryRings → drawPreparedElement`（fill→shadow→stroke）。高度区间本来就是 Region（`rebuildHeightIntervalElements` 造的 12 个嵌套 `cells`+`color`），不再特殊处理。
- **符号参数化**：`LayerDef.coreSymbol: 'star'|'square'|'circle'|'none'` + `cellSymbol: 'tree'|'none'` + `baseMesh: boolean`。`symbolsLayer` 读参数画，不再按图层名硬编码。新图层加 `coreSymbol` 即可，零渲染层改动。
- **陆海谓词收敛**：`isLand(cell)` / `isOcean(cell)` 在 `types.ts`，只在生成/绘制阶段调用。渲染阶段零高度判定。
- **cellColor = 元素填充**：`cellDisplayColor` 返回 Region.color，不再按焦点层名分支。
- **过度设计清理**：删 `ownerPolygon.ts` 兼容门面、`effectiveRegionCells`、`reorderRegions`、5 个 RenderEnv 死字段、5 个零引用 ring 导出、`render/perf.ts` 临时模块。`defaultExclusiveColor` 移到 `layer/style.ts`。`cell.height` 注释修正为 -63..64。
- **getProjCache 失效键**：不再按 world 引用失效（store 浅拷贝 `{…world}` 每次触发 591ms 全量重建），改按 `cacheKey`（seed/cellCount/proj/pp）。
- **笔刷增量**：`commitStroke` 的 Region 归属路径从 `touchWorld` 改 `touchRegions`（不碰投影缓存）。
- **静态贴图 viewport 模式**：period 贴图超预算时改烘焙视口+30% 余量（相机分桶失效），不再掉到每帧矢量直绘。1:1 不拉伸。
- **文档整理**：归档 `RENDER_ARCHITECTURE_ANALYSIS.md`、`RENDER_STYLE_PLAN.md`、`DESIGN_LAYERS.md`（v0.2 draft）→ `docs/_archive/`。根目录回到 AGENTS.md 规定的 5 份。`RENDER_LOGIC.md` 更新烘焙机制描述。新建 `ROADMAP.md`（不完善项与优先级）。
- TS 错误 47 → 18（全是既有类型问题，无新增）。**未跑测试**。

**上一轮已处理（2026-09-24，第九次）— 高度卡死 + 嵌套区间**

- **卡死根因**：`WorkspaceDrawer` `$effect` 读 `world.regions` 后 `rebuildHeightRegions` 写回 → 无限重建。海陆过滤还把 `kind=interval` 误判为大陆并删掉高度元素。已改为：过滤只认显式 continent/lake/ocean；effect 只补缺失区间且不在条件里写 regions。
- **高度区间 = 嵌套重叠（等高线）**：陆地 `hi > h`、海洋 `lo < h`；允许 overlap；`sharedCells` 大重叠只记 `sharedCount`（防关系计算爆内存）。
- **绘制边界等高线**：`drawHeightRegions` 按嵌套序叠画（海 h0→h3，陆 h11→h4）。

**上一轮已处理（2026-09-24，第八次）— P4–P8 图层体系落地**

- **海陆层独立**（`core/layer/landSea.ts`）：`landsea` 内置层；大陆/湖/海元素；`splitPolicy=newElement`（大陆分开=两陆）；**海洋 `manualSplit` 拆分持久化**；海岸=海陆元素边界（coast 通道退休）
- **高度 12 区间元素**（`core/layer/heightElements.ts`）+ **HeightDraw**（整数 ±1 / Shift±档 / Alt=0）
- **MembershipDraw**（`core/draw/membershipDraw.ts`）：placement 闸 + overwrite emptyOnly/replace + splitPolicy
- **ElementStyle** 仅 border/shadow(enabled)/fill；DisplayStyle 三通道；曲线层明示独立
- **LayerConfig 实例表**（`core/layer/config.ts`）+ **生成预设**（默认大陆/群岛/海国/高原）+ `allowOcean`
- 颜色卡已删（`HeightIntervalList`）；`heightRegions` 收敛为色阶 API + 笔刷辅助
- `npm run build` 通过；**未跑测试**

**上一轮已处理（2026-09-24，第七次）— 统一元素类 + 统一生成器**

- **`Region` = 统一 `LayerElement`**（不是子类体系、不是双份结构）：
  - 扩展字段：`adjacentElementIds?: Set<string>`（相邻元素）、`overlaps?: ElementOverlap[]`（complete/partial + sharedCells）
  - `core/layer.ts`：`type LayerElement = Region`；`GenMethod / GenScope / GenPattern / CoreSelector / GenConfig`；`defaultGenConfig(layerId)` 为各层默认配置唯一真相
  - 序列化：`adjacentElementIds` Set ↔ array（与 `weights` Map 同套路）

- **`core/generate/unified.ts` 统一生成器**（所有语义层共用，配置驱动）：
  - **method**：`diffusion`（高度场 stampContinent + rebuildHeightRegions；非高度层径向团）/ `randomConnected`（随机种子 + 连通扩展）/ `fromLayer`（聚合源图层元素，country←province）
  - **scope**：`oceanOnly` / `landOnly` / `noCrossLandSea`（扩展不跨海陆）/ `unlimited` / `fromLayer`
  - **pattern**：`partitionLand` / `partitionOcean` / `partitionAll`（多源 BFS 分区）/ `scattered`（多小块）/ `longStrip`（随机游走长条）/ `cluster`（紧凑洪水）
  - **coreSelector**：`centermost` / `nearBoundary`（边界 cell）/ `highElevation` / `lowElevation` / `random`（种子 rng，不再 `Math.random`）
  - 生成后统一 `computeRelationships`：相邻（共享边）+ 重叠（共享 cell，complete/partial）
  - `fromLayer` 自动 `materializeParentCells`（父 cells = 子并集）

- **各层默认配置**（`defaultGenConfig`）：
  | layer | method | scope | pattern | coreSelector |
  |-------|--------|-------|---------|-------------|
  | height | diffusion | unlimited | cluster | random |
  | province | randomConnected | noCrossLandSea | partitionLand | random |
  | country | fromLayer | landOnly | partitionLand | centermost |
  | environment | randomConnected | unlimited | scattered | random |
  | vegetation | randomConnected | landOnly | cluster | random |
  | fauna | randomConnected | unlimited | scattered | random |
  | race | randomConnected | landOnly | partitionLand | random |
  | culture | randomConnected | landOnly | cluster | highElevation |
  | religion | randomConnected | landOnly | scattered | lowElevation |
  | military | randomConnected | landOnly | longStrip | nearBoundary |

- **级联顺序**：height → province → country → environment/vegetation/fauna/race/culture/religion/military → river → road → route
  - **province 必须先于 country**（country = fromLayer 聚合 province，设 `parentId`）
  - `registry.ts` 全部走 `makeUnifiedGen` → `unifiedGenerate`；路径层（river/road/route）仍走各自生成器
  - `profile.ts` CASCADE_ORDER / defaultProfiles 与上述顺序对齐

- **调用点切换**：`store.applyNature` / `regenPolitical`、`WorkbenchHost` 重新生成本层 → `unifiedGenerate`；不再调用 `generateCountriesCost` / `generateCultures` / `generateReligions` / `generateVegetation` / `generateFauna` / `generateRaces` / `generatePolitical`

- **旧生成器保留原因**：`culture.ts` / `nature.ts` / `political.ts` 中旧函数仍被 **tests/** 引用（外部引用，按 AGENTS.md 可留）；应用主路径已不走它们。等用户要求改测试时再删。

- 本轮 `npm run build` 通过；**未跑测试**（用户未要求）。

**上一轮已处理（2026-09-24，第六次）**

- **实施 RENDER_STYLE_PLAN.md**：
  - **Step1**：`elementsLayer` 恢复到烘焙层（周期贴图优化不破坏）
  - **Step2**：`LayerRenderConfig` 扩展（cellFill/cellBorder/cellFillMode/cellBorderColor）+ `defaultLayerStyleFor` 各层默认样式
  - **Step3**：高度层修正（阴影从样式参数读取，cellFill/cellBorder 可控）
  - **Step5**：随机种子按钮（🎲）
  - **Step4 局部重绘**：cell 级脏区域追踪（`markDirtyCells` + `computeDirtyRects` 环形拆分）
  - **DisplayStyle 面板**：竖向悬浮（图层 panel 右侧）、全参数、👁「显示」按钮、实时同步
  - **高度色阶**：正态分布分箱（两端各 2 值，中间最多）；16 色块色尺 hover 显示范围

**上一轮已处理（2026-09-24，第五次）**

- **渲染架构三步走**（见 `RENDER_ARCHITECTURE_ANALYSIS.md`）：
  - **Step1 修 bug**：`MapTransform` 统一坐标接口（唯一 y 翻转点）；纹理覆盖范围 = 视口范围（`pixelH = TEX_SCALE * dpr * h / cam.scale`）；yOff 从 `MapTransform.yOffFor` 推导；纹理分辨率匹配屏幕（`TEX_SCALE = cam.scale * dpr`）
  - **Step2 性能优化**：`composeShownPieces` 记忆化（`dataRev + focusLayer + highlightRegionId`）；渐进分辨率（拖动/缩放 64px/rad、松手匹配屏幕）；缩放中关阴影
  - **Step3 架构升级**：多分辨率缓存（LOD，LRU 保留 4 级）；`TEX_SCALE = cam.scale`（匹配屏幕）；像素预算 16M；烘焙时始终完整质量（含阴影）

**上一轮已处理（2026-09-24，第四次）**

- **性能三连（绘制/缩放卡顿）**：
  - **A1 笔刷不重烘焙**：`drawPeriodicStatic` 只靠 `dataRev` key 判失效，去掉 `state.world !== env.world` 对象身份判断——笔刷期间 world 对象重建不再触发全量重烘焙
  - **A2 pairEdgeCache 按需失效**：纯几何边表只在 world 对象变化时失效，不随 height/regions rev 清空
  - **A3 高度纹理预烘焙**：逐格高度色烘焙到低分辨率纹理（≤4096²），区域内 `drawImage` 一次性贴图——替代 30k 次逐格 `fill`
  - 代价：笔刷过程中视觉反馈来自 brush cursor，commitStroke 后才看到最终高度色；pairEdgeCache 在 world 对象变化时仍全量重建

**上一轮已处理（2026-09-24，第三次）**

- **高度渐变渲染**：所有大陆统一底色 `#C4A882`（暖沙），高度差异由区域边界内的 **Canvas 渐变** 表达（非逐格填充，符合显示契约）。`heightColor` 改为返回统一底色；新增 `heightGradientColor` / `HEIGHT_COLOR_STOPS` / `DEPTH_COLOR_STOPS`。`drawPreparedElement` 的 `fillColor` 支持 `CanvasGradient`；`elementsLayer` 对高度层自动创建垂直渐变（低地深绿褐 → 高原暖沙 → 雪峰浅黄白）。工作区右侧新增 **HeightColorRuler** 色尺（选中高度层时显示）。

**上一轮已处理（2026-09-24，第二次）**

- **色差问题闭环（非 Bug）**：用户实测"大陆 1 比大陆 2 白"与湖泊数无关；最终定位为**数据层默认配色不同**——`heightRegions.ts` 的 `heightColor(Math.max(0.08, meanHeight(world, comp)))` 按大陆平均海拔给不同色，渲染层参数链（fillA × dp.opacity、layer.opacity ?? 0.88）两大陆完全一致，**不存在重复绘制**。教训已写入 AGENTS.md §8 坑 5：先打印两侧 `reg.color` 再查合成语义。是否改默认配色策略（同色 / 保留高度映射 / 调色板轮转）**用户尚未拍板**，不要擅自改。
- **AGENTS.md 已重构**：原"前半规则 + 尾部 100 行散文提示词"两块合并为统一 0–11 节结构（角色 → 六层模型 → 根因流程 → 显示契约/拓扑/叠放硬规则 → 交付纪律 → 反例清单 → 已踩过的坑十条 → 卫生 → 自检），硬约束零删除、重复合并。后续更新规则直接改这份，不要再追加散文块。

**上一轮已处理（2026-09-24）**

- 用户明确要求极点属于普通地块：`generateVoronoiCells` 改为全域蓝噪声撒点，不再强制两个极点站点或排除极区；`polarCellIds` 从 Voronoi 站点在极点方向的最大点积派生归属，旧档无需新增字段。`projCache` 只为这两个普通 cell 生成按自身周期顶/底框闭合的拾取路径，网格仍描真实边；删除无人调用的 `polarPoly.ts` 第二套实现。`borderCache` 按同一 cell 集求南北极归属，`normalize` 为绕行环选顶/底框虚边；`layers` 与 SVG 不再铺北极整幅底面。浏览器新生成 30k 世界，极点归属普通站点（纬度约 +89.37° / -89.43°），含极大陆的环均正常绕行并生成相应框边；生产构建通过；`npm run check` 仍为此前 46 错、4 警，本轮修改文件未见新增错误。没有运行测试；旧档、拖动与更多种子需继续用户目视验收。
- 用户此前反馈单周期贴图仍有色差与副本竖线。曾为北极归属加连续展开 evenodd 底面，现已由上条的普通极点 cell + 框边闭合替代；离屏贴图按设备像素唯一分配周期区间，余量只供采样；`dp.opacity=0` 保持透明。~~原用户报告的具体色差位置仍需复看~~ **已闭环**：色差根因是数据层默认色不同（见本轮第 1 条），非渲染重复绘制。
- 圆柱投影静态层改为单周期带接缝余量的离屏贴图：区域仍按同一 cellSet 环、evenodd 遮罩、真实边界及内阴影成像；右键水平平移只平铺画面，不再每帧重画多个世界副本。投影/数据/样式/缩放/垂直相机等变化重新烘焙；非周期、路径编辑及超出离屏画布预算时直绘，保持原精度。实时路径、符号、标签、拾取和固定外框仍按现行管线；SVG 保持矢量导出。~~本改动尚需浏览器目视验收极区大陆色差与接缝，不应宣称色差已解决~~ 色差已按本轮第 1 条闭环；接缝竖线已由后续整数副本去重修复。
- 用户继续反馈右键横向拖动后出现竖线与半幅整片填色。种子 `504781501` 的高度图层已用浏览器截图复现：右拖约 2.5 CSS 像素后，左侧被整片误填。根因是 `elementsLayer.elementCopies` 将 `contentOffsetX + k·period` 的浮点结果再分别 `±period`，用 `Set<number>` 去重会留下相差约 `4e-16` 的同一副本；evenodd 把重复路径当成两条环翻转填充。本轮改为先按整数副本索引 `k` 去重，再一次性计算坐标。相同种子、缩放和右拖后的截图中半幅误填及竖线消失。静止截图不能替代平移验收。
- 用户提供墨卡托种子 `504781501`，30,000 地块，`#14592` 横线、`#26099` 竖线。浏览器重生后两者及邻居都是海洋地块，不在接缝或极点；高度海洋的绕行环有首末相距约 5.78 弧度的假闭合，含北极大陆的多个世界副本在虚拟框边处可能重复叠色。本次改为所有绕行环的最后真实段连接相邻副本首点，再向南框补仅供填充的虚拟边；北极 cell 是否归属只决定 evenodd 底面。元素/海岸按同一环合成副本路径，填充和内阴影共用 evenodd 遮罩，SVG 同步按填充/真实描边分别输出。浏览器恢复该种子并在高度图层查看整图，原南侧贯穿横线与内部竖缝未再出现；旧项目和其他图层仍需用户实际目视验收。
- 上一轮保留全部有效共享边、球面先求边中点，并将缺边开链保持为开链；圆柱投影周期与环缓存失效已同步。但上一轮按区域极点归属逐环补框边的方法没有解决海洋带和世界副本接缝，已由本轮的周期环显示规则取代。
- 项目格式写出 v2，保存图层样式与 cellClimate；支持 JSON/gzip 导入；恢复有错不再按无存档处理；生成、导入、恢复经统一换世界入口清除旧交互与缓存；平面 PNG 按钮已接画布。
- 本轮 `npm run build` 通过；`npm run check` 仍为 46 个现存错误、4 条警告，没有指向本轮修改文件的新错误。按要求没有运行测试。
- **尚未处理**：拓扑整数索引格式及旧档迁移；生成 Profile/Worker/依赖单源；父子 Region 换父和撤销的收缩规则；2D/球面的绘制统一及剩余缓存键。不要把这些描述为本轮已完成，也不要以量化经纬度键修补拓扑。

**已对齐的契约（勿破坏）**

- `Cell.polygon` = 几何唯一真相；`sharedEdges` / 网格 / 拾取只派生  
- 球面 Delaunay = **3D 凸包 faces**（整数拓扑）→ `neighbors` + `sharedEdges` + 胞腔外心（**全局顶点表 snap**，与 polygon **同一 LonLat 引用**）  
- `Region.cells` = 归属真相（父含子并集；`materializeParentCells`）  
- `Region` = 统一 `LayerElement`（含 `adjacentElementIds` / `overlaps`）  
- 元素边界 = **边中点 Hermite**（`core/ring/hermite.ts` 唯一）  
- 填充 = 边界内 evenodd；中空本层不填、不铺底  
- 海岸 = 高度 continent/lake 的 **同一** cellSet 环  
- z 序：焦点层 > 列表上层根 > 列表下层根；同树子>父；**选中元素最顶**  
- 默认密度 **30000**；默认大陆 **穿极且贴一极**  
- 中键平移；**Shift+中键** 复制 `#id`（含未聚焦兜底）  
- 生成：**统一 `unifiedGenerate` + `GenConfig`**（method/scope/pattern/coreSelector）；province 先于 country  

**最近在处理的问题（优先继续）**

0. **拖动 / 绘制卡顿（当前最高优先）— 全盘分析与设计已完成（2026-09-26），待用户审方案后实施**

   **现象**（用户原话）："拖动、绘制的卡顿太严重了，在不损失功能和显示的情况下避免卡顿；现在右键左右平移拖动完全不卡顿"——右键横向平移（period 贴图平铺）流畅；卡顿集中在**笔刷绘制、滚轮缩放、放大后平移、路径端点拖动**。

   **根因**（六层模型第 5 层：渲染临时几何/缓存失效，三条链，均已逐文件核实）：

   **链 A 失效域过粗**：
   - `store.endpoint` 路径端点拖动 **per-move 调 `touchWorld()`**（store.svelte.ts:1118）= 每 tick `invalidateProjCache + invalidateBorderCache + invalidateStaticLayer + bumpAllRev`；projCache 重建 O(N)（30k ≈ 591ms）→ 拖端点即冻结。而 `dragRoadEndpoint` 只改 `region.endpointOverrides`（regions 域），属杀鸡用牛刀。
   - `touchRegions/touchHeight`（每次笔刷提交）都 `invalidateBorderCache + invalidateStaticLayer` → 边界环全量重链 + 贴图全量重烘。
   - `borderCache.ensureRev` 按 **world 对象引用**失效（`world !== cachedWorld` 即清 ringsCache）；store 每次 touch 浅拷贝 world → 引用链式失效；`pairEdgeCache` 同样按引用（此前"只随 geom 失效"未真正落地）。
   - 静态贴图 key 含 `dataRev + pieceSignature + highlightRegionId` → 点选元素也全量重烘。

   **链 B 烘焙粒度过粗**：
   - `invalidateStaticLayer` 清空整个 LRU（4 state）；脏矩形机器（`markDirtyCells/computeDirtyRects` 环形拆分）已有，但**只有样式面板用 `'all'`**——笔刷从不标记脏 cell，每次提交全量重烘。
   - 滚轮：`TEX_SCALE = Math.round(cam.scale)` 进 key → **每 tick 全量重烘**（`zoomEndTimer` 只切 `zoomingLive` 标志、不延迟烘焙）→ 缩放顿挫 ~100ms/tick。
   - viewport 模式（放大）：camBucket 0.3w 分桶，跨桶即新 key 重烘 → 放大后平移周期性顿挫。

   **链 C 逐帧实时层成本**（管线 bg,cells,cellsMesh,elements 烘焙；paths,decorations,frame 每帧）：
   - `pathsLayer` 每帧每路径 `projectPt + catmullRom(10)` + 双遍描边（河逐段双描），无缓存。
   - `decorationsLayer`：tree 逐 cell 画且**无 viewIndex 视口裁剪**（植被层放大 = 1 万+ 图标/帧）；标签 `regionCenter` O(region.cells) + `measureText` 每帧每区域。
   - hover 空划：`hitTest → hoverId → $effect → requestRender` = 无按键划过也全图渲染。
   - （更正：阴影已非 8 遍——layers.ts:444 现为单遍 clip+blur；ROADMAP P0 首行过时。composeShownPieces 记忆化也已修。）

   **设计原则**（红线不破）：
   1. 失效按域：**geom**（cell 几何）/ **data**（height+regions）/ **style** / **view**（相机桶）；每个缓存只订阅自己的域。
   2. 缓存键按 rev 订阅，**不按 world 对象引用**（引用链式失效是根）。
   3. 重烘焙按脏集：笔刷提交只重烘脏矩形（机器已有，接线）；手势期间 blit 旧贴图（瞬态），停手一次性全质量 1:1（终态不打折；"不永久降分辨率"允许瞬态——与笔刷期 brush-cursor 反馈同一模式）。
   4. 实时层只做**等价降本**：路径 poly 缓存投影空间（points rev+proj 失效）、每帧仿射到屏幕；装饰过 viewIndex（视口外不画 ≠ 抽稀）；标签 measureText/regionCenter 记忆化。
   5. 显示不打折：不抽稀、不关阴影、不降 smooth、终态 1:1。

   **分包规划**（每包独立验收 + §7.2 反例清单；顺序 1→2→3→4）：
   - **包 1 失效域拆分 + 键去引用化** ✅（`91135dc`）：geomRev 分域；pairEdgeCache 只订几何域；ensureRev 去 world 引用判断；环缓存键补内容指纹；端点拖动 move 阶段 touchWorld→touchPaint。
   - **包 2 烘焙增量** ✅：同布局旧贴图作底 + 脏矩形重绘（copy-source）；笔刷归属提交标脏 stroke cell、高度提交拓扑翻转全量/微调标脏；选中变化只标脏新旧选中元素（不全量重烘）。
   - **包 3 实时层降本** ✅：paths poly 投影空间缓存（points 签名+投影为键，跨帧/跨副本复用）；tree/cellMarker 视口 bbox 裁剪（baseMesh 全量走惰性迭代）；标签 measureText + regionCenter 记忆化。
   - **包 4 hover 只刷 overlay** ✅：hoverId 移出地图渲染 effect，空划不触发地图管线。
   - ~~手势期瞬态~~ **已否决**（用户约束：零显示打折）：缩放维持逐格全质量烘焙，达标依赖 GPU 后端。

   **100k 级 cell 可行性（用户要求评估；约束：不卡顿 + 零显示打折）**：
   - **可达成**（CPU 侧包 1-4 落地后）：平移（period blit 与 cell 数无关）、笔刷绘制/提交（命中查询 + 脏矩形增量）、选中/工作区、悬停（包 4 后走 overlay）、编辑操作。30k→100k 下这些路径的成本随**视口内** cell 数增长，不随总数增长。
   - **缩放动画是唯一卡点**：全质量约束下每格需全量重光栅；CPU Canvas2D 单次全图烘焙 100k 量级数百 ms（30k 已 ~100ms 级），逐格执行必掉帧。**唯一达标路径 = GPU 后端**（ROADMAP P0 的 RegionMesh/WebGL：填充/描边/阴影走 GPU，100k 全图重光栅 ≈ 数 ms，缩放 60fps 全质量）。CPU 缓解（非达标）：visited-scale LRU（复访即时）、烘焙移 Worker（主线程不卡、动画仍受限吞吐）。
   - 初次生成/加载：生成已走 Worker；projCache 首建 ~2s@100k（一次性，可 Worker 化）；首次烘焙一次性。
   - **结论**：目标可达，路线 = CPU 包 1-4（本轮起）+ **GPU 后端立项**（下一轮出 RegionMesh/WebGL 设计：三角化缓存 + per-vertex 属性 + 保 RENDER_LOGIC z 序的合成序）。GPU 落地前缩放维持现状（慢但不糊）。

1. ~~**应邻接的 cell 顶点仍可能不重合**~~ **已做：生成侧全局顶点表**  
   - 根因：凸包对偶近重合外心 + per-cell first-wins 去重 → 同一角两个坐标  
   - 已做：`createVertexSnap` 全局焊接 → polygon / sharedEdges **同一 Vec3/LonLat 引用**；短 Voronoi 边塌缩则丢退化边；`rebuildSharedEdges` 去掉 0.05° 糊焊且端点同引用  
   - 实测 seed=42/800：独有顶点 0；sharedEdges 端点均在两侧 polygon；serialize 前后一致  
   - projCache 0.01° 表仍作显示 unwrap，不得再当几何焊接层

2. **30k 生成仍偏慢 / 进度**  
   - 已换凸包 Delaunay、分段进度、Worker、stripSharedEdges 回传  
   - 若仍卡：标定是 Worker 串行 JSON 还是 height/cascade；整包优化，不降画质  

3. **外框 vs 静态合成**  
   - 外框与 `beginWorld` 同矩阵；静态缓存（bg+mesh+elements）已开  
   - 若再错位：只修坐标系单源，禁止手算屏幕矩形第二套  

4. ~~**三角缝（三 cell 夹缝）**~~ **接 1 已做**  
   - 角点已全局焊接；剩余「邻接只共 1 点」= 短边塌缩（合法点触），不是裂缝

5. **极点 cell 与框边闭合（本轮）**
   - 全域正常撒点，南北极分别由最近站点所属 cell 覆盖；只在圆柱显示侧沿完整周期接上顶/底框虚边，真实网格边独立描绘。
   - 删除旧的 `polarPoly.ts` 与纬度阈值判断；极点归属从站点导出，与存档中的 `Cell.center` 一致。旧档仍保留其原站点与拓扑，不静默重生。

6. **墨卡托周期环（本轮）**
   - 球面环在相邻世界副本结束真实段，绕行环按同一 `cellIds` 的极点归属向顶/底框补虚边，不再增加 evenodd 底面；唯一例外是全世界 cell 集没有外边界，直接填充全框（画布与 SVG 同口径）
   - 画布同一元素的副本合成一次填充/阴影/描边；旧的 `nearPole` 阈值与逐环 `poleSide` 不再是现行设计
   - 验收：种子 `504781501` 的两处线、两极大陆、海洋带、跨日界线、地图横向拖动，以及 SVG 导出

7. **统一生成器调参（本轮后续可做）**
   - `defaultGenConfig` 的 names/colors/count 可再丰富；profile 面板可暴露 method/scope/pattern/coreSelector
   - 旧生成器（culture/nature/political）待测试迁移到 unified 后删除
   - `generateDemoContinents` 的 stamps/falloff 尚未接到 profile.params

**明确不做**：per-cell 语义填色；第二套海岸/边界管线；显示抽稀；WASM（除非用户点名）。

**工作方式**：一次只推一个整包；用户要 test 再 test；要 F12 堆栈再让用户提供。
