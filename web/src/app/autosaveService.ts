/**
 * AutosaveService（还债步骤 5-b1，2026-10-01）：自动保存机械从 store 出库——
 * 2s 防抖定时器 + epoch 作废 + Worker 派发（busy/latest-wins）+ DataCloneError
 * 规范化重试 + 同步降级链 + drain 等待器。
 * 职责边界：只管「world → 存档字节」；作废/状态回显/路径平面化经 Ctx 注入。
 */
import type { World } from '../core/types';
import { serializeWorld } from '../core/world';
import { idbSave } from '../persist/storage';

export interface AutosaveCtx {
  readonly world: World | null;
  /** path.points 经 $state 深代理 → postMessage 必炸，克隆前平面化（store.snapPaths 单源） */
  snapPaths(w: World): NonNullable<World['paths']>;
  setAutosaveAt(v: string): void;
  setStatus(v: string): void;
}

export class AutosaveService {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private epoch = 0;
  private queue: Promise<void> = Promise.resolve();
  private worker: Worker | null = null;
  private workerDown = false;
  private busy = false;
  private queuedWorld: World | null = null;
  private waiters: (() => void)[] = [];

  constructor(private ctx: AutosaveCtx) {}

  /** 2s 防抖排队（touch* 家族统一入口；epoch+身份双闸作废过期触发） */
  schedule(): void {
    if (!this.ctx.world) return;
    clearTimeout(this.timer);
    const world = this.ctx.world;
    const epoch = this.epoch;
    this.timer = setTimeout(() => {
      if (epoch !== this.epoch || world !== this.ctx.world) return;
      this.dispatchSave(world);
    }, 2000);
  }

  /** 作废在途定时器（replaceWorld / clearAutosave） */
  invalidate(): void {
    clearTimeout(this.timer);
    this.epoch++;
  }

  /** 等待在途保存完成（clearAutosave 等场景） */
  drain(): Promise<void> {
    if (!this.busy) return Promise.resolve();
    return new Promise((res) => this.waiters.push(res));
  }

  /** 等待同步降级链排空 */
  drainQueue(): Promise<void> {
    return this.queue;
  }

  private releaseWaiters(): void {
    const ws = this.waiters;
    this.waiters = [];
    for (const w of ws) w();
  }

  private ensureWorker(): Worker | null {
    if (this.workerDown) return null;
    if (this.worker) return this.worker;
    try {
      const wk = new Worker(new URL('../persist/saveWorker.ts', import.meta.url), { type: 'module' });
      wk.onmessage = (e: MessageEvent<{ ok: boolean; error?: string }>) => {
        this.busy = false;
        if (e.data.ok) this.ctx.setAutosaveAt(new Date().toLocaleTimeString());
        else this.ctx.setStatus('自动保存失败，请导出项目备份');
        const next = this.queuedWorld;
        this.queuedWorld = null;
        if (next) this.dispatchSave(next);
        else this.releaseWaiters();
      };
      wk.onerror = () => {
        // Worker 级故障 → 降级同步链（保数据优先）+ 可见提示
        this.workerDown = true;
        this.busy = false;
        this.ctx.setStatus('自动保存 Worker 不可用，已降级本地保存');
        const next = this.queuedWorld;
        this.queuedWorld = null;
        this.releaseWaiters();
        if (next) void this.saveSync(next);
      };
      this.worker = wk;
      return wk;
    } catch {
      this.workerDown = true;
      return null;
    }
  }

  /** 派发保存：busy → 最新世界排队（latest-wins）；Worker 不可用/不可克隆 → 同步降级 */
  dispatchSave(world: World): void {
    const wk = this.ensureWorker();
    if (!wk) {
      void this.saveSync(world);
      return;
    }
    if (this.busy) {
      this.queuedWorld = world;
      return;
    }
    this.busy = true;
    try {
      wk.postMessage({ id: Date.now(), world });
    } catch (err) {
      // 常见：world.paths.points 混入 $state 代理 → 先规范化平面拷贝重试一次
      try {
        if (world.paths?.length) world.paths = this.ctx.snapPaths(world);
        wk.postMessage({ id: Date.now(), world });
        return;
      } catch {
        this.busy = false;
        this.workerDown = true;
        this.ctx.setStatus(`自动保存降级本地（${String(err).slice(0, 60)}）`);
        void this.saveSync(world);
      }
    }
  }

  /** 降级兜底：旧同步链（环境无 Worker / DataCloneError 时保数据） */
  private saveSync(world: World): void {
    this.queue = this.queue.then(async () => {
      try {
        await idbSave(serializeWorld(world, { stripSharedEdges: true }));
        this.ctx.setAutosaveAt(new Date().toLocaleTimeString());
      } catch {
        this.ctx.setStatus('自动保存失败，请导出项目备份');
      }
      this.releaseWaiters();
    });
  }
}
