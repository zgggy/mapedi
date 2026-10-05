/**
 * 渲染性能/调试钩子的**唯一声明点**（2026-10-03 as-unknown 收敛包）：
 * 帧计时、段采样、GPU 错误等 dev 观测字段挂 globalThis——写在渲染咽喉点，
 * 验收/回归脚本与控制台直读。此前各处 `globalThis as unknown as {...}` 逐点强转，
 * 现集中声明为全局 var，消费点裸名直写、零强转。
 * 本模块仅类型声明（declare global 只给类型、**不产生运行时绑定**）——消费点一律
 * `globalThis.__x` 属性访问（裸名赋值会 ReferenceError，2026-10-03 已踩）。
 */
export {};

declare global {
  /** 休息段耗时（ms，最新值） */
  var __restMs: number | undefined;
  /** 休息段耗时环形样本 */
  var __restSeg: number[] | undefined;
  /** 帧耗时（ms，最新值） */
  var __drawMs: number | undefined;
  /** 帧耗时环形样本 */
  var __drawSamples: number[] | undefined;
  /** 帧计数 */
  var __drawCount: number | undefined;
  /** GL 错误收集 */
  var __gpuErr: string[] | undefined;
  /** GL 参数提交耗时（最新值） */
  var __glParamsMs: number | undefined;
  /** GL 绘制提交耗时（最新值） */
  var __glSubmitMs: number | undefined;
  /** GL 段耗时环形样本 */
  var __glSeg: { params: number; submit: number }[] | undefined;
  /** GPU 整帧耗时（最新值） */
  var __gpuMs: number | undefined;
  /** GPU 帧计数 */
  var __gpuRan: number | undefined;
  /** 渲染前成员对账补丁数（手感批 2026-10-04：替代全清的 Δ 补丁计数） */
  var __reconcileN: number | undefined;
  /** 金钮看门狗观测（模式胶囊卡死自归位，2026-10-04 手感批二） */
  var __knobV: { n: number; snap: number; last: string; eff?: number } | undefined;
  /** 注记段单帧耗时（ms，含逐副本 pass；帧令牌见 __labelStat.frame） */
  var __labelMs: number | undefined;
  /** 注记放置观测（包1 面内放置：最新一帧 placed=画出的名称数 / hid=放不下或被遮挡省略数） */
  var __labelStat:
    | {
        /** 帧令牌（= __drawCount，装饰层逐副本重入的合并键） */
        frame: number;
        placed: number;
        hid: number;
        noPiece: number;
        cold: number;
        off: number;
        /** 已放置项（name + 屏幕坐标）：验收/回归读数 */
        items?: { id: string; name: string; tier: string; mode: string; angle: number; el: number; n: number; ls: number; sx: number; sy: number }[];
        /** 视口盒 [vL,vR,vB,vT]（世界 y 向上） */
        view?: number[];
        /** 本帧核心符号数（各副本 pass 累加，R14 验收读数） */
        syms?: number;
        /** 自定义地块标记数（包5 验收读数） */
        marks?: number;
        /** 符号读数：形状 + 屏幕坐标 + 视觉半径（像素级验收用，封顶16） */
        symbols?: { sym: string; sx: number; sy: number; r: number }[];
        /** 放置几何构建归因：gate=冷件闸 / empty=环解析不出 / built=建成 */
        geom?: { gate: number; empty: number; built: number };
      }
    | undefined;
}
