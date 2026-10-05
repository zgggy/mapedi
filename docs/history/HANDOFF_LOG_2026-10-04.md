# HANDOFF 剪切日志（2026-10-04）

> 由 HANDOFF.md 第四十四轮交接时剪出（交接纪律：历史轮积超量整体剪到 docs/history/）。

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



## 剪切（2026-10-04 第四十八轮交接）

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




## 剪切（2026-10-04 第五十一轮交接：注记包4/图层重构两轮，详见 docs/LABEL_DESIGN_2026-10-04.md §4.5 与本文件前次剪切）



## 剪切（2026-10-04 第五十一轮二次修剪：注记包1-4/父笔刷/优化盘点六轮，正文见 docs/LABEL_DESIGN_2026-10-04.md §4.5、docs/OPTIMIZE_REVIEW_2026-10-04.md 与本文件前次剪切）

- **✓ 第四十八轮（2026-10-04 注记包4：沿轴重复 + 逐字弯曲）**：`labelPlace` 加 PCA 主轴/长宽比/中轴折线（`radiusAt` 取法向最宽处、弧长 `spineAt`，狭长≥2.5 才建、随 proj|件键缓存）+ `fitsRot`（与 `fits` 同 16 点 BOX_U，只是逐点先旋转）；布局三模式按 **重复>弯曲>水平**（`pickLabelLayout`：repeat=沿中轴节点、间距≥文字宽+余量、≥2 成功；curve=整串弧长排开、相邻字转角滑动窗口≤25°、投影角>90°即拒、逐字 fitsRot）；渲染屏幕角=toScreen 两点 atan2（吸收投影形变/y 翻转），逐字模式 letterSpacing 临时归零，屏幕角归一 (-90°,90°] 防倒置。**坑**：PCA 必须截断 `virtualFrom` 之后的**框补段**（否则主轴被人工框边拉飞→普通元素误判狭长）。**验收**：经纬度独立核算 罗马7.3/丙州7.25/埃及横圈 vs PCA6.3/4.39/2.54 ✓；flat7/repeat6/curve1、规则0违规、|angle|≤42、**反选13/13**（含旋转16°/弯曲-13°）、drawMs 7–9ms（labelMs4–6，60fps 内）、零错误。**留白**=几何排布与碰撞拆分缓存（labelMs 1.2→6ms 主因，预算够用暂不做）。tsc 0 / svelte-check 0 errors。

- **✓ 第四十七轮（2026-10-04 注记包3：核心符号族 + 核心地块选取）**：`CoreSymbol` 扩五种（★国家首都/☆省会/⊙文化宗教中心/方/圆），尺寸随字号（0.5·0.35·0.3·0.28×字号 ×主题 scale，占位盒与实绘同源）；内置预设 + `ensureBuiltinLayers` 回填旧档；**档位显式预设修正包2缺口**（文化/宗教=tertiary、次级层=minor——深度推导会让顶层语义层拿国家级排版）；`core/regionCenter.ts` 单源搬迁 `selectCoreCell` + 新 **visualCenter**（Voronoi 边种子 |pq|/2 + 多源 Dijkstra，mercator 投影无关），国家/行省生成默认改用它；检查区「📍 视觉中心 / 📍 点选」两入口（点选=模态，画布单击设核心、Esc 取消）。**顺修两根因**：① 双真相收敛——删 `Region.coreCellId` 别名（`SetCenterCommand` 写 centerCellId 而渲染读 coreCellId ⇒ 设中心从不生效）+ 删 `brush.setCenter` 死导出；② 半成品 `setCenterAt` 的 `touchWorld`（闪屏）→ 收进 `commandService.setCoreCell` 用 `touchRegions`。**验收**：符号像素实测（star 亮4→47 中心亮、hollowStar 中心=元素色、ring 中心=亮圆心）、设中心三断言+按钮 DOM、生成默认读数；**坑=先填充后描边会吞掉细长形状的填充**（星只剩 4 亮像素）。tsc 0 / svelte-check 0 errors。

- **✓ 第四十六轮（2026-10-04 注记包2：层级样式与父子区分 + 中英并重）**：新增 `core/layer/labelStyle.ts` 排版单源——四档表（15/13/12/10px、字重 600/500/400、字距 0.16/0.10/0.05/0.02em、α1/.9/.8/.68、minScale 55/75/95/125），档位= `labelTier` ?? **按层深度**（与叠放/优先级同树）；**中英并重**：拉丁大写+疏排（`toUpperCase`，汉字原样）、中文靠字号/字重/字距/灰阶（不用斜体），字体栈随主题（Helvetica+PingFang / Georgia+宋体 / SF Mono+等宽）；R14 缩放阶梯 = 名称按档 minScale、**符号=门槛+20 先消失**、cell 级装饰留 90 地板；LayerDef 新增 `labelTier/labelMinScale/labelSize`（UI 归包5）；**收编** `StyleSet.labels` country/city/continent/biome 12 个死 FontSpec（只留 default）。**验收**：档位推导对、letterSpacing 实测（EN +12px/CJK +4.8px）、`dynasty→DYNASTY` 且在面内、scale50 全拦 / scale60 仅 primary（secondary 被门槛过滤）/ 180 齐出、syms 随缩放归零、collide=0、注记段 0.6–1.2ms。**坑**：`$state` 深改字段不重绘（验证要戳一帧）；缩太小 fit 先于门槛接管（放不下就不画=面积下限惯例）。tsc 0 / svelte-check 0 errors。

- **✓ 第四十五轮（2026-10-04 注记议题开工 → 包1「放置与可读性」交付）**：按 `docs/LABEL_DESIGN_2026-10-04.md`（P1–P12 推荐即授权）做包1——新增 `core/ring/labelPlace.ts`（吃实绘环、evenodd 同源、chamfer 距离场取最宽候选、`d` 为可靠下界做免奇偶快判）+ 装饰层重构（跨层碰撞网格、逐候选轮换、放不下省略不缩字号、放置优先级=焦点层→层深→列表序、halo=字号/4、多片取最大片、冷件随渐现）。**验收**：×1 省略14/放置13 → ×3 省略1；点标签反选命中本元素 17/17；注记段 1.2–3.5ms/帧（`__labelMs`、`__labelStat` 帧令牌=`__drawCount`）。**坑**：装饰层按世界副本逐 pass 重入 → 帧级统计必须按帧号累加；视口 `vT`=世界 y 上边界（反写=全判视口外）。包2–包5 待开工；tsc 0 / svelte-check 0 errors。

- **✓ 第四十四轮（2026-10-04 用户两件：父笔刷纳入子元素 + 开始/结束/改半径仍重绘、半径回默认）**：
  - **① 父笔刷纳入子元素（未提交改动收尾）**：父会话中笔刷命中子层元素 → (a) 不在本父之下的（孤儿/他国）`reparentElement` 纳入本父（闸复核，闸拒者既不纳入也不作目标）；(b) 笔画目标切到**命中最多**的子元素、`draw.parentRegionId` 指向它 = 地图金框高亮 + 后续笔画经 parentRegionId 稳定画进它。换父以 `MultiRegionCommand.parentFlips` 随笔画**一条命令**撤销（仅换父、无成员变化的笔画也入栈）。
  - **② 重绘+半径回默认 = 会话目标与选中分叉**：父会话被画的是**子**元素，旧码把 `selectedRegionId` 改成子 → App C1 推导 effect 判「换目标」→ 每笔 `endDraw(touchWorld)` + `startDraw` 重启；`touchWorld=bumpAllRev` 使 **geomRev++ 换键 = 全件环重建**（实测 endDraw→4 件/67ms，即「整个界面重绘一下」），`emptyDrawSession()` 又把半径打回 1.5。修：绘制**不改选中**（C1 不变量：会话目标 ≡ 选中元素，高亮归 parentRegionId）、`endDraw` 只 `notify()`（纯 UI 态不碰几何）、`startDraw/startHeightDraw` **跨会话保留 radiusDeg**（1.5 仅出厂默认）。
  - **验收（页内直测真实入口 editor.*）**：Esc 后 `world` 对象引用不变（= 未走 touchWorld）、半径 4 保留、重进会话仍 4；纳入 province-1 父「罗马→华夏」、parentRegionId=该子、sel/target 纹丝不动、撤销逐位还原（换父+成员一并）；含 steal 的成员笔画零会话重启。tsc 0 / svelte-check 0 errors（5 warning 存量）；**按红线未主动跑 vitest**。

（第四十三轮优化盘点记录见下）；在案链：

- **✓ 第四十三轮（2026-10-04 全面优化盘点 → 用户使用阶段转向）**：
  - 交付 `docs/OPTIMIZE_REVIEW_2026-10-04.md`（快照冻结）：§1 手感残余（autosave clone 抖动居首）、§2 性能（p50 1.1ms 基线+微分配行号）、§3 死码三档（甲=可立即删双零清单；乙=tests-only 迁移；丙=保留）、§4 存档（无字段白名单/无版本迁移/空 catch）、§5 测试覆盖（68/107 src 零覆盖+固化顺序）、§6 **半成品入口清单**（搜索/测距/吞并/洪水/设中心=引擎全有只缺按钮）、§7 用户阶段三梯队排序建议。
  - 用户定调：**下一阶段重心 = 用户使用**；§7 为顺序建议（点名即做，不催拍板）。

（第四十二轮金钮记录见下）；在案链：

