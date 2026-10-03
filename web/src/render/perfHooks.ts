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
}
