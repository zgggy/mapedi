<script lang="ts">
  /**
   * 生成模式的图层展开内容（2026-09-30 三模式重构：把手架构退役，本组件 = 纯面板体）。
   * 由工作区「生成」模式在图层树焦点行下方渲染。
   *
   * **生成 = 针对焦点层的三分支（读 `LayerDef.genStrategy`，禁比 id 字符串）**：
   * - `scatter`（cells）→ 「重新撒点」：种子/地块数/地形旋钮 + 整世界重建（onGenerate）
   * - `heightmap`（height）→ 「生成高度图」：只重跑地形 + 海陆删旧建新（onRegen(layerId)）
   * - `elements`（缺省）有 profile params → 单层再生成（onRegen；params 类型化控件）
   * - 路径类生成方法待设计（GEN R7）：暂无专属策略值，走 elements 分支（行为保持）
   * 防误触由「须先切生成模式」承担（原 D5 长按把手随把手架构退役）。
   */
  import CapsuleSlider from './CapsuleSlider.svelte';
  import type { WorldShape } from '../../core/layer/genTypes';
  import type { GenStrategy } from '../../core/types';
  import { HARD_MAX_DENSITY } from '../../core/world';

  let {
    generating = false,
    genProgress = 0,
    genStep = '',
    seedInput = '1',
    densityInput = 100000,
    shape = null as WorldShape | null,
    layerId = 'height',
    layerName = '',
    strategy = 'elements' as GenStrategy,
    layerParams = null as Record<string, number | string | boolean> | null,
    onGenerate,
    onShape,
    onRegen,
    onParam,
  }: {
    generating?: boolean;
    genProgress?: number;
    genStep?: string;
    seedInput?: string;
    densityInput?: number;
    shape?: WorldShape | null;
    /** 焦点层 id（onRegen 目标；分支判定走 strategy） */
    layerId?: string;
    layerName?: string;
    /** 该层生成策略（App 经 core/layer/flags 取，单源） */
    strategy?: GenStrategy;
    /** 该层 profile 参数（editor.profiles 单源） */
    layerParams?: Record<string, number | string | boolean> | null;
    /** 整世界重建（仅 scatter 层走此入口） */
    onGenerate: (seed: number, n: number) => void;
    onShape?: (key: keyof WorldShape, value: number | string | boolean) => void;
    /** 单层再生成（store.regenLayer；heightmap 会连带删旧建新海陆） */
    onRegen?: (layerId: string) => void;
    /** 单层参数写回（store.setProfileParam，已含草稿防抖持久化） */
    onParam?: (key: string, value: number | string | boolean) => void;
  } = $props();

  const isScatter = $derived(strategy === 'scatter');
  const isHeightmap = $derived(strategy === 'heightmap');
  /** 生成可用性：scatter/heightmap 恒可用；其他层需有 profile params */
  const canGen = $derived(
    isScatter || isHeightmap || (layerParams !== null && Object.keys(layerParams).length > 0),
  );

  /** 非 height 层参数 key 的人话标签（未列出的 key 按原样显示） */
  const PARAM_LABELS: Record<string, string> = {
    count: '元素数',
    fromLayerCount: '聚合源元素数',
    allowOcean: '允许海上元素',
    method: '生成方法',
    scope: '生成范围',
    pattern: '生成形态',
    coreSelector: '核心选择',
    fromLayerId: '源图层',
  };
  const PARAM_RANGE: Record<string, { min: number; max: number }> = {
    count: { min: 1, max: 60 },
    fromLayerCount: { min: 1, max: 20 },
  };

  function fire() {
    if (generating || !canGen) return;
    if (isScatter) onGenerate(Number(seedInput) || 1, densityInput);
    else onRegen?.(layerId);
  }
</script>

<div class="wrap">
  {#if canGen}
    <div class="panel">
      {#if isScatter}
        <!-- 地块层 = 重新撒点（原「总生成」语义归位到地块层） -->
        <div class="row">
          <label>种子 <input value={seedInput} oninput={(e) => (seedInput = e.currentTarget.value)} />
            <button type="button" class="dice" title="随机种子" onclick={() => (seedInput = String(Math.floor(Math.random() * 0xFFFFFFFF)))}>🎲</button>
          </label>
          <label>地块 <input type="number" min="100" max={HARD_MAX_DENSITY} value={densityInput} onchange={(e) => (densityInput = Number(e.currentTarget.value) || densityInput)} /></label>
          <button type="button" class="primary" disabled={generating} onclick={fire}>🎲 重新撒点</button>
        </div>
        <div class="hint">撒点将重建整个世界（高度、海陆及所有图层元素）</div>
        {#if shape && onShape}
          <div class="row">
            <label class="sm">大陆占比
              <span class="tiered">
                {#each [{ label: '小', v: 0.08 }, { label: '中', v: 0.15 }, { label: '大', v: 0.25 }, { label: '特大', v: 0.4 }] as t}
                  <button type="button" class:active={Math.abs(shape.landRatio - t.v) < 0.005} onclick={() => onShape('landRatio', t.v)}>{t.label}</button>
                {/each}
              </span>
            </label>
            <label class="sm">落差 <input type="number" min="20" max="127" value={shape.relief} onchange={(e) => onShape('relief', Math.max(20, Math.min(127, Number(e.currentTarget.value) || 127)))} /></label>
          </div>
          <div class="row">
            <label class="sm">大陆尺度 <CapsuleSlider min={0} max={1} step={0.05} value={shape.continentScale} label="大陆尺度（越大大陆越少越大）" width={90} onInput={(v) => onShape('continentScale', v)} /></label>
            <label class="sm">海岸破碎 <CapsuleSlider min={0} max={1} step={0.05} value={shape.coastBreak} label="海岸破碎度（域扭曲）" width={90} onInput={(v) => onShape('coastBreak', v)} /></label>
            <label class="sm">山脉 <CapsuleSlider min={0} max={1} step={0.05} value={shape.mountain} label="山脉强度" width={90} onInput={(v) => onShape('mountain', v)} /></label>
          </div>
          <div class="row">
            <label class="sm">细节 <CapsuleSlider min={0} max={1} step={0.05} value={shape.detail} label="细节量" width={90} onInput={(v) => onShape('detail', v)} /></label>
            <label class="sm">海床 <CapsuleSlider min={0} max={1} step={0.05} value={shape.seaRugged} label="海底起伏" width={90} onInput={(v) => onShape('seaRugged', v)} /></label>
            <label class="sm">平整 <CapsuleSlider min={0} max={1} step={0.05} value={shape.flatness} label="平整率（越大地面越贴海平面）" width={90} onInput={(v) => onShape('flatness', v)} /></label>
          </div>
          <div class="row">
            <label class="sm">低纬倾向 <CapsuleSlider min={0} max={1} step={0.05} value={shape.latBias} label="中低纬大陆倾向" width={90} onInput={(v) => onShape('latBias', v)} /></label>
            <label class="sm">侵蚀 <input type="number" min="0" max="6" value={shape.erosion} onchange={(e) => onShape('erosion', Math.max(0, Math.min(6, Number(e.currentTarget.value) || 0)))} /></label>
          </div>
        {/if}
      {:else if isHeightmap}
        <!-- 高度层 = 生成高度图（同参重跑；海陆元素随之删旧建新） -->
        <div class="row">
          <span class="title">生成高度图「{layerName}」</span>
          <button type="button" class="primary" disabled={generating} onclick={fire}>⛰️ 生成高度图</button>
        </div>
        <div class="hint">按下方地形参数重跑地形（种子不变 = 同参同果）；海陆元素删旧建新</div>
        {#if shape && onShape}
          <div class="row">
            <label class="sm">大陆占比
              <span class="tiered">
                {#each [{ label: '小', v: 0.08 }, { label: '中', v: 0.15 }, { label: '大', v: 0.25 }, { label: '特大', v: 0.4 }] as t}
                  <button type="button" class:active={Math.abs(shape.landRatio - t.v) < 0.005} onclick={() => onShape('landRatio', t.v)}>{t.label}</button>
                {/each}
              </span>
            </label>
            <label class="sm">落差 <input type="number" min="20" max="127" value={shape.relief} onchange={(e) => onShape('relief', Math.max(20, Math.min(127, Number(e.currentTarget.value) || 127)))} /></label>
          </div>
          <div class="row">
            <label class="sm">大陆尺度 <CapsuleSlider min={0} max={1} step={0.05} value={shape.continentScale} label="大陆尺度（越大大陆越少越大）" width={90} onInput={(v) => onShape('continentScale', v)} /></label>
            <label class="sm">海岸破碎 <CapsuleSlider min={0} max={1} step={0.05} value={shape.coastBreak} label="海岸破碎度（域扭曲）" width={90} onInput={(v) => onShape('coastBreak', v)} /></label>
            <label class="sm">山脉 <CapsuleSlider min={0} max={1} step={0.05} value={shape.mountain} label="山脉强度" width={90} onInput={(v) => onShape('mountain', v)} /></label>
          </div>
          <div class="row">
            <label class="sm">细节 <CapsuleSlider min={0} max={1} step={0.05} value={shape.detail} label="细节量" width={90} onInput={(v) => onShape('detail', v)} /></label>
            <label class="sm">海床 <CapsuleSlider min={0} max={1} step={0.05} value={shape.seaRugged} label="海底起伏" width={90} onInput={(v) => onShape('seaRugged', v)} /></label>
            <label class="sm">平整 <CapsuleSlider min={0} max={1} step={0.05} value={shape.flatness} label="平整率（越大地面越贴海平面）" width={90} onInput={(v) => onShape('flatness', v)} /></label>
          </div>
          <div class="row">
            <label class="sm">低纬倾向 <CapsuleSlider min={0} max={1} step={0.05} value={shape.latBias} label="中低纬大陆倾向" width={90} onInput={(v) => onShape('latBias', v)} /></label>
            <label class="sm">侵蚀 <input type="number" min="0" max="6" value={shape.erosion} onchange={(e) => onShape('erosion', Math.max(0, Math.min(6, Number(e.currentTarget.value) || 0)))} /></label>
          </div>
        {/if}
      {:else}
        <!-- 其他有 profile 的层 = 单层再生成（genConfigFromParams 单源消费 profile params） -->
        <div class="row">
          <span class="title">重新生成「{layerName}」</span>
          {#if layerParams && onParam}
            {#each Object.entries(layerParams) as [k, v] (k)}
              {#if typeof v === 'boolean'}
                <label class="sm"
                  ><input
                    type="checkbox"
                    checked={v}
                    onchange={(e) => onParam(k, e.currentTarget.checked)}
                  /> {PARAM_LABELS[k] ?? k}</label
                >
              {:else if typeof v === 'number'}
                <label class="sm"
                  >{PARAM_LABELS[k] ?? k}
                  <input
                    type="number"
                    min={PARAM_RANGE[k]?.min ?? 0}
                    max={PARAM_RANGE[k]?.max ?? 10000}
                    value={v}
                    onchange={(e) => {
                      const r = PARAM_RANGE[k];
                      const n = Number(e.currentTarget.value);
                      if (!Number.isNaN(n)) {
                        onParam(k, r ? Math.max(r.min, Math.min(r.max, n)) : n);
                      }
                    }}
                  /></label
                >
              {:else}
                <label class="sm"
                  >{PARAM_LABELS[k] ?? k}
                  <input value={String(v)} onchange={(e) => onParam(k, e.currentTarget.value)} /></label
                >
              {/if}
            {/each}
            <button type="button" class="primary" onclick={fire}>↻ 重新生成</button>
          {:else}
            <span class="hint">该层无生成配置</span>
          {/if}
        </div>
        {#if layerParams && onParam}
          <div class="hint">将替换「{layerName}」现有元素（需命令重构落地后方可撤销）</div>
        {/if}
      {/if}
      {#if generating && isScatter}
        <div class="prog"><div class="pfill" style="width:{genProgress}%"></div><span>{genStep} {genProgress}%</span></div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .wrap {
    flex: 0 0 auto;
  }
  .handles {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
  }
  .panel {
    padding: 2px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    margin: 4px 0;
  }
  .row label {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .row input[type='number'] {
    width: 74px;
  }
  .row input:not([type]) {
    width: 92px;
  }
  .row input {
    background: rgba(255, 255, 255, 0.06);
    color: var(--text, #ddd);
    border: 1px solid var(--border, #333);
    border-radius: 5px;
    font-size: 11px;
    padding: 3px 5px;
  }
  .row button {
    padding: 3px 10px;
    border: 1px solid var(--border, #333);
    background: transparent;
    color: var(--text, #ddd);
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
  }
  .row button.primary {
    background: var(--accent, #c9a24a);
    color: #1a1408;
    border-color: var(--accent, #c9a24a);
    font-weight: 600;
  }
  .row button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .row button.dice {
    padding: 3px 6px;
  }
  .title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text, #ddd);
  }
  .hint {
    font-size: 10px;
    color: var(--text-dim, #888);
    padding: 2px 0;
  }
  .tiered {
    display: inline-flex;
    border: 1px solid var(--border, #333);
    border-radius: 5px;
    overflow: hidden;
  }
  .tiered button {
    border: 0;
    border-radius: 0;
    border-right: 1px solid var(--border, #333);
    font-size: 11px;
    padding: 3px 8px;
  }
  .tiered button:last-child {
    border-right: 0;
  }
  .tiered button.active {
    background: var(--accent, #c9a24a);
    color: #1a1408;
  }
  .prog {
    position: relative;
    height: 16px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    overflow: hidden;
    margin-top: 4px;
  }
  .pfill {
    height: 100%;
    background: linear-gradient(90deg, rgba(240, 195, 106, 0.85), rgba(216, 164, 82, 0.85));
    transition: width 0.2s ease;
  }
  .prog span {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    font-size: 10px;
    color: var(--text, #ddd);
    font-variant-numeric: tabular-nums;
  }
</style>
