<script lang="ts">
  /**
   * 生成模式的图层展开内容（2026-09-30 三模式重构：把手架构退役，本组件 = 纯面板体）。
   * 由工作区「生成」模式在图层树焦点行下方渲染。
   *
   * **生成 = 针对焦点层的三分支（读 `LayerDef.genStrategy`，禁比 id 字符串）**：
   * - `scatter`（cells）→ 「重新撒点」：种子/地块数/地形旋钮 + 整世界重建（onGenerate）
   * - `heightmap`（height）→ 「生成高度图」：只重跑地形（editor.regenLayer(layerId, seed)）
   * - `elements`（缺省）有 profile params → 单层再生成（regenLayer；params 类型化控件）
   * - 路径类生成方法待设计（GEN R7）：暂无专属策略值，走 elements 分支（行为保持）
   * 防误触由「须先切生成模式」承担（原 D5 长按把手随把手架构退役）。
   */
  import { editor } from '../../app/store.svelte';
  import { heightmapLayerId } from '../../core/layer/flags';
  import { childLayerIdOf } from '../../core/hierarchy/derive';
  import CapsuleSlider from './CapsuleSlider.svelte';
  import ModeCapsule from './ModeCapsule.svelte';
  import StateCapsule from './StateCapsule.svelte';
  import type { WorldShape } from '../../core/layer/genTypes';
  import type { GenStrategy } from '../../core/types';
  import { HARD_MAX_DENSITY } from '../../core/world';
  import { DEFAULT_WORLD_SHAPE } from '../../core/layer/genTypes';

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
    freeform = false,
    layerParams = null as Record<string, number | string | boolean> | null,
    onGenerate,
  }: {
    generating?: boolean;
    genProgress?: number;
    genStep?: string;
    seedInput?: string;
    densityInput?: number;
    shape?: WorldShape | null;
    /** 焦点层 id（regen 目标；分支判定走 strategy） */
    layerId?: string;
    layerName?: string;
    /** 该层生成策略（App 经 core/layer/flags 取，单源） */
    strategy?: GenStrategy;
    /** 自由路径层（road/route/river）：挂「生成方法待设计」徽章（GEN R7） */
    freeform?: boolean;
    /** 该层 profile 参数（editor.profiles 单源） */
    layerParams?: Record<string, number | string | boolean> | null;
    /** 整世界重建（仅 scatter 层走此入口） */
    onGenerate: (seed: number, n: number) => void;

    /** 单层再生成（store.regenLayer(layerId, seed)） */

    /** 单层参数写回（store.setProfileParam，已含草稿防抖持久化） */

  } = $props();

  const isScatter = $derived(strategy === 'scatter');
  /** 焦点层有子层（链：每层≤1子）→ 显示「含子层」级联开关（用户 2026-10-04） */
  const cascadeAvail = $derived(!!editor.world && !!childLayerIdOf(editor.world, layerId));
  /** 勾选后：从最深层子层逐层向上重新生成到本层（子先父后）；默认关 = 只生成本层 */
  let cascadeDown = $state(false);
  const isHeightmap = $derived(strategy === 'heightmap');
  /** 基于已有手绘骨架细化（v6）：开 = 档位为骨架 + 同源形态场细化 */
  let basedOn = $state(false);
  /** 保护海岸开关（2026-10-06 用户定：默认关；开 = mask 逐格不动，关 = 海岸随形态场带内弯曲进出） */
  let basedCoast = $state(false);
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
  };
  const PARAM_RANGE: Record<string, { min: number; max: number }> = {
    count: { min: 1, max: 60 },
    fromLayerCount: { min: 1, max: 20 },
  };
  /** 布尔参数的状态胶囊图标（缺省 ⚙）——2026-10-02 用户定：状态=胶囊按钮 */
  const PARAM_ICONS: Record<string, string> = { allowOcean: '🌊', allowOverlap: '🌀' };
  /** 大陆占比档位（N 选 1 → 分段胶囊，图标配文字） */
  const LAND_TIERS = [
    { id: '0.08', icon: '○', label: '小' },
    { id: '0.15', icon: '◎', label: '中' },
    { id: '0.25', icon: '●', label: '大' },
    { id: '0.4', icon: '◉', label: '特大' },
  ];
  /** 当前值落档（不精确匹配 → '' → 滑钮隐藏，不冒充任何档） */
  const tierId = (v: number) => LAND_TIERS.find((t) => Math.abs(Number(t.id) - v) < 0.005)?.id ?? '';

  /** 动作下沉（5-c，2026-10-03）：地形参数始终写高度层 profile；布局参数写本层 profile */
  function setShape(k: keyof WorldShape, v: number | string | boolean): void {
    editor.setProfileParam(heightmapLayerId(editor.world?.layers ?? []), k, v);
  }
  function setParam(k: string, v: number | string | boolean): void {
    editor.setProfileParam(layerId, k, v);
  }

  /** 两击确认（2026-10-06 用户定：三类生成都会清除图层内容 → 首击武装、再击执行，
   *  2.6s 无操作自动解除；不用原生 confirm——项目风格禁弹窗） */
  let armed = $state<'' | 'scatter' | 'height' | 'elem'>('');
  let armTimer: ReturnType<typeof setTimeout> | undefined;
  function confirmFire(kind: 'scatter' | 'height' | 'elem') {
    if (generating || !canGen) return;
    if (armed === kind) {
      clearTimeout(armTimer);
      armed = '';
      fire();
      return;
    }
    armed = kind;
    clearTimeout(armTimer);
    armTimer = setTimeout(() => (armed = ''), 2600);
  }

  function fire() {
    if (generating || !canGen) return;
    if (isScatter) {
      onGenerate(Number(seedInput) || 1, densityInput);
      return;
    }
    // 种子行（2026-10-04 用户报障：高度/布局重生成没有改种子的地方）——
    // 空/非法回退世界种子（regenLayer 内 isFinite 兜底）
    const t = seedInput.trim();
    const sv = t === '' ? undefined : Number(t);
    if (isHeightmap && basedOn) {
      // 基于已有（2026-10-06 澄清）：按绘制海岸线走完整重新生成（地形旋钮全套有效）
      editor.refineHeight(shape ?? DEFAULT_WORLD_SHAPE, sv, basedCoast);
      return;
    }
    editor.regenLayer(layerId, sv, cascadeDown);
  }

  /** 种子行（撒点/高度/布局三分支同款；seedInput = App 草稿持久化字段） */
  function rollSeed(): void {
    seedInput = String(Math.floor(Math.random() * 0xFFFFFFFF));
  }
</script>

<div class="wrap">
  <!-- 活空态（2026-10-03 包3）：面板恒开——无配置层给「去哪配」指引，不再沉默（P4） -->
  <div class="panel">
      {#if isScatter}
        <!-- 地块层 = 重新撒点（原「总生成」语义归位到地块层） -->
        <div class="bhead"><span class="sb">🎲 撒点</span><span class="bh-t">重新撒点</span></div>
        <div class="row">
          <label>种子 <input value={seedInput} oninput={(e) => (seedInput = e.currentTarget.value)} />
            <button type="button" class="dice" title="随机种子" onclick={rollSeed}>🎲</button>
          </label>
          <label>地块 <input type="number" min="100" max={HARD_MAX_DENSITY} value={densityInput} onchange={(e) => (densityInput = Number(e.currentTarget.value) || densityInput)} /></label>
          <button
            type="button"
            class="primary"
            class:danger={armed === 'scatter'}
            disabled={generating}
            onclick={() => confirmFire('scatter')}
          >{armed === 'scatter' ? '⚠ 确认清除重建？' : '🎲 重新撒点'}</button>
        </div>
        <div class="hint">仅重建地块网格（不生成高度图）；地块以外的全部图层（含自定义层与路径）将被清除——再次点击确认</div>
      {:else if isHeightmap}
        <!-- 高度层 = 生成高度图（种子+参数可调重跑） -->
        <div class="bhead"><span class="sb">⛰️ 地形</span><span class="bh-t">生成高度图「{layerName}」</span></div>
        <div class="row">
          <label>种子 <input value={seedInput} oninput={(e) => (seedInput = e.currentTarget.value)} />
            <button type="button" class="dice" title="随机种子" onclick={rollSeed}>🎲</button>
          </label>
          <!-- 基于已有（2026-10-06 拍板 1b：自定义开关放生成按钮左边） -->
          <span
            class="based"
            style="margin-left:auto"
            title="开 = 以已绘制的陆块做匹配扩散（最厚处为峰、参数由块几何匹配、非随机绘制）：全谱铺满、海岸线逐格不变；关 = 按旋钮常规重新生成"
          >基于已有
            <StateCapsule
              icon="🧱"
              onText="细化"
              offText="重生成"
              on={basedOn}
              onchange={(v) => (basedOn = v)}
            />
          </span>
          {#if basedOn}
            <span
              class="based"
              title="保护海岸（2026-10-06 用户定，默认关）：开 = 海岸线逐格锁定不动；关 = 海岸随形态场在边界带内弯曲进出（大致保持）"
            >护岸
              <StateCapsule
                icon="🌊"
                onText="开"
                offText="关"
                on={basedCoast}
                onchange={(v) => (basedCoast = v)}
              />
            </span>
          {/if}
          <button
            type="button"
            class="primary"
            class:danger={armed === 'height'}
            disabled={generating}
            onclick={() => confirmFire('height')}
          >{armed === 'height'
            ? basedOn ? '⚠ 确认细化（清除其他图层）？' : '⚠ 确认（清除其他图层）？'
            : basedOn ? '⛰️ 基于已有细化' : '⛰️ 生成高度图'}</button>
        </div>
        <div class="hint">{#if basedOn}手绘档位 = 骨架，形态与建地形同源；【平整】0=均匀分布、1=近 0 高度 ≥95%（顶峰/深海仍出现）；【贴近原始】0=不考虑原始、1=手绘过的格高度基本不变（其余自由发挥）；【海岸破碎】0=平滑海岸、1=碎但不零碎（碎岛最小尺度反向映射）；护岸默认关 = 海岸随形态场微调；将清除地块与高度以外的全部图层内容——再次点击确认{:else}按下方地形参数重跑地形（同种子同参 = 同果，🎲 换种子即换地形）；将清除地块与高度以外的全部图层内容——再次点击确认{/if}</div>
        {#if shape}
          <!-- 地形 3×N 紧凑网格（2026-10-03 包3：两列长行滚动 → 网格；占比通栏） -->
          <div class="tgrid">
            {#if !basedOn}
            <label class="tcell wide"><span>大陆占比</span>
              <ModeCapsule
                value={tierId(shape.landRatio)}
                onChange={(id) => setShape('landRatio', Number(id))}
                items={LAND_TIERS}
                ariaLabel="大陆占比"
                segMinW={46}
              />
            </label>
            {/if}
            {#if !basedOn}
            <label class="tcell"><span>落差</span>
              <input type="number" min="20" max="127" value={shape.relief} onchange={(e) => setShape('relief', Math.max(20, Math.min(127, Number(e.currentTarget.value) || 127)))} />
            </label>
            {/if}
            {#if !basedOn}
            <label class="tcell"><span>大陆尺度</span><CapsuleSlider min={0} max={1} step={0.05} value={shape.continentScale} label="大陆尺度" width={84} onInput={(v) => setShape('continentScale', v)} /></label>
            {/if}
            {#if !basedOn}
            <label class="tcell"><span>海岸破碎</span><CapsuleSlider min={0} max={1} step={0.05} value={shape.coastBreak} label="海岸破碎" width={84} onInput={(v) => setShape('coastBreak', v)} /></label>
            {/if}
            <label class="tcell"><span>山脉</span><CapsuleSlider min={0} max={1} step={0.05} value={shape.mountain} label="山脉强度" width={84} onInput={(v) => setShape('mountain', v)} /></label>
            <label class="tcell"><span>细节</span><CapsuleSlider min={0} max={1} step={0.05} value={shape.detail} label="细节量" width={84} onInput={(v) => setShape('detail', v)} /></label>
            <label class="tcell"><span>海床</span><CapsuleSlider min={0} max={1} step={0.05} value={shape.seaRugged} label="海底起伏" width={84} onInput={(v) => setShape('seaRugged', v)} /></label>
            <label class="tcell"><span>平整</span><CapsuleSlider min={0} max={1} step={0.05} value={shape.flatness} label="平整率" width={84} onInput={(v) => setShape('flatness', v)} /></label>
            {#if basedOn}
              <!-- 贴近原始（2026-10-06 设计稿 P2/P3）：锚=手绘非 0 格；0=现状、1=锚点高度变化≈0 -->
              <label class="tcell"><span>贴近原始</span><CapsuleSlider min={0} max={1} step={0.05} value={shape.anchorFit ?? 0} label="贴近原始" width={84} onInput={(v) => setShape('anchorFit', v)} /></label>
            {/if}
            {#if !basedOn}
            <label class="tcell"><span>低纬倾向</span><CapsuleSlider min={0} max={1} step={0.05} value={shape.latBias} label="中低纬倾向" width={84} onInput={(v) => setShape('latBias', v)} /></label>
            {/if}
            {#if !basedOn}
            <label class="tcell"><span>侵蚀</span>
              <input type="number" min="0" max="6" value={shape.erosion} onchange={(e) => setShape('erosion', Math.max(0, Math.min(6, Number(e.currentTarget.value) || 0)))} />
            </label>
            {/if}
          </div>
        {/if}
      {:else}
        <!-- 其他有 profile 的层 = 单层再生成（genConfigFromParams 单源消费 profile params） -->
        <div class="bhead">
          <span class="sb">🧩 布局</span>
          <span class="bh-t">重新生成「{layerName}」</span>
          {#if freeform}<span class="rb">生成方法待设计（GEN R7）</span>{/if}
        </div>
        {#if layerParams}
          <div class="row">
            <label>种子 <input value={seedInput} oninput={(e) => (seedInput = e.currentTarget.value)} />
              <button type="button" class="dice" title="随机种子" onclick={rollSeed}>🎲</button>
            </label>
          </div>
          <div class="prow-wrap">
            {#each Object.entries(layerParams).filter(([k]) => k !== 'fromLayerId') as [k, v] (k)}
              {#if typeof v === 'boolean'}
                <span class="prow"
                  ><span class="pl">{PARAM_LABELS[k] ?? k}</span
                  ><StateCapsule
                    icon={PARAM_ICONS[k] ?? '⚙'}
                    onText="开"
                    offText="关"
                    on={v}
                    onchange={(nv) => setParam(k, nv)}
                  /></span
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
                        setParam(k, r ? Math.max(r.min, Math.min(r.max, n)) : n);
                      }
                    }}
                  /></label
                >
              {:else}
                <label class="sm"
                  >{PARAM_LABELS[k] ?? k}
                  <input value={String(v)} onchange={(e) => setParam(k, e.currentTarget.value)} /></label
                >
              {/if}
            {/each}
          </div>
          <div class="row end">
            {#if cascadeAvail}
              <span title="开 = 先重生成最深子层，逐层向上到「{layerName}」（子先父后：父层聚合子层）">
                <StateCapsule
                  icon="🧬"
                  onText="含子层"
                  offText="仅本层"
                  on={cascadeDown}
                  onchange={(v) => (cascadeDown = v)}
                />
              </span>
            {/if}
            <button
              type="button"
              class="primary"
              class:danger={armed === 'elem'}
              onclick={() => confirmFire('elem')}
            >{armed === 'elem' ? '⚠ 确认（连父层链清除）？' : '↻ 重新生成'}</button>
          </div>
          <div class="hint">
            将替换「{layerName}」{cascadeDown && cascadeAvail ? '及其整条子层链（自底向上）' : ''}现有元素；
            其父层链内容将一并清除（父层聚合子层，子层重生成后父层失效）——再次点击确认
          </div>
        {:else}
          <div class="hint">该层无生成配置——到「检查」模式给「{layerName}」设置参数后再回来生成</div>
        {/if}
      {/if}
      {#if generating && isScatter}
        <div class="prog"><div class="pfill" style="width:{genProgress}%"></div><span>{genStep} {genProgress}%</span></div>
      {/if}
    </div>
</div>

<style>
  .wrap {
    flex: 0 0 auto;
  }
  /* 分支头（包3）：策略徽章 + 动作名一行——三分支同构可扫 */
  .bhead {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    margin-bottom: var(--sp-2);
    font-size: var(--fs-sm);
    color: var(--text);
  }
  .sb {
    border: 1px solid var(--panel-border);
    border-radius: var(--r-pill);
    background: rgba(120, 160, 220, 0.16);
    padding: 1px 7px;
    font-size: var(--fs-xs);
    color: var(--text);
    flex: 0 0 auto;
  }
  .bh-t {
    font-weight: 600;
  }
  .rb {
    border: 1px dashed var(--panel-border);
    border-radius: var(--r-pill);
    padding: 1px 6px;
    font-size: var(--fs-xs);
    color: var(--text-dim);
    margin-left: auto;
  }
  /* 地形网格：占比通栏 + 其余三列（包3） */
  .tgrid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 4px 8px;
    margin-bottom: var(--sp-2);
  }
  .tcell {
    display: flex;
    flex-direction: column;
    gap: var(--sp-1);
    font-size: var(--fs-xs);
    color: var(--text-dim);
    min-width: 0;
  }
  .tcell.wide {
    grid-column: 1 / -1;
    flex-direction: row;
    align-items: center;
    gap: var(--sp-4);
  }
  .tcell input[type='number'] {
    width: 100%;
    color: var(--text);
  }
  .row.end {
    justify-content: flex-end;
  }
  .prow-wrap {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px 10px;
    margin-bottom: var(--sp-2);
  }
  .handles {
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
    padding: 6px 8px;
  }
  .panel {
    padding: 2px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }
  .row {
    display: flex;
    align-items: center;
    gap: var(--sp-4);
    flex-wrap: wrap;
    margin: 4px 0;
  }
  .row label {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--fs-sm);
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
    font-size: var(--fs-sm);
    padding: 3px 5px;
  }
  .row button {
    padding: 3px 10px;
    border: 1px solid var(--border, #333);
    background: transparent;
    color: var(--text, #ddd);
    border-radius: 5px;
    cursor: pointer;
    font-size: var(--fs-md);
  }
  .based {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--fs-xs);
    color: var(--text-dim);
    white-space: nowrap;
  }
  .row button.primary {
    background: var(--accent, #c9a24a);
    color: #1a1408;
    border-color: var(--accent, #c9a24a);
    font-weight: 600;
  }
  /* 两击确认的武装态：红底警示 */
  .row button.primary.danger {
    background: #a8402f;
    color: #fff;
    border-color: #a8402f;
  }
  .row button:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .row button.dice {
    padding: 3px 6px;
  }
  .hint {
    font-size: var(--fs-xs);
    color: var(--text-dim, #888);
    padding: 2px 0;
  }
  /* N 选 1 已换 ModeCapsule（2026-10-02）；.tiered 死样式删除 */
  .prow {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    font-size: var(--fs-sm);
    color: var(--text-dim);
  }
  .prow .pl {
    color: var(--text-dim);
  }
  .prog {
    position: relative;
    height: 16px;
    border-radius: var(--r-3);
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
    font-size: var(--fs-xs);
    color: var(--text, #ddd);
    font-variant-numeric: tabular-nums;
  }
</style>
