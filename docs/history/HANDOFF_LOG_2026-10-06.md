# HANDOFF 历史日志（2026-10-06 剪切：第三十七~三十九轮，2026-10-03/04）

> 自 `HANDOFF.md` 按交接纪律剪切归档（本体只留最近轮次）。考古用，禁当现行实现依据。

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
