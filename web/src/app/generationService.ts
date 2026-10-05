/**
 * GenerationService（还债步骤 5-b2，2026-10-01）：世界生成编排从 store 出库——
 * 整链 Worker（失败回主线程）+ 单层再生成 + 生成参数（profiles/worldShape/预设/开关）。
 * 职责边界：生成编排与参数状态；世界替换（replaceWorld 的 UI 重置）、进度/状态回显、
 * 草稿持久化、自动保存经 Ctx 注入（$state 写仍留 store 文件内闭包）。
 *
 * 世代序 `seq` 与 tryRestore/importProjectFile **共享**（任何换世界的异步操作互斥过期闸）。
 */
import type { World } from '../core/types';
import { createWorld, HARD_MAX_DENSITY, builtinLayers } from '../core/world';
import { genStrategyOf, heightmapLayerId } from '../core/layer/flags';
import { runCascade, generatorFor } from '../core/generate/registry';
import { childLayerIdOf } from '../core/hierarchy/derive';
import { generateWorldAsync } from '../core/generate/runGenerate';
import { cascadeEnabled, type GenerationProfile } from '../core/generate/profile';
import { defaultStarSystem } from '../core/astro';
import { DEFAULT_WORLD_SHAPE, type WorldShape } from '../core/layer/genTypes';
import { installProjCache } from '../render/projCache';
import { refineHeight } from '../core/generate/refine';
import { HeightCellsCommand, history } from '../core/history';

export interface GenerationCtx {
  readonly world: World | null;
  /** 世代序：取当前值（与 tryRestore/import 共享） */
  readonly seq: number;
  /** 世代序自增（新操作作废旧操作） */
  nextSeq(): number;
  /** 换世界（store.replaceWorld：清历史/选中/焦点、epoch 重置） */
  replaceWorld(w: World): void;
  get profiles(): GenerationProfile[];
  setProfiles(p: GenerationProfile[]): void;
  setFocusLayer(v: string): void;
  setStatus(v: string): void;
  setGenerating(v: boolean): void;
  setGenProgress(v: number): void;
  notify(): void;
  scheduleAutosave(): void;
  touchWorld(): void;
  saveGenDraftSoon(): void;
  /** 高度派生数据重算（flushHeightRegions：区间元素按新 cell.height 重物化） */
  flushHeightRegions?(samples?: { id: number; h0: number; h1: number }[]): void;
  /** 清除工作区选中（生成清除规则会删掉选中元素所属内容，2026-10-06） */
  clearSelection?(): void;
}

export class GenerationService {
  constructor(private ctx: GenerationCtx) {}

  async generate(seed: number, count: number, opts?: { cellsOnly?: boolean }): Promise<void> {
    const seq = this.ctx.nextSeq();
    const cellsOnly = opts?.cellsOnly ?? false;
    // 硬上限唯一钳制点（core/world.HARD_MAX_DENSITY）；软上限解锁是 UI 策略，不在生成链
    const n = Math.max(100, Math.min(count, HARD_MAX_DENSITY));
    this.ctx.setGenerating(true);
    this.ctx.setGenProgress(0);
    this.ctx.setStatus(`生成中… ${n} 地块`);
    this.ctx.notify();
    try {
      // P1：整链 Worker（主线程不冻）；失败再退回主线程
      await this.generateViaWorker(seed, n, seq, cellsOnly);
      if (seq !== this.ctx.seq) return;
      this.ctx.setGenerating(false);
      this.ctx.setGenProgress(100);
      this.ctx.notify();
    } catch (e) {
      // 回退可见：Worker 失败不许无声（吞错=护栏反模式）
      console.warn('[gen] Worker 失败，回退主线程', e);
      if (seq !== this.ctx.seq) return;
      try {
        await this.generateOnMain(seed, n, false, seq, cellsOnly);
        if (seq !== this.ctx.seq) return;
        this.ctx.setGenerating(false);
        this.ctx.setGenProgress(100);
        this.ctx.notify();
      } catch (e) {
        this.ctx.setStatus(`生成失败 ${e}`);
        this.ctx.setGenerating(false);
        this.ctx.notify();
      }
    }
  }

  private async generateViaWorker(
    seed: number,
    count: number,
    seq: number,
    cellsOnly = false,
  ): Promise<void> {
    this.ctx.setStatus(`生成中（Worker）… ${count} 地块`);
    this.ctx.notify();
    // profile 面板参数随 Worker 下发（否则面板旋钮只在主线程回退路径生效）。
    // **必须展开成平面对象**：profiles 住在 ui=$state 深代理里，代理不可 structuredClone
    // → postMessage 必抛 DataCloneError（预存静默缺陷：旧 catch 无声回退主线程，本轮 console.warn 才暴露）。
    const params: Record<string, Record<string, number | string | boolean>> = {};
    for (const p of this.ctx.profiles) params[p.layerId] = { ...p.params };
    const got = await generateWorldAsync(
      seed,
      count,
      (p) => {
        if (seq !== this.ctx.seq) return;
        this.ctx.setGenProgress(p.progress);
        this.ctx.setStatus(`${p.label}… ${p.progress}%`);
        this.ctx.notify();
      },
      params,
      // 撒点=仅地块（2026-10-06 用户定）：白名单空 = 跳过全部生成器（不生成高度图）
      cellsOnly ? [] : undefined,
    );
    if (seq !== this.ctx.seq) return;
    const world = got.world;
    if (got.projCache) installProjCache(got.projCache);
    world.astro = defaultStarSystem(seed, world.climate);
    this.ctx.replaceWorld(world);
    if (cellsOnly) {
      // 撒点=仅地块：新世界 = cells + 空内置层（其他图层/自定义层/路径已清除）→ 焦点回地块
      const cl = world.layers.find((l) => l.baseMesh) ?? world.layers[0];
      cl.visible = true;
      this.ctx.setFocusLayer(cl.id);
      this.ctx.setStatus(`${world.cells.length} 地块（仅撒点，其余图层已清除）`);
    } else {
      // 产品默认（AGENTS §6）：生成 → focusAfterGen 层（height）显示并成为焦点
      const fg = world.layers.find((l) => l.focusAfterGen)!;
      fg.visible = true;
      this.ctx.setFocusLayer(fg.id);
      this.ctx.setStatus(`${world.cells.length} 地块 · Worker`);
    }
    this.ctx.scheduleAutosave();
    this.ctx.notify();
  }

  private async generateOnMain(
    seed: number,
    count: number,
    quiet = false,
    seq = this.ctx.seq,
    cellsOnly = false,
  ): Promise<void> {
    const t0 = performance.now();
    // 让浏览器先绘制一次 loading
    await new Promise((r) => setTimeout(r, 0));
    if (seq !== this.ctx.seq) return;
    const world = createWorld({ seed, count });
    const params: Record<string, Record<string, number | string | boolean>> = {};
    for (const p of this.ctx.profiles) params[p.layerId] = { ...p.params }; // 平面化（与 Worker 路径同规则）
    const enabled = cellsOnly ? new Set<string>() : new Set(cascadeEnabled(this.ctx.profiles));
    runCascade(world, seed, undefined, undefined, params, enabled);
    world.astro = defaultStarSystem(seed, world.climate);
    if (seq !== this.ctx.seq) return;
    this.ctx.replaceWorld(world);
    if (cellsOnly) {
      const cl = world.layers.find((l) => l.baseMesh) ?? world.layers[0];
      cl.visible = true;
      this.ctx.setFocusLayer(cl.id);
    } else {
      // 产品默认（AGENTS §6）：生成 → focusAfterGen 层（height）显示并成为焦点
      const fg = world.layers.find((l) => l.focusAfterGen)!;
      fg.visible = true;
      this.ctx.setFocusLayer(fg.id);
    }
    const ms = Math.round(performance.now() - t0);
    if (!quiet) this.ctx.setStatus(`${world.cells.length} 地块 · ${ms}ms`);
    this.ctx.scheduleAutosave();
    this.ctx.notify();
  }

  /**
   * 基于已有高度图细化（2026-10-06 用户拍板 1b）：不重新生成——用户绘制的粗高度图
   * 走 refineHeight（同侧扩散梯度化 + fbm/ridged 细节 + 侧 clamp），**海陆 mask 不变**、
   * 档间长出中间层；细节量/山脉强度 = 地形旋钮两个（shape.detail/shape.mountain）。
   * 快照→变更→HeightCellsCommand 入栈（可撤销）→ flushHeightRegions 重物化区间元素。
   */
  refineHeightLayer(detail: number, mountain: number, seed?: number): void {
    const world = this.ctx.world;
    if (!world) return;
    const s = Number.isFinite(seed) ? (seed as number) : world.meta.seed;
    const snap = world.cells.map((c) => c.height);
    const changed = refineHeight(world, { seed: s, detail, mountain });
    if (!changed) {
      this.ctx.setStatus('已有高度图无可细化内容（先绘制高度或调大细节量）');
      this.ctx.notify();
      return;
    }
    const samples: { id: number; h0: number; h1: number }[] = [];
    for (const c of world.cells) {
      if (c.height !== snap[c.id]) samples.push({ id: c.id, h0: snap[c.id], h1: c.height });
    }
    history.run(world, new HeightCellsCommand(samples, '基于已有细化'), { alreadyApplied: true });
    this.ctx.flushHeightRegions?.(samples);
    this.ctx.touchWorld();
    this.ctx.setStatus(`已基于已有高度图细化 · 种子 ${s} · ${samples.length} 格`);
    this.ctx.scheduleAutosave();
    this.ctx.notify();
  }

  regenLayer(layerId: string, seed?: number, cascadeDown = false): void {
    const world = this.ctx.world;
    if (!world) return;
    // 种子（2026-10-04 用户报障）：UI 种子行/🎲 直传；不传或非法 = 世界种子（旧行为）。
    const s = Number.isFinite(seed) ? (seed as number) : world.meta.seed;
    // R2 递归（HIERARCHY §6.3 包3）：先确保单元源（子层）可用——
    // 无元素 → 递归生成（孙层优先），再生成本层；有元素则不重算（非破坏）。
    this.ensureUnitsReady(layerId, s);
    // **级联重生成**（用户 2026-10-04「同时生成子元素」开关）：勾选后把
    // 「最深子层 → … → 直接子层 → 本层」整条链逐层重生成（**子先父后**：父层聚合子层
    // 为单元源，顺序反了会用上一代子元素聚合）。层树是链（每层≤1子），沿 childLayerId 走到叶。
    const chain: string[] = [];
    if (cascadeDown) {
      let cur = childLayerIdOf(world, layerId);
      const seen = new Set<string>([layerId]);
      while (cur && !seen.has(cur)) {
        seen.add(cur);
        chain.unshift(cur);
        cur = childLayerIdOf(world, cur);
      }
    }
    chain.push(layerId);
    for (const id of chain) {
      const params = this.ctx.profiles.find((p) => p.layerId === id)?.params;
      runCascade(world, s, [id], undefined, params ? { [id]: params } : undefined, new Set([id]));
    }
    // 清除规则（2026-10-06 用户定）：
    // - 高度重生成 → 清除**地块+高度以外**全部图层内容；
    // - 子层重生成 → 清除**父层链**（父层聚合子层为单元源，子层重生成后父层内容全部失效）。
    // 清内容**不清壳**：图层定义保留（列表不消失、可再次生成）；路径按 layerId 一并清。
    const clearIds = new Set<string>();
    if (heightmapLayerId(world.layers) === layerId) {
      for (const l of world.layers) {
        if (l.id !== 'cells' && l.id !== layerId) clearIds.add(l.id);
      }
    } else {
      let pid = world.layers.find((l) => l.id === layerId)?.parentLayerId;
      const seen = new Set<string>([layerId]);
      while (pid && !seen.has(pid)) {
        seen.add(pid);
        clearIds.add(pid);
        pid = world.layers.find((l) => l.id === pid)?.parentLayerId;
      }
    }
    let clearedRegions = 0;
    if (clearIds.size) {
      const before = world.regions.length;
      world.regions = world.regions.filter((r) => !clearIds.has(r.layerId));
      world.paths = (world.paths ?? []).filter((pt) => !clearIds.has(pt.layerId));
      clearedRegions = before - world.regions.length;
      this.ctx.clearSelection?.();
    }
    this.ctx.touchWorld();
    // focusAfterGen 层（height）重生成后默认显示并聚焦（与整世界生成同规则）
    const fg = world.layers.find((l) => l.id === layerId && l.focusAfterGen);
    if (fg) {
      fg.visible = true;
      this.ctx.setFocusLayer(fg.id);
    }
    const base = cascadeDown && chain.length > 1
      ? `已级联重新生成 ${chain.length} 层（子先父后）：${chain.join(' → ')} · 种子 ${s}`
      : `已重新生成：${layerId} · 种子 ${s}`;
    this.ctx.setStatus(
      clearIds.size
        ? `${base} · 已清除 ${clearIds.size} 个图层内容（${clearedRegions} 元素）`
        : base,
    );
  }

  /** 单元源兜底（R2）：childLayer 无元素 → 先递归生成子层链（自底向上） */
  private ensureUnitsReady(layerId: string, seed: number): void {
    const world = this.ctx.world;
    if (!world) return;
    const child = childLayerIdOf(world, layerId);
    if (!child || !generatorFor(child)) return;
    if (world.regions.some((r) => r.layerId === child)) return; // 已可用
    this.ensureUnitsReady(child, seed); // 孙层优先
    const params = this.ctx.profiles.find((p) => p.layerId === child)?.params;
    runCascade(
      world,
      seed,
      [child],
      undefined,
      params ? { [child]: params } : undefined,
      new Set([child]),
    );
    this.ctx.setStatus(`已生成单元子层：${child}`);
  }

  setProfileParam(layerId: string, key: string, value: number | string | boolean): void {
    this.ctx.setProfiles(
      this.ctx.profiles.map((p) =>
        p.layerId === layerId ? { ...p, params: { ...p.params, [key]: value } } : p,
      ),
    );
    this.ctx.saveGenDraftSoon();
  }

  /** heightmap 策略层 profile 参数的类型化视图（单源 = profiles；缺省 = DEFAULT_WORLD_SHAPE） */
  get worldShape(): WorldShape {
    const layers = this.ctx.world?.layers ?? builtinLayers();
    const p = this.ctx.profiles.find((x) => x.layerId === heightmapLayerId(layers))?.params ?? {};
    const num = (k: keyof WorldShape, d: number) => (typeof p[k] === 'number' ? (p[k] as number) : d);
    const bool = (k: keyof WorldShape, d: boolean) => (typeof p[k] === 'boolean' ? (p[k] as boolean) : d);
    return {
      landRatio: num('landRatio', DEFAULT_WORLD_SHAPE.landRatio),
      relief: num('relief', DEFAULT_WORLD_SHAPE.relief),
      flatness: num('flatness', DEFAULT_WORLD_SHAPE.flatness),
      continentScale: num('continentScale', DEFAULT_WORLD_SHAPE.continentScale),
      coastBreak: num('coastBreak', DEFAULT_WORLD_SHAPE.coastBreak),
      mountain: num('mountain', DEFAULT_WORLD_SHAPE.mountain),
      detail: num('detail', DEFAULT_WORLD_SHAPE.detail),
      seaRugged: num('seaRugged', DEFAULT_WORLD_SHAPE.seaRugged),
      latBias: num('latBias', DEFAULT_WORLD_SHAPE.latBias),
      erosion: num('erosion', DEFAULT_WORLD_SHAPE.erosion),
    };
  }


}
