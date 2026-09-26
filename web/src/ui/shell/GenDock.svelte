<script lang="ts">
  import { SOFT_MAX_DENSITY, HARD_MAX_DENSITY } from '../../core/world';

  let {
    seedInput = $bindable(''),
    densityInput = $bindable(30000),
    generating = false,
    genProgress = 0,
    genStep = '',
    densityUnlocked = $bindable(false),
    onGenerate,
    onValidate,
    onPreset,
  }: {
    seedInput?: string;
    densityInput?: number;
    generating?: boolean;
    genProgress?: number;
    genStep?: string;
    densityUnlocked?: boolean;
    onGenerate: (seed: number, count: number) => void;
    onValidate: () => void;
    onPreset: (k: 'view' | 'create' | 'draw') => void;
  } = $props();

  function checkUnlock(n: number): number {
    if (n > SOFT_MAX_DENSITY && !densityUnlocked) {
      const ok = window.confirm(
        `提高上限对性能影响较大，请谨慎解锁。\n当前 ${n} > 软上限 ${SOFT_MAX_DENSITY}。\n确定解锁并继续？`,
      );
      if (ok) densityUnlocked = true;
      else return SOFT_MAX_DENSITY;
    }
    return n;
  }
</script>

<div class="gen-dock">
  <label>
    种子
    <input bind:value={seedInput} />
  </label>
  <label>
    地块数
    <input
      type="number"
      min="100"
      max={HARD_MAX_DENSITY}
      value={densityInput}
      onblur={(e) => {
        densityInput = checkUnlock(Number(e.currentTarget.value) || densityInput);
      }}
      onchange={(e) => {
        densityInput = Number(e.currentTarget.value) || densityInput;
      }}
    />
  </label>
  <button
    type="button"
    class="primary"
    disabled={generating}
    onclick={() => {
      const n = checkUnlock(densityInput);
      densityInput = n;
      onGenerate(Number(seedInput) || 1, n);
    }}
  >
    🎲 重新生成
  </button>
  <button type="button" onclick={onValidate}>✅ 校验</button>
  <button type="button" onclick={() => onPreset('view')}>布局·观赏</button>
  <button type="button" onclick={() => onPreset('create')}>布局·创作</button>
  <button type="button" onclick={() => onPreset('draw')}>布局·绘制</button>
  {#if generating}
    <div class="gen-progress">
      <div class="bar" style="width:{genProgress}%"></div>
      <span>{genStep} {genProgress}%</span>
    </div>
  {/if}
</div>

<style>
  .gen-dock {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: end;
    padding: 0 0 8px;
    background: transparent;
    border: none;
    border-radius: 0;
    backdrop-filter: none;
    max-width: 100%;
  }
  .gen-dock label {
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .gen-dock input {
    width: 110px;
  }
  .gen-progress {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 140px;
    font-size: 11px;
    color: var(--text-dim);
  }
  .gen-progress .bar {
    height: 6px;
    background: #3d9a6a;
    border-radius: 3px;
    min-width: 4px;
    max-width: 120px;
  }
</style>
