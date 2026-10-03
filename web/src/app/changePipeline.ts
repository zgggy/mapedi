/**
 * ChangePipeline（还债步骤 5-a，2026-10-01）：store 上帝模块的第一刀——
 * touch* 失效家族 + 高度派生 flush（原 store 内联 ~200 行）抽为独立可测模块。
 * 职责：**只管失效与派生**（rev/缓存/派生重建/补丁入队）+ 换 world 身份；
 * 不管持久化（scheduleAutosave 注入）、UI（notify 注入）、命令（history 不在此）。
 *
 * store 保留同名薄代理（门面），全部调用点零改动；$state 写入留在 store.svelte.ts
 * 内的 ctx 闭包中（Svelte 按声明文件编译状态写，跨文件赋值不触发响应）。
 */
import type { World } from '../core/types';
import { invalidateCellGrid } from '../core/index/cellGrid';
import { invalidateRegionIndex } from '../core/index/regionIndex';
import { bumpAllRev, bumpHeightRev, bumpRegionsRev } from '../core/rev';
import { materializeParentCells } from '../core/displayCompose';
import {
  updateHeightIntervalElements,
  rebuildHeightIntervalElements,
} from '../core/layer/heightElements';
import { queueHeightDelta } from '../render/patchQueues';

/** store 注入的宿主能力 */
export interface PipelineCtx {
  readonly world: World | null;
  /** 换 world 身份（$state 写入实现留在 store 内） */
  setWorld(w: World | null): void;
  notify(): void;
  scheduleAutosave(): void;
}

export class ChangePipeline {
  /** 高度提交：仅在拓扑变化时增量 rebuild 大陆/湖/海 */
  private paintFrame = 0;

  constructor(private ctx: PipelineCtx) {}

  private swapIdentity(): void {
    const w = this.ctx.world;
    this.ctx.setWorld(w ? { ...w } : w);
  }

  /** 几何/拓扑变化：全量失效（投影、拾取、索引、边界环） */
  touchWorld(): void {
    invalidateRegionIndex();
    invalidateCellGrid();
    // 手感批（2026-10-04）：不再全清投影/件环缓存——投影键含 seed/count/参数
    // 自失效（撒点才换）；成员 Δ 由渲染前 reconcilePieceMembership 自动补丁。
    // 全清曾导致下一帧数百毫秒重建 = 用户报的「整个界面闪一下」。
    bumpAllRev();
    this.swapIdentity();
    this.ctx.scheduleAutosave();
    this.ctx.notify();
  }

  /** 仅 Region 归属/排序/颜色：不重建投影/件环缓存（渲染前对账补丁接管） */
  touchRegions(): void {
    invalidateRegionIndex();
    bumpRegionsRev();
    materializeParentCells(this.ctx.world!);
    this.swapIdentity();
    this.ctx.scheduleAutosave();
    this.ctx.notify();
  }

  /** 仅视图/选中/UI：不失效几何缓存 */
  touchView(): void {
    this.ctx.notify();
  }

  /** 归属提交（增量）：bump data rev + 调用方标脏；不动静态贴图/边界缓存（rev 键自愈） */
  touchRegionsIncremental(): void {
    invalidateRegionIndex();
    bumpRegionsRev();
    materializeParentCells(this.ctx.world!);
    this.swapIdentity();
    this.ctx.scheduleAutosave();
    this.ctx.notify();
  }

  /** 视图态轻失效（显隐）：只换身份 + dataRev，件环/几何缓存不动 */
  touchLayerView(): void {
    bumpRegionsRev();
    this.swapIdentity();
    this.ctx.scheduleAutosave();
    this.ctx.notify();
  }

  /**
   * 高度笔刷的失效：**永不全清环缓存**（全清 = 下一帧重建所有可见件 = 秒级冻结）。
   * forward：tick 已增量维护高度件；undo：区间归属被反向套用而未打补丁 →
   * 走 flushHeightRegions 的 Δ 队列补丁。
   */
  touchHeight(_full = false): void {
    invalidateRegionIndex();
    invalidateCellGrid();
    // 件环**不删缓存**（删 = 内容消失 + 重暖风暴）：区间成员增减以 Δ 补丁
    // 落盘（pendingHeightDeltas），见 flushHeightRegions。
    bumpHeightRev();
    bumpRegionsRev();
    this.swapIdentity();
    this.ctx.scheduleAutosave();
    this.ctx.notify();
  }

  /** 笔画中每帧：防抖入存，每 3 帧换身份通知（热路径节流） */
  touchPaint(): void {
    invalidateRegionIndex();
    this.paintFrame++;
    this.ctx.scheduleAutosave();
    if (this.paintFrame % 3 === 0) {
      this.swapIdentity();
      this.ctx.notify();
    }
  }

  /** commit 后：区间归属一次重算（松手带 samples；否则全量）；Δ 交渲染侧打件环补丁 */
  flushHeightRegions(samples?: { id: number; h0: number; h1: number }[]): void {
    const world = this.ctx.world;
    if (!world) return;
    // 【绘制模型】区间归属只在松手时一次重算；Δ 交给渲染侧打件环补丁
    if (samples && samples.length) {
      const deltas = updateHeightIntervalElements(world, samples);
      for (const d of deltas) queueHeightDelta(d);
    } else {
      rebuildHeightIntervalElements(world);
    }
    bumpHeightRev();
  }
}
