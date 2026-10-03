# Mapedi 交接（给下一轮 AI）

工作目录 `/Users/zgy/mapedi`，应用 `web/`（Svelte 5 + TS + GL 直绘，100k cell）。**工作区干净；git log 头 = 金钮动画+看门狗（`c14c764`）。**

## 先读

1. `AGENTS.md` — 协作规则与红线（六层定位模型、根因流程、硬规则、测试纪律、文档分层 §9）
2. `RENDER_LOGIC.md` — 显示契约与模块边界
3. `ROADMAP_REFACTOR.md` — 还债路线与已知问题（含证据行号）；产品缺口 → `ROADMAP.md`
4. `docs/ARCH_REVIEW_2026-09-29.md` — 全库评审快照（还债排序依据）
5. `docs/UI_REFACTOR_2026-09-29.md` — UI 九轮迭代规格与决策记录（§9 两表 D/C/E 系拍板 + 第十轮语义解析标注）

`docs/_archive/`、`docs/history/`（59 轮旧日志）**禁止当实现依据**。**注意**：投影动画/模式切换有并发会话线，接手前先 `git log`。


## 当前状态（第四十二轮完成；在案：`c14c764` 金钮动画+看门狗）

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


- **✓ 第三十六轮（2026-10-03 用户报障修复 + HIERARCHY O2）**：
  - **地形网格挤压（包3 引入的真 bug）**：山脉/细节/海床三格滑块被压成 2px 横线——根因=`.tcell` 列向 flex 格里 `.cap` 是 `flex:1 1 0%`（**basis 0 不计容器固有高度**），中间行三格全滑块 → 行高只剩标签 16px；有数字输入格的行被抬到 40px 才掩盖。修=`.cap` 改 `flex:1 1 auto`（行向仍靠 grow 填满=视觉不变，列向恢复固有高），组件级一处修全。**全库扫描**（生成三分支/检查四态/绘制/组织/⚙弹层）压扁+裁切控件 = 0（`56574f9`）。
  - **O2 树遍历单源（`7622abe`）**：`core/layer/tree.ts` = `layerTreeOf`（前序 DFS 一次产 parentId/depth/**chain 面包屑**）+ `childLayerIdOf`（首子层）；收编 layerDisplayList / LayersPanel.rows / chainOf（删）/ regionOps.childLayerIdOf（删定义，WD+内部 5 处+store+brush 换源）。**验收**：旧算法内联逐位对照（15 层顺序 equal、chain 零失配）、组织缩进 0→14px→撤销回 0（parent=null、已撤销）、lastError 空；tsc/svelte-check 0。
  - 基线：tsc 0 / svelte-check 0 errors（5 warning 存量）。

- **✓ 第三十五轮（2026-10-03 EXPAND 包3+包5 收口）**：
  - **包3 生成与绘制整理（`2333f9f`）**：分支头 `.bhead`（🎲撒点/⛰️地形/🧩布局+动作名）、`.tgrid` 地形 3 列网格（大陆占比 wide 通栏 ModeCapsule+9 格）、**活空态**（去 `canGen` 渲染闸→面板恒开、fire 仍守门；无配置 hint=「到检查模式给『X』设置参数后再回来」）、R7 freeform 虚线徽章（App 传 `freeform`/`strategy`）；四分支头/徽章/指引全部实测命中。
  - **包5 视觉 tokens（`d3c0953`）**：:root `--fs-xs/sm/md`、`--sp-1..5`、`--r-1..4/--r-pill` 一张表；**20 文件等值替换**（值不变=零视觉变化策略；双值 shorthand 按轴保留原值、3/4/5/11/13 异形角不入表）；tsc/svelte-check 0；布局指标逐位（insH=222、fs=11px）；stash A/B 匹配协议对拍 **rail/topbar 像素 0.0%**。
  - **验证教训（新坑，重要）**：首轮回对拍出「map-center 89%」假警报→根因=**渐现暖机的负载相关进度差**：同码同协议 4s×2=0% 但 8s×2=50%、同码 4s vs 8s=50%——**stash A/B 抓帧必须 ①vite 平静（stash/pop 后 sleep）②同沉降时长 ③先做同码对拍取噪声底**；顶栏/状态栏的「差异」=半透明面板透画布，跟着画布差走，不是 CSS 差。
  - 进度：**EXPAND 包1✓ 2✓ 3✓ 4◐（👁已落 `d452d62`，余配置态/子层点）5✓**；还债 1✓ 2✓ 3✓ 4✓ 5◐（剩 5-c shell ~35 转发）6◐ 7✓。

- **✓ 第三十四轮（2026-10-03 步骤7 转包③：as-unknown 收敛，三小包全清）**：
  - src 域 **25→0（grep 归零）**，六模式：①缓存键定型（WeakMap<object>→MidRing[]/DisplayRing/ProjCache，layers·triangulate·geometry·mapRenderer）②`DisplayRing extends MidRing` 协变→triangulate 桥接强转直删 ③RegionIndex 增 `reset()` 替代外部戳私有四连转 ④性能钩子集中声明 `render/perfHooks.ts`（**declare global 只给类型、裸名赋值 ReferenceError 已踩**→消费点一律 `globalThis.__x`）⑤paths 迁移显式构造（...raw 保未知字段）⑥worker 双文件 reference-lib 化（`self.postMessage(msg, transfer)` 直用）；另修 WD `onSelect(null)`、commandService Snap 直索引。
  - 验收：tsc/svelte-check 0；平面实测钩子 drawCount/gpuRan 跳动、gpuErr 空、lastError 空；tests 域余 2 处（造 mock 夹具保留，域外）。
  - **总进度：1✓ 2✓ 3✓ 4✓ 5◐（剩 5-c shell 协调）6◐ 7✓**。


- **◐ 第二十八轮（2026-10-01，还债 5-c 首批：App 转发器瘦身）**：
  - **审计**：双向比对 39 个 on* 赋值**零死转发**（前轮已清 canPaint/onMoveLayer 类）。
  - **首批三件（不碰 shell prop 面）**：① Viewport 四纯转发下沉（paint/radius/endpoint/strokeend → 直调 editor，路径编辑同先例）——真指针笔画验收：61→撤销精确回 10、栈 1；alt+滚轮 1.5→1.65；② `organize` 下沉 CommandService+门面（indent 翻转+回弹 ✓）；③ 死 CSS `.gen-pending` 删。App 532→509、Viewport 1437→1423、tsc/svelte-check 0。
  - **☐ 剩余 ~35 个 shell 转发待 UI 重构线协调**：TopBar 12（rename/export/import/style/projection/globe×5/switchView…）、WorkspaceDrawer 11、LayersPanel 7、GenerateSection 4、LeftRail 4——**勿单方面删改**；届时按「组件直连 editor 或收进 UI 状态模块」两路处理。
  - 子包进度：5-a ✓ 5-b1~5-b5 ✓ **5-c ◐（首批）** / 步骤 7 ☐。

- **✓ 第二十七轮（2026-10-01，还债 5-b5：CommandService 命令 CRUD 出库）**：
  - `app/commandService.ts`（814 行）：undo/redo+类型分发/删·复制·吞并/图层树缩进·提升·移序/样式·显隐·透明度/路径快照执行器+拖动会话/字段快照执行器/新建·重命名·换色全量出库——**方法体原样搬运**（`this.*` 经类内代理映射 Ctx，零改写，diff 安全）；选中类留 store（App 直连）。store **2045→888**。
  - **验收（八组门面回归）**：建层/元素复制/删除层/缩进提升/显隐/样式/withPaths/patchRegions 全经 facade 生效+撤销回滚；样式真值 border.width 0.8→4.2→0.8；栈归零、IDB 15 层清净（测试层无残留）、零 console 错；tsc/svelte-check 0、孤儿 import 29 项清。
  - **验证教训（入 quirks）**：undo 换 world 身份后**数组长度断言读旧引用=假阴**（曾把八组里六组误判失败）——对象字段级断言 + `history.depth` 栈计数 + IDB 实读三口径才可信。
  - 子包进度：5-a ✓ 5-b1 ✓ 5-b2 ✓ 5-b3 ✓ 反馈四件 ✓ 5-b4 ✓ **5-b5 ✓** / 5-c App 回调瘦身 ☐ / 步骤 7 ☐。

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

- **拍板债全清（HIERARCHY D1–D8 ✓、海陆案 A ✓、EXPAND 五包 ✓、还债 5 ✓、O1/O2 ✓）**；下一步只剩用户点名：功能包（比例尺/指南针/测量/搜索跳转/历史面板）、100k 性能与绘制会话回归验收、路径生成 R7（明示先不做）。
- 用户点名才动：功能包（比例尺/指南针/测量/搜索跳转/历史面板）；待复核：海陆案 A（产品级删层）、**全新父子层级系统设计 `docs/HIERARCHY_DESIGN_2026-10-02.md`（2026-10-02 交付，D1–D8 待拍板，吸收生成引擎包）**、专属色数据层清理。
