# Mapedi 交接（给下一轮 AI）

工作目录 `/Users/zgy/mapedi`，应用 `web/`（Svelte 5 + TS + GL 直绘，100k cell）。**全库已提交：第五十二轮基线（含四十五~五十一轮未落盘工作：注记包/组织/生态/cellMarks/联排胶囊 + 高度色暗斑双根因 + 居中 centerBias + svelte-check 13 errors 清零）。**

## 先读

1. `AGENTS.md` — 协作规则与红线（六层定位模型、根因流程、硬规则、测试纪律、文档分层 §9）
2. `RENDER_LOGIC.md` — 显示契约与模块边界
3. `ROADMAP_REFACTOR.md` — 还债路线与已知问题（含证据行号）；产品缺口 → `ROADMAP.md`
4. `docs/ARCH_REVIEW_2026-09-29.md` — 全库评审快照（还债排序依据）
5. `docs/UI_REFACTOR_2026-09-29.md` — UI 九轮迭代规格与决策记录（§9 两表 D/C/E 系拍板 + 第十轮语义解析标注）

`docs/_archive/`、`docs/history/`（59 轮旧日志）**禁止当实现依据**。**注意**：投影动画/模式切换有并发会话线，接手前先 `git log`。


## 当前状态（第四十四轮完成；在案：`docs/OPTIMIZE_REVIEW_2026-10-04.md`）

- **✓ 第五十三轮（2026-10-06 用户四件：显隐总控/图层栈序/羊皮纸色卡/生成三清除）**：
  - **A 显隐总控**：`isLayerShown` 删「选中即显示」焦点强制（实测焦点+隐藏时 placed=3/symbols=7 全残留=按钮失效根因）→ 唯一真相 `visible`∧祖先链，**隐藏优先于焦点**；装饰层 baseMesh 分支同步。AGENTS§3/RENDER_LOGIC 契约已更。实测：焦点国家+隐藏 → placed 3→0、symbols 7→1 ✓。
  - **B 图层栈序**：`builtinLayers()` 重排为 **地块→高度→国家→行省→生态→种族→文化→道路→航线→河流**；`layerStackComparator` rootIdx **降序→升序**（旧判=列表上层根画最上，与用户新契约相反）→ **列表自上而下 = 地图自下而上**；ensureBuiltinLayers 相对序自愈自动迁移旧档（实测载入即新序）。AGENTS§5 已更。
  - **C 羊皮纸全色卡+删科幻**：parchment 全字段定义（ocean #a9c0b7 老海蓝绿、landBase #e4d5b0、**frameVoid 首次定义** rgba(52,40,26,.92) 装裱底、墨 #4a3728 系描边、标签衬线墨色）——色锚来自 web 检索古地图色库（wallfully/icolorpalette/123freevectors/historicpictoric）；`neon` 科幻预设删除（styles+ViewSettingsPopover 两处，persisted styleId 自动回落 dark）。**C2 深化（同日用户「不只大背景——高度图每档也要」）**：StyleSet 加 `heightBands`（羊皮纸 12 档：水灰蓝绿四档/陆沙黄赭四档/山棕褐/顶峰米白，数据不改）+ `desaturate:0.45`（元素彩虹色向中点缩放压饱和、保色相区分）；渲染单源 `bandColorOf`（layers.ts：档色走专属不二次压、数据色压饱和；填色/fullFrame/描边/核心符号四处同走）。量化：羊皮纸 hi-sat(S>0.45)=**0.00%**、medianS 0.629→0.321（淡彩保生气）；暗色回归 medianS 0.629 原样 ✓。坑：desaturate 初版分段映射不连续（c=mx−1→mid、c=mx→mx 跳变）→ 改向中点线性缩放。
  - **D 生成三清除+两击确认**：①撒点=**仅地块**：worker/主线程链加 `enabled` 白名单（cellsOnly=空集跳过全部生成器，不生成高度图），新世界=cells+空内置层（自定义层/路径随之清除），焦点回地块；②高度重生成 → 清除地块+高度以外全部图层内容；③子层重生成 → 清除父层链（父层聚合子层）。**清内容不清壳**（图层定义保留可再生成；路径按 layerId 一并清+clearSelection）。GenerateSection 三按钮**两击确认**（首击武装 ⚠ 红态、2.6s 自动解除，撒点分支地形旋钮整块移除）。
  - 实测：composeOrder=高度→国家（新栈序）✓；撒点分支无旋钮+文案 ✓；武装/解除 ✓（世界分毫未动 seed188943080）；tsc 0 / svelte-check 0 errors。
  - **补二（同日用户两件）**：④**注记显示契约改写（原话「缩放小了很多文字标签不显示——总是显示；随缩放缩放、不因缩放重绘，相对大小与地图完全一致」）**：`kScale=cam.scale/180` 字号/占位/字距/halo 全 ×k（fs 读数证：scale193→fs16.09、scale376→31.35，两档比值=scale 比值）；R14 符号阶梯+`minScale` 过滤删除、`labelMinScale` 全链删（types/labelStyle/配置面门槛控件——UI 控件变尸体即删，字段随删）；布局本就世界空间判定（px÷scale 消去）→ 放置与缩放全等不重排（同 scale 连帧 ids 一致）；scale33.9 实测 secondary 标签在场（旧码 minScale75 必 0）。契约落 RENDER_LOGIC 核心约定块；`__labelStat.items[].fs` 新读数。
  - **补五（同日两功能：基于已有 + 平滑笔刷；细化管线经用户澄清重写）**：用户否掉初版「粗值扩散细化」（"完全达不到效果"）并澄清——**基于已有 = 基于已绘制的大致海岸线走完整重新生成**（buildTerrain 同套：Perlin-FBM/山系/细节/海底/热侵蚀/去尖刺/刻度），然后**分位重映射到用户 mask**（陆区 f 升序分位铺满 [1,64] 顶峰、海区铺满 [-63,0] 深海，gamma=flatness 幂弯保分布形状）→ 顶峰到深海各档齐全、**海岸线逐格=绘制**（landRatio/relief 被 mask 与满谱取代→开态隐藏这两钮，其余 8 旋钮有效）。共享核 `refine.ts` 现只余 refineHeight（graphDiffuse/distToOppositeSide 已随旧管线删除=无消费者不留码；terrain.ts 噪声导出收回私有）；**平滑笔刷保留**（smoothHeightBrush：归一化均值式——修掉显式式 λ·度>1 过冲（实测 0.4×6 把带边格拉到 64）的真 bug，feather=刷内邻居占比、护岸=初始侧+侧 clamp、paintHeight 首触快照→HeightCellsCommand 自动可撤）。A 入口=「基于已有」胶囊+两击确认+service.refineHeightLayer（快照入栈保用户手稿+flushHeightRegions）；B 入口=绘制区模式（🖌/〰）+强度 1/3/5+护岸开关。验收（合成世界，真世界当时纯海=无陆保护零改动）：**mask 0 破、陆 [1,64] 海 [-63,0] 端点到达、总 104 档、纯海 return 0**；DOM：开态 8 钮/大陆占比+落差隐藏/按钮文案切换/关态 10 钮回 ✓（坑：断言用 tcell 元素而不是 textContent——hint 文案含"大陆占比"字样会假阴性）；B 梯度 57→25、mask/刷外 0 变；tsc 0 / svelte-check 0。
  - **补三（同日用户：子图层元素列表同父分组）**：焦点层有 `parentLayerId` → cells 派生内稳定分区（无父组置顶、组序=父首见序、组内保原叠放序）+ 组头（父名**居左小字** `.ghead` 24px）+ 组间横线（`.gsep` 9px 伪元素横线）；顶层图层平铺零变化。cellNode snippet 三分支短路（head/sep 不进 row 逻辑；each key=kind+id 天然唯一）。实测：行省=8 头 7 线（8组−1=7 即严格聚拢）15 行；国家=0 头 0 线。
  - **补四（同日用户：视图携带图层配置架构 + 羊皮纸两件）**：`StyleSet.layerStyles[layerId]`（视图级图层默认样式）+ 已有 `heightBands`（视图级图层颜色集）；resolve 三段链 静态默认→视图→存档（**存档优先**，写入侧不吃视图=setLayerStyle 走数据基线零污染）；`styleId` 单源化到 store（App `$derived editor.styleId`、CommandCtx 注入、检查区面板显示生效值、Viewport styleOf×3 传 `styleById(styleId)`）。羊皮纸落地：height `border.enabled:false` + 高度档组内色差压缩（海 Δ17→8、陆 Δ33→19，组间 63/110 保持）。严格验收：base=true/视图=false/存档压视图=true（合成 world 三段断言 ✓）、暗色无 layerStyles ✓、tsc 0 / svelte-check 0。**注意**：用户真世界 height 存档 border.enabled=false（历史手动关边）→ 两视图均不画描边，「边界」观感=档间 fill 色差，压缩调色即视觉弱化 ✓。
  - **补（同日用户两件）**：①撒点完成后**不再切球面**——撤 onGenerate 里的 switchView('view-globe')，保持平面编辑+生成模式；②顶栏视图胶囊换位：**平面编辑在前、球面展示在后**（VIEW_MODE_ITEMS 序，默认视图不变）；③「含子层」原生 checkbox 换 **StateCapsule**（🧬 仅本层↔含子层）+ 同批「抢占」勾选同换（⚔️ 抢占/填空）——**原生控件样式违项目风格，全库 checkbox 已归零**。

- **✓ 第五十二轮（2026-10-05 高度色暗斑双根因修复 + 左栏居中改相机偏置；底座透明被用户叫停）**：
  - **高度色暗斑（#85026/#5848 未填色）双根因**：① reconcile 双真相——`reconcilePieceMembership` 按 setKey 反查 `region.cells`（精确档）对账，把区间型高度件环**打回精确档**（显示=累积 h≥lo）→ 新单源 `displayCompose.displayCellsOfRegion`，reconcile 改吃 compose 件 `dp.cellIds`（Viewport 里移到 compose 之后传 pieces；无 pieces 不消耗门控）；② 链化断链——桶2 贪心缺 `outUsedG` 复查（succ 非单射→9 条 1-边链被丢）+ 近重复站点 A/B 定向退化（|in|≠|out|）→ 提环改 `walk`+`pickAdj` 邻接无向兜底（正向优先/回起点即闭合），`buildRingFrom` 签名 keyList→dirs（混合走向键重建+轮转同步 rotD）。像素验收：#5848/#35248/#82331=h3 色、#73335=h2 色、全图 base 色像素=0。
  - **左栏底座（用户报「组件下多了一个不透明底座，要完全透明」）**：round39 画布内缩机制改为**相机偏置** `centerBias`（App 派生 → Viewport `viewCam`=raw−bias/2/scale 渲染+输入同源、球面 `setViewOffset` 同位移；数学与内缩恒等，画布恢复全宽）。居中平面/球面均已验证 ✓。**未完成**：栏后仍是 frameLayer void 暗色（世界透镜左缘 313.5>栏右缘 307，周期副本窗口未扩展）——用户叫停迭代，现状=居中保留、透明未达成。
  - **真读数更正**：`svelte-check --tsconfig tsconfig.app.json` = **13 errors**（ViewSettingsPopover:54 Node.closest、LayersPanel:237 rowOrg、App:430 WsMode 为 10-03 前存量；Viewport:739/783 `.failed` 私有、:1079-1140 `world.paths` 可选化未守卫、GenerateSection:63/InspectSection:201/WorkspaceDrawer:330 为注记/组织批工作区缺口）——历轮「0 errors」是假绿读数，待专门批清。
  - 基线：tsc(app) 0 / svelte-check 13 errors（全部在非本环改动行）/ 浏览器实验相机已复位。

- **✓ 第五十一轮（2026-10-04 用户修正：核心选择移绘制模式+联排胶囊；做 5=cellMarks）**：
  - **联排胶囊按钮**（用户指定样式）：新增全局 `.seg-group`（首键左端圆角/中间全直角/末键右端圆角、相邻共享 border-left、容器 999px 胶囊），`DisplayStylePanel` 四组注记按钮与绘制面板新按钮全部改用；**测量证据**：computed radius 首 `999/0/999/0`、中 `0/0/0/0`、末 `0/999/0/999` ✓。
  - **核心选择迁到绘制模式**：绘制面板新增「核心」联排三键（地块 / 子元素 / 视觉中心）+ 当前核心显示（`核心 #54627` / `核心「甲郡」`）；**检查区三个核心按钮删除**（保留隶属/子元素跳转/挂靠——用户原话「父子元素的跳转保留在检查模式」）。
  - **真 bug 修复（点选模态被笔画劫持）**：绘制会话 active 时画布 pointerdown 走绘制分支、pointerup 的 `!drawActive` 又挡住 onpick → **模态收不到点击**（实测 cycle 全 'none'）。修：Viewport 加 `pickModal` 派生（`centerPickId || markerPick`），down 条件加 `&& !pickModal`、up 放行 `(!drawActive || pickModal)` → 修后同会话内 cycle = `star→circle→diamond→none` ✓。
  - **cellMarks（包5 后半）全链**：`World.cellMarks?` + **serializeWorld 显式白名单**（该函数是逐字段白名单，不是展开——漏了就不落盘）+ deserialize **悬空过滤**（越界 cellId 不进渲染）+ `CellMarksCommand` 整表快照入栈 + `commandService.cycleCellMark`（无→★→●→◆→无，touchLayerView）+ store `markerPick` 模态 + App 分发 + 绘制面板「点标记」单键胶囊 + 渲染复用 symPlan（占位/绘制同链）+ `CoreSymbol` 加 `diamond`（配置面符号组同步 ◆）。**验收**：cycle 四步 ✓、双格 ✓、Esc 退 ✓、**撤销全部清空** ✓、`serialize cellMarks='1 items star'` ✓ 反序列化回环 ✓ **越界 cellId 被过滤** ✓。
  - **坑（重踩）**：`touchLayerView→swapIdentity` 换 world 身份后，**测试里缓存的旧 world 引用读不到新值**（cycle 读成全 star 假象）→ 每步必须 `e.world.xxx` 重取（memory 既有教训）。
  - 基线：tsc 0 / svelte-check 0 errors；累计 29 文件 +1749/−543 **全部未提交**。

- **✓ 第五十轮（2026-10-04 包5 前半：图层注记配置面）**：`DisplayStylePanel`（嵌检查区）新增「注记」分组——**名称**（不显示/元素名/核心）、**档位**（自动/国家级/行省级/语义/次级）、**符号**（无/★/☆/⊙/■/●）、**格标**（无/ID/高度）四组**分段按钮**（原 `<select>` 改按钮组：分段控件是项目风格，**且合成 change 事件不触发 Svelte handler**——实测 click 可靠/change 失灵）+ **字号/门槛** number（占位「档位默认」=undefined 回档位值）+ 摘要行回显「名称开·符号 ★」。写入链路 = 新 `commandService.setLayerDecor`（`LayerFieldsCommand` 一条入栈可撤销、alreadyApplied **先手动写世界**、失效域 `touchLayerView`——注记配置不碰几何）+ store 门面 + `LayerDecorPatch` 类型。**踩坑**：`onDecor` 只加进类型注解**没加进 props 解构** → prop 为 undefined → `onDecor?.()` 静默空操作（探针 `[decor-click] onDecor=undefined` 抓到；症状=点击无反应但命令也没入栈）。**验收**：按钮组4组渲染+当前值高亮 ✓ 名称→不显示（UI点击）→ labelMode=none 且 **渲染 placed 3→0** →undo 恢复 ✓ 符号→☆、档位→次级、门槛1000→placed0、字号40写入、`syms 4→0`（符号关）各自 undo 还原 ✓。**包5 后半未做**：`cellMarkers` 自定义地块标记（数据结构+绘制+点选入口）→ 下一轮。tsc 0 / svelte-check 0 errors。

- **◐ 第四十九轮（2026-10-04 用户七条，1/3/4/5 已交付；2 待现象、6 当时定稿待实施）**【6 与包5 已在第五十/五十一轮完成，勿按本条误判】：
  - **1 多名字两层根因**：①同层重名（count>池 → `names[i%len]` 循环）→ `unified.indexedName` 超池加序号（需重新生成见效）；②**跨世界副本 pass 重复**（contentOffset≠0 时两个 k 各画一个）→ 装饰层**帧级防重**（模块级 placedIds 按 `__drawCount` 令牌；注意局部变量防不住 pass 重入）+ 出屏判定改**盒中心**（贴边截断的不画，让后 pass 画完整那条）。
  - **1b 拉伸字距替代重复注记**（用户拍板）：`pickLabelLayout` 狭长面 → **一个名字沿轴**（spine 最宽节点优先）+ 字距拉伸（上限中文 1×字大/西文 0.5em，**阶梯回落** wStretch→中点→自然宽，否则锚点局部不够宽会全失败退回无拉伸）；`LabelItemAt.ls` + 渲染时切 letterSpacing + 尾距半格补偿；**字体重新调研后改**：primary（国家）= 图集衬线 `MAP_SERIF_STACK`（Georgia+宋体+思源宋），其余=主题无衬线栈（西文在前 CJK 在后，dark 补 Segoe/Roboto/Open Sans/Noto Sans）。验收：屏内同 id 唯一 ✓、罗马 stretch ls0.5 单条 ✓、country serif=true ✓。
  - **3 绘制高亮语义升级**：`paint()` 返回 `{hits, changed}`——changed=**将要改变归属的格**（移除=属本元素的；emptyOnly=本层无主的；replace=非本元素的；父笔刷换父=该子元素全部格），高亮只画 changed ✓ 实测 ownCell changed=0 / freeCell changed=18 ✓；填充 0.38→0.55+亮描边；**DOM 证据 viewport-root 内 gl z=0 / 主画布 z=1 / ovl z=2 = 已最上**。
  - **4 图层重构完成**：删 environment/vegetation/fauna/religion/military → 新增 `ecosystem`（生态，kind=ecosystem、labelTier tertiary、cellSymbol tree、count12、去重名字池18个）；全库7文件同步（world/config/layer/registry/profile/layerMeta/types kind）+ `ensureBuiltinLayers` **退役清理**（删层+删其 regions，海陆案A同策略）+ **内置层相对顺序自愈**（旧档曾把生态 push 到末尾=政区之上；重排内置槽位、custom 原位）。验收：layers 顺序 cells/height/**ecosystem**/race/country/province…、leftoverRegions=0、UI 只剩「🌿 生态」✓。
  - **5 级联重生成开关**：GenerateSection 在焦点层有子层时于「重新生成」左侧显示「含子层」（默认关）→ `regenLayer(layerId, seed, cascadeDown)`：沿 childLayerId 链收集 `[最深子…直接子, 自身]` **逐层 runCascade（子先父后）**（父层聚合子层，顺序反了会用上一代子元素）；状态文案带链。验收：country 显示开关 ✓ province（链尾）不显示 ✓ 可勾选 ✓。
  - **2 待现象**：#35248/#5848/#73335 的**数据归属/合成 pieces/叠放序/件环奇偶四层全部验证为对**（含61/61抽样 inside、半透明叠加差4/255 定量排除）→ 需用户补「错成什么色 / 涂改后才错还是本来就错」；GL readPixels 受 preserveDrawingBuffer=false 限制没取到像素（同帧读也失败）。
  - **6 已完成（用户拍板 6.1 选项1 + 6.2）**：`Region.coreRegionId` 第二形态（与 centerCellId **互斥，设其一清其二**；单源 `core/regionCenter.coreCellOf`——渲染/路网/校验全走它，旧 `SetCenterCommand` 因写不到渲染读的字段已删、改 `RegionFieldsCommand`+alreadyApplied 手写世界）；**两种形态统一「地图点格」**：检查区「📍 点格」（设 centerCellId）/「📍 点子元素」（点到的格属哪个子元素就设谁，`getRegionIndex.owners` 反查 + `parentId===regionId` 闸）+ 按钮旁显示当前核心（子元素名 / `#格`）；**读档修复**：`repairHierarchy` 清悬空/跨层 coreRegionId；**validate** 的 requireCenter 接受两形态（核心子元素无效 → center_missing）。6.2 抢占开关在绘制面板（笔刷旁）：开=**replace**（`addMode=false`）、关=emptyOnly。**验收**：点子元素→`coreRegionId=province-0/centerCellId=undefined/coreCellOf=子元素核心格/状态栏报子元素名`、撤销还原 `77553`；点格→互斥清 coreRegionId；视觉中心→54627；抢占对照 emptyOnly `changed=0` vs replace `changed=561`（=换父整省560格+命中的1格）、undo 后 cells/parentId 逐位还原 ✓。
  - 基线：tsc 0 / svelte-check 0 errors；**全部未提交**。

- **✓ 第四十二轮（2026-10-04 用户驳回「保持瞬移」——修根因不撤功能）**：
  - 金钮（ModeCapsule 填色滑钮）**滑动过渡加回**（0.18s）+ **卡死看门狗**：档位变化后320ms核对滑钮矩形与激活档，未到位=时间线冻结（2026-10-01 旧 bug 根因：后台页 CSS 过渡冻结、style 已终值 computed 停旧档）→ 关过渡+强制重排瞬时落终档、随后恢复过渡；回前台/visibilitychange/focus 立即再核对。**动画与位置正确兼得**——四十一轮候选ⓒ「保留瞬移」作废（用户原则：发现 bug 修根因，别撤功能）。
  - 观测：`globalThis.__knobV`（perfHooks 声明）；验收在失焦冻结环境正合压测：慢过渡注入模拟冻结→snap 归位、四连切自愈、双胶囊终态 dLeft=0；tsc/svelte-check 0、vitest 152 绿。

（第四十一轮手感批记录见下）；在案链：

- **✓ 第四十一轮（2026-10-04 用户两件手感问题 + 自查）**：
  - **问题2「绘制/显隐/切图层整个界面闪一下」根治**：根因=touchWorld/touchRegions **双全清**（投影重建+件环重建=编辑后数百毫秒长帧，用户猜的『全量重绘』完全正确）；修=**渲染前对账补丁** `borderCache.reconcilePieceMembership`（dataRev|projKey 门控一次，Δ 就地 patchPieceEntry；实测 mutate→1、还原→1、零错），touchWorld 撤投影/环两全清（投影键 seed/count 自失效）、touchRegions 撤环全清（invalidateBorderCache 留作测试夹具）。附证：compose 冷算 0ms（6件级）无辜、渐现只在首启 warmDone 前。
  - **问题1「按钮等地图响应」**：flush 实测仅2-30ms（按钮状态本就瞬时），卡的是点击后**同步长块**（球面块求值+搭建329+194ms）冻结渲染帧→CSS 动画时间线停摆。修=①全局 :active 按压缩放（纯 CSS 输入即生效）②视图切换 viewFade 0.2→**0**（点击即全暗 dip，实测先于长块绘制）③`.view>*`/`.acc .body>*` 进场动画（挂载即播不等内容，computed=view-in/body-in）④**球面懒加载预取**（悬停视图胶囊暖 chunk，实测切前已就位，首切 2-3s 空窗→近零）。
  - **测量法沉淀**：flush=MutationObserver 首变延迟；主线程阻塞=click 后首个 setTimeout 滞后；失焦页 rAF/CSS 时间线全冻结——长调用超时要先分辨「broker 丢响应」与「真卡死」（本轮三次超时实为丢包，页面其实活着）。
  - **手感自查清单（候选未做）**：ⓐ autosave clone ~250ms 主线程抖动（技术债在案，建议下一包=存档镜像常驻离线程）ⓑ 滚轮缩放 1.1 档跳变（可加补间，需锚点 A/B）ⓒ 模式胶囊滑钮保留瞬时（历史回归坑：后台页 CSS 时间线冻结致金钮卡位——按压反馈替代）ⓓ 面板高度无过渡（内容进场已有，收益小）。
  - 基线：tsc 0 / svelte-check 0 errors（5 warning 存量）/ vitest 29 文件 152 用例绿。

（第四十轮决议批记录见下）；在案链：

- **✓ 第四十轮（2026-10-04 用户批8项决议执行 + 生成三症修复 + 测试首跑）**：
  - **测试（批5）首跑**：两处陈旧失败修 `71a5329`——cellIndex.test（模块36f7773已删测试漏删）删；环不变量「同件各环同周期窗」断言被 ad3f72b 缝环设计取代（该修复当时已像素验证+用户裁决）→ 重述为「单环内无周期跳变」。**29 文件/152 全绿**。
  - **生成三症（B1/B2/B3）`7451ec8`**：地形/布局分支补种子行+🎲（seedInput=草稿字段全链透传 regenLayer(layerId,seed)，状态回显种子）；B3 引擎实测无恙（扰动60海格→输出变、还原→逐位回基线）——「像没重新生成」= 同种子同输入必然同输出。E2E：🎲换种子 hSum 变、原种子复原逐位 `-908150`。顺补案A遗漏的 GenerateSection 5处海陆文案。
  - **拍板执行**：①`2aa988a` 精度统一千分之一（PROJ_WRAP_EPS1e-2→1e-3、顶点网格0.01°→KEY_QUANT）；③`d0b3aa5` 尸体删除（exclusiveColor 全链+diplomacy.ts+测试，grep 归零）；④`7eb3775` 副本双尺合一（space.copyOffRange/copyIntersectsBox 单一原语，mapRenderer 本地谓词删）——稳定帧法 A/B：默认态跨码0.0%、平移态跨码0.0%；⑤原方案（键补 regionsRev）与件环补丁红线冲突→维持文档裁决（断言随翻转探针包）；⑥flip 断言同捆（可选项）。
  - **验收（批6）**：100k 主线程 scratch 基准 create5.9s+cascade1.9s=总7.96s（UI 实际走 Worker）；绘制会话=成员笔画 +119 格→撤销逐位还原、高度会话见三十八轮、道路会话本世界不可达（paths=0=校验早退原状，逐位哈希证非回归；新建走自由层创建行）；帧 p50=1.1ms；「长按生成/liftDrag」两项验收标的已随三模式重构与拖动退役**作废**。
  - **坑**：跨码像素对拍必须**同码序列收敛到稳定帧再比**（渐现/暖机瞬态6-9s 跳变89%曾两度误判）；broker 不吃跨进程大字节数组（页内 diff 直接炸——改文件序列+node 端比）。
  - 基线：tsc 0 / svelte-check 0 errors（5 warning 存量）/ vitest 29 文件 152 用例绿。

（第三十九轮视图居中对准记录见下）；在案链：

- **✓ 第三十九轮（2026-10-04 用户需求：面板展开→视图对准剩余空间中心，双收起回屏幕中心）**：
  - 实现 = **几何内缩而非相机搬家**：App `mapInset`（图层|元素任一展开 ? 栏右缘317 : 0）→ `--map-inset-l` 挂 `.view`（left 内缩）——平面/球面共用；相机不动 → 世界中心自动落在剩余空间中心；rect 相对坐标（llAt/zoom/拾取全链 `clientX-rect.left`）零改动自适配。LeftRail onState 改回传 `right`（fixed left8+实测宽）。
  - GlobeView 渲染循环加**逐帧尺寸自校**（缓冲≠容器 → 同步纵横比+缓冲）：**本环境 ResizeObserver 实测零回调**（失焦页渲染步停摆——连自建元素自改宽度都不触发；平面靠既有 syncBackingStore 兜底、球面原来没有），RO 保留为正常环境冗余。
  - 验收：平面三态几何 317/0/317 往返；**精确中心开合同格 #10407@0.0°**（早先"不同格"= 整数取整半像素差、scale180 下放大成0.2°——教训：居中类断言用浮点精确中心）；球面/平面缓冲泵帧自愈 1410↔1093；tsc/svelte-check 0。

（第三十八轮用户四件反馈记录见下）；在案链：

- **✓ 第三十八轮（2026-10-04 用户四件反馈，一次交付）**：
  - ① **「子层」药丸撤销**（8ef38d6 引入当日即撤）；② **元素单体显隐退役**（用户定：图层显示下元素恒显示、个体显隐无意义）——检查区元素胶囊删、元素行 👁 徽章停发（ItemButton badge 改显式开关，图层/路径保留）、toggleItemHidden 命令链整删、检查区元素基本色改**自身渲染色**（微调后父色≠自色，面板与地图同真值）。
  - ③ **彩虹配色 `core/layer/palette.ts`**（≥20：RAINBOW 24 色相均分+colorAt 单源）——九层旧色池全删（实测唯一色仅 4–5）；④ **父子同色系 tintOf**（父色 ±16°/±7% 按兄弟序）：generateFromLayer 聚合后 + 组织缩进（与 parentLayerId 同一条 Composite 入栈）双路径。
  - 验收：scratch 每层 unique==n、15 省贴父 ≤16.1°；真实缩进 15 变色/15 贴父/状态回显 → 撤销×2 逐位还原；行内 kidp=0/元素徽章0/元素胶囊0、图层侧全保留；tsc/svelte-check 0。
  - **坑**：① alreadyApplied 模式下新字段必须**手动写入世界**（只建 patches 忘写 r.color → 状态报「15 个随父配色」但颜色未变——探针 changedOnIndent=0 抓住）；② 检查区有两个 .ins 实例（图层在前），断言元素区必须按行作用域。
  - 基线：tsc 0 / svelte-check 0 errors（5 warning 存量）。

（第三十七轮 HIERARCHY 四包/EXPAND 包4/5-c/海陆案 A 记录见下）；在案链：`c4ba324` HIERARCHY 包1 → `1980fdc` 包2 → `268b307` 包3 → `b01c906` 包4 → `8ef38d6` EXPAND 包4 → `716e03f` 5-c 全量 → `fc8664e` 海陆案 A）

- **✓ 第三十七轮（2026-10-03 用户委托「把我没拍的全部做完」——四件全清）**：
  - **HIERARCHY 包1–4（D1–D8 全按推荐拍板并落地）**：包1 `c4ba324` hierarchy/{derive,gate,ops,policy} 四件+读档修复+DeleteLayer 链拼接+copy 成根+D3 锚点同源+**regionOps 整体溶解**（死路径删、测试迁 history/ops/gate 规则面）；包2 `1980fdc` 焦点整段叠放（derive.layerStackComparator 单源）+I6 effective 显隐+**D8 关=只写自身**（stash 像素 A/B 底0%/信号10%格状斑块）；包3 `268b307` units=层树派生（fromLayerId 三处退役）+拓扑级联替 CASCADE_ORDER（dependsOn 真消费、profiles 零迁移）+递归 regen——**全级联 serialize 哈希新旧逐位相等**；包4 `b01c906` 子元素逐跳（O1）+手动挂靠（D4，打分单源 bestParentAmong）。
  - **EXPAND 包4 `8ef38d6`**（L0 子层结构点，配置标随 D6 撤销）→ **EXPAND 五包全清**；**还债 5-c `716e03f`** 24 项纯转发下沉+selectElement 入 store+2 死 prop → **步骤 5 全清**。
  - **海陆案 A `fc8664e`（破坏性，-1171 行）**：产品级删 landsea——builtin/旧档清理（ensureBuiltinLayers 唯一入口）、landSea.ts+heightRegions.ts 整删、rebuild 十处调用链、拆海 manualSplit、**continentId 全链退役**（域外零读者）、piecePatch 队列机制删除；海色=底色+高度区间实测不变（12 区间出件）；旧档载入 14 层/87 实体清零；高度涂改真实路径 commit→undo 精确复原；scratch heightmap 12 区间+序列化回环幂等。
  - **验证教训**：① 合成笔画的 pointerup 必须派到**画布本体**（Viewport onpointerup → commitStroke），派 window 或走 Esc = endDraw 不提交、笔画悬空——回滚法=`drawCtl.heightStroke` 快照仍驻内存，按 {id,h} 逐格复原+清 paint 态即可精确还原；② 全严格档 tsc 扫 tests 有存量类型漂移（vitest 不做类型检查）——只对自己动过的测试文件认账。
  - 基线：tsc 0 / svelte-check 0 errors（5 warning 存量）。


## 遗留清单（按优先级）

1. ~~1-b~~ **已收口（第十八轮）**：路径✓（`43ff5d1`）/顺序✓/复制·删除·死码✓；判定残余=climate/astro（孤儿归步骤 7）、道路端点 `endpointOverrides`（region 域归 1-c 后核对→已随 1-c 收口记录）。
2. ~~1-c~~ **已收口（第十九轮）**：闭包清零、undo/redo 返回命令+store 类型分发；残余=Set/Map 载荷 JSON 编解码（历史面板持久化时补）+ ~~高度撤销 continentId 标签漂移~~（随海陆案 A 字段退役消解）。
3. 还债步骤 **1 ✓ / 2 ✓ / 3 ✓ / 4 ✓ / 5 ✓（第三十七轮 5-c 全量收口）/ 6 ◐（GL/2D 副本统一、borderCache rev 键两项缓发）**、步骤 7 ✓。
4. ~~两面板创建行共用 newName~~ **已拆**（第十二轮：各面板局部 text 独立过滤）；全局 newName 现只服务子级 CreateBox。
5. 同类 stale 潜力点按 view 快照模式逐步收编（DisplayStylePanel 内部直读 style 的模板等——见 ROADMAP_REFACTOR 已知问题表）。
6. **专属色/外交 = UI 已删、数据层 legacy 保留**：`Region.exclusiveColor`、`core/diplomacy.ts`、piece 传递与 AnnexCommand 重挂仍在（无 UI 入口；regionOps 已随 HIERARCHY 包1 溶解）——若要"概念彻底消失"需动渲染/序列化，待用户拍板再清。

## 验证方法论（本会话累积的坑，务必沿用）

- **给 svelte 内部打桩（冻结诊断）三层缓存坑**：① `.vite/deps/*.js` 是 immutable(`max-age=31536000`)——改输出文件浏览器永不重取；② vite 进程对 `?v=` URL 有内存态；③ `v=` 哈希由 lockfile 锚定、re-optimize 会弹回。**可行路径=改 svelte 源码 → rm `_metadata.json` → 重启 vite → 用全新 origin 端口（5176/5177…）**（内容哈希文件名会变，入口 client.js 名字不变所以必须换 origin）。**用完必须撤桩**：`npm install` 对已满足版本是 no-op，要 `rm -rf node_modules/svelte && npm install` 才真还原。
- **共享环形日志不能逐条驱逐**：`splice(0,N)` 会把计数污染成假象（曾把 PROC-OUT 全"删"成 0 误判挂起）——要么不截断、要么另设永不丢的计数器。
- **WebGL 上下文属性 = 首次 getContext 调用者决定**：任何 `canvas.getContext('webgl2')` 都必须由持有完整参数的创建方发起（renderer 首调）；探针/判活一律走 renderer.isLost() 或复用已有 context——无参 probe 曾把 stencil 打成 false（渲染错乱根因）。
- **像素 A/B 必须等沉降**：渐现/warm 期间画面持续变化（曾把 3.5s 时点的明暗差误判为代码差异；连续两张不为 0 = 未沉降）→ 采样前先「连续两张 diff=0」再对比；同理 `tab.screenshot()` 偶发 30s 超时 → 三次重试包装。
- **正则/字符串锚点别撞调用点**：给函数插代码时锚「函数定义」而非函数名（`touchLayerView()` 首个匹配是调用点 → 曾误植 scheduleAutosave 到别的函数）；插完必须 grep 落点逐个核对。
- **`$state.raw` 无深代理**：模板/派生直读其对象的可变属性（`layer.visible`/`region.name`…）**不被追踪**，中间派生输出同引用会截断失效链（身份换了也白换）→ 展示值一律走「rev+world 键控的快照派生（输出新对象）」；判定法=三态时序读（点前/点后/再点后 对比 数据值 与 界面文本 是否同步翻转）。
- **`locator.fill("")` 在本 runtime 不触发 input**（清空假象：value 不回写状态）→ 清空/设值用原生路径：`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(inp,v); inp.dispatchEvent(new Event('input',{bubbles:true}))`。
- **页面模块活实例探针**：`performance.getEntriesByType('resource')` 取带 `?t=` 的真实 URL 再 `new Function('u','return import(u)')(url)` ——直接拼裸 URL 会拿到**分裂的新实例**（world=null/plane=null 假阴性）；可读 `store.editor`、`viewMemory.plane.cam`（相机/对准的硬证据）。
- **像素对比验收**：`tab.screenshot()` PNG → `/tmp/pngutil.mjs`（zlib inflate+unfilter 解码）→ 网格采样量化4bit → diff%；遮掉左栏(x<330)/状态栏(y>650)；先测 diffStable=0 排除渲染噪声；合成 PointerEvent 可驱动右键内容平移（`canvas[1]`、button:2/buttons:2 序列）。
- **CUA scroll/domCuaScroll 本会话 30s 整体超时** → 测原生滚动用可信键盘：`locator.press('PageDown')`（CDP 真实键事件，触发滚动容器原生滚动，实测 0→220.5/0→126）。合成 `dispatchEvent(WheelEvent)` **不会**滚（untrusted 不触发默认行为）。
- **活性检测器必须与代码版本无关**：A/B stash 实验里用「创建行输入=过滤器」判冻结，在基线（搜索行未并入）上必假阳性——判定冻结用**模式胶囊切换**（任何版本都由状态驱动）。
- **Svelte 冻结诊断**：`const dyn=new Function('u','return import(u)'); const rt=await dyn('http://localhost:5173/node_modules/.vite/deps/runtime-*.js?v=...')` → 读导出 live binding `rt.n`（=active_reaction）、`ar.deps[].label`、`ar.deps[0].v.length`（数组长度可辨认是哪个列表）。
- **点击后必须断言生效**（如 `li.open .nm`）再进入下一步，否则整轮假阴性（顶峰未选中那次）。
- **git stash/pop 会触发 vite 整页重载**：`window.__errs` 等页面探针会丢，A/B 中段的「冻结/未冻结」读数可能被重载污染——判定前后先验探针存活。
- **evaluate 派发 `.click()` 可靠**；role=radio 的 BUTTON 走 Playwright click 会 actionability 超时（本项目胶囊/行按钮普遍）→ 一律 evaluate 派发。
- **CUA 组合键（Control+z）会整轮失灵** → 页内 `window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))` 直发，可靠。
- 状态栏文案在 `.pill .zone`（`.st` 不存在）；**error 会盖住 status**（隐藏层红字）→ 先开眼再验。
- `createRegion` 自动选中新元素 → 紧接着点行 = toggle 取消（单开互斥）→ 验证要探针式点到选中为止。
- 改名撤销的判定读**列表行文本**（EntityInfoBody 输入框是本地副本不随 undo 刷新，读它会误判）。
- 眼睛/行按钮常 **hover 才可见**（Playwright 可见性等待会超时）→ `evaluate` 派发 click。
- 元素行是**单层** `.ws .acc`（不是 `.acc .acc`）；聚焦在地块层时元素列表为空（空态提示=正常）。
- 改 `.svelte/.ts` 后 Edit 工具会因 mtime 报 "modified since read" → 重新 Read 再 Edit；**批量并行 Edit 可能吞掉主调用**（回执缺失）→ 执行后 grep 验证落盘。
- 验证批次开头要**记录当前模式/开合态**（reload 默认球面、面板开合持久化），否则断言全建在污染状态上。

## 交接纪律

1. 每次交付在"当前状态"追加一轮小节（≤15 行），并刷新在途/基线；**本文件 <150 行**，历史轮积 ~20 时整体剪到 `docs/history/HANDOFF_LOG_<日期>.md`。
2. 契约变更落 AGENTS（写日期+用户原话语义）；状态落 ROADMAP 系；交接只放轮次摘要与教训。
3. 交付说明 = 问题/原理/预期效果；整包交付；**不主动跑测试**；显示不打折；先根因后表现。

## 下一轮候选

- **新议题（2026-10-04，未开工）：元素名称注记与核心符号**——调研+需求细化已落 `docs/LABEL_DESIGN_2026-10-04.md`（现状盘点带 file:line / 外部调研带来源 / R1–R21 / **待拍板 P1–P12** / 分期五包），等用户拍板 P1–P12 再动代码。
- **拍板债全清（HIERARCHY D1–D8 ✓、海陆案 A ✓、EXPAND 五包 ✓、还债 5 ✓、O1/O2 ✓、手感批+金钮 ✓）**；**下一阶段重心 = 用户使用**——选题与排序见 `docs/OPTIMIZE_REVIEW_2026-10-04.md` §7（第一梯队=搜索/测距/吞并/校验 toast 四个半成品入口），点名即做；并行技术线=存档镜像离线程/死码甲档/存档字段清洗/测试固化（同文档 §3-§5）。路径生成 R7 用户已定先不做；路网 paths=0 待点名。
- 用户点名才动：功能包（比例尺/指南针/测量/搜索跳转/历史面板）；待复核：海陆案 A（产品级删层）、**全新父子层级系统设计 `docs/HIERARCHY_DESIGN_2026-10-02.md`（2026-10-02 交付，D1–D8 待拍板，吸收生成引擎包）**、专属色数据层清理。
