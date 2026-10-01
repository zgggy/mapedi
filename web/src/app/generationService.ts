/**
 * GenerationService（还债步骤 5-b2，2026-10-01）：世界生成编排从 store 出库——
 * 整链 Worker（失败回主线程）+ 单层再生成 + 生成参数（profiles/worldShape/预设/开关）。
 * 职责边界：生成编排与参数状态；世界替换（replaceWorld 的 UI 重置）、进度/状态回显、
 * 草稿持久化、自动保存经 Ctx 注入（$state 写仍留 store 文件内闭包）。
 *
 * 世代序 `seq` 与 tryRestore/importProjectFile **共享**（任何换世界的异步操作互斥过期闸）。
 */
import type { World } from '../core/types';
import { createWorld, HARD_MAX_DENSITY } from '../core/world';
import { runCascade } from '../core/generate/registry';
import { generateWorldAsync } from '../core/generate/runGenerate';
import { cascadeEnabled, type GenerationProfile } from '../core/generate/profile';
import { defaultStarSystem } from '../core/astro';
import { rebuildLandSeaRegions } from '../core/layer/landSea';
import { defaultExclusiveColor } from '../core/layer/style';
import { DEFAULT_WORLD_SHAPE, type WorldShape } from '../core/layer/genTypes';
import { installProjCache } from '../render/projCache';

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
}

export class GenerationService {
  constructor(private ctx: GenerationCtx) {}

  async generate(seed: number, count: number): Promise<void> {
    const seq = this.ctx.nextSeq();
    // 硬上限唯一钳制点（core/world.HARD_MAX_DENSITY）；软上限解锁是 UI 策略，不在生成链
    const n = Math.max(100, Math.min(count, HARD_MAX_DENSITY));
    this.ctx.setGenerating(true);
    this.ctx.setGenProgress(0);
    this.ctx.setStatus(`生成中… ${n} 地块`);
    this.ctx.notify();
    try {
      // P1：整链 Worker（主线程不冻）；失败再退回主线程
      await this.generateViaWorker(seed, n, seq);
      if (seq !== this.ctx.seq) return;
      this.ctx.setGenerating(false);
      this.ctx.setGenProgress(100);
      this.ctx.notify();
    } catch (e) {
      // 回退可见：Worker 失败不许无声（吞错=护栏反模式）
      console.warn('[gen] Worker 失败，回退主线程', e);
      if (seq !== this.ctx.seq) return;
      try {
        await this.generateOnMain(seed, n, false, seq);
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

  private async generateViaWorker(seed: number, count: number, seq: number): Promise<void> {
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
    );
    if (seq !== this.ctx.seq) return;
    const world = got.world;
    if (got.projCache) installProjCache(got.projCache);
    for (const r of world.regions) {
      if (!r.exclusiveColor && r.color) r.exclusiveColor = defaultExclusiveColor(r.color);
    }
    rebuildLandSeaRegions(world);
    world.astro = defaultStarSystem(seed, world.climate);
    this.ctx.replaceWorld(world);
    // 生成后默认选中并显示高度层（产品默认：生成 → 直接看地形）
    world.layers.find((l) => l.id === 'height')!.visible = true;
    this.ctx.setFocusLayer('height');
    this.ctx.setStatus(`${world.cells.length} 地块 · Worker`);
    this.ctx.scheduleAutosave();
    this.ctx.notify();
  }

  private async generateOnMain(
    seed: number,
    count: number,
    quiet = false,
    seq = this.ctx.seq,
  ): Promise<void> {
    const t0 = performance.now();
    // 让浏览器先绘制一次 loading
    await new Promise((r) => setTimeout(r, 0));
    if (seq !== this.ctx.seq) return;
    const world = createWorld({ seed, count });
    const params: Record<string, Record<string, number | string | boolean>> = {};
    for (const p of this.ctx.profiles) params[p.layerId] = { ...p.params }; // 平面化（与 Worker 路径同规则）
    const enabled = new Set(cascadeEnabled(this.ctx.profiles));
    runCascade(world, seed, undefined, undefined, params, enabled);
    world.astro = defaultStarSystem(seed, world.climate);
    for (const r of world.regions) {
      if (!r.exclusiveColor && r.color) r.exclusiveColor = defaultExclusiveColor(r.color);
    }
    rebuildLandSeaRegions(world);
    if (seq !== this.ctx.seq) return;
    this.ctx.replaceWorld(world);
    // 生成后默认选中并显示高度层（产品默认：生成 → 直接看地形）
    world.layers.find((l) => l.id === 'height')!.visible = true;
    this.ctx.setFocusLayer('height');
    const ms = Math.round(performance.now() - t0);
    if (!quiet) this.ctx.setStatus(`${world.cells.length} 地块 · ${ms}ms`);
    this.ctx.scheduleAutosave();
    this.ctx.notify();
  }

  regenLayer(layerId: string): void {
    const world = this.ctx.world;
    if (!world) return;
    const params = this.ctx.profiles.find((p) => p.layerId === layerId)?.params;
    const enabled = new Set([layerId]);
    runCascade(
      world,
      world.meta.seed,
      [layerId],
      undefined,
      params ? { [layerId]: params } : undefined,
      enabled,
    );
    if (layerId === 'height') {
      // 「生成高度图 = 删除海陆图层[元素]」（2026-09-30 用户语义）：地形重跑后旧海陆
      // 划分失效 → 删旧建新（rebuildLandSeaRegions 全量重建派生元素）
      rebuildLandSeaRegions(world);
    }
    this.ctx.touchWorld();
    if (layerId === 'height') {
      // 高度重生成后默认显示并聚焦高度层（与整世界生成同规则）
      const h = this.ctx.world?.layers.find((l) => l.id === 'height');
      if (h) h.visible = true;
      this.ctx.setFocusLayer('height');
    }
    this.ctx.setStatus(`已重新生成：${layerId}`);
  }

  setProfileParam(layerId: string, key: string, value: number | string | boolean): void {
    this.ctx.setProfiles(
      this.ctx.profiles.map((p) =>
        p.layerId === layerId ? { ...p, params: { ...p.params, [key]: value } } : p,
      ),
    );
    this.ctx.saveGenDraftSoon();
  }

  /** height profile 参数的类型化视图（单源 = profiles；缺省 = DEFAULT_WORLD_SHAPE） */
  get worldShape(): WorldShape {
    const p = this.ctx.profiles.find((x) => x.layerId === 'height')?.params ?? {};
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

  /** 生成预设 */
  applyGenPreset(name: string): void {
    const next = this.ctx.profiles.map((p) => ({ ...p, params: { ...p.params } }));
    const set = (id: string, params: Record<string, number | string | boolean>, on = true) => {
      const p = next.find((x) => x.layerId === id);
      if (p) {
        p.enabled = on;
        p.params = { ...p.params, ...params };
      }
    };
    switch (name) {
      case '群岛':
        set('height', { landRatio: 0.12, relief: 90, flatness: 0.15, continentScale: 0.25, coastBreak: 0.85, mountain: 0.6, detail: 0.7, latBias: 0.7 });
        set('country', { count: 12, fromLayerCount: 2, allowOcean: true });
        set('province', { count: 24 });
        break;
      case '海国世界':
        set('country', { allowOcean: true });
        set('culture', { allowOcean: true });
        break;
      case '高原世界':
        set('height', { landRatio: 0.28, relief: 80, flatness: 0.55, continentScale: 0.75, coastBreak: 0.35, mountain: 0.55, detail: 0.35, latBias: 0.35 });
        set('culture', { coreSelector: 'highElevation' });
        break;
      case '默认大陆':
      default:
        set('height', { landRatio: 0.15, relief: 127, flatness: 0, continentScale: 0.5, coastBreak: 0.55, mountain: 0.7, detail: 0.5, latBias: 0.55 });
        set('country', { count: 8, fromLayerCount: 3, allowOcean: false });
        set('province', { count: 15 });
        set('culture', { allowOcean: false });
        break;
    }
    this.ctx.setProfiles(next);
    this.ctx.setStatus(`已套用预设：${name}`);
    this.ctx.notify();
  }

  toggleProfile(layerId: string): void {
    this.ctx.setProfiles(
      this.ctx.profiles.map((p) =>
        p.layerId === layerId ? { ...p, enabled: !p.enabled } : p,
      ),
    );
  }
}
