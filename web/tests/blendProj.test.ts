/**
 * ProjSpec 过渡投影族（批1/B1）：值插值参数化——每个 t 都是严格投影。
 *
 * 关键契约（动画的地基）：
 * - t=0/t=1 与两端投影逐点精确一致（静态零回归）；
 * - 中间帧 = 坐标逐点插值的严格定义（不是基准域近似）；
 * - unproject(project(ll)) 往返精确（λ = x/scale_t 对 λ 线性）；
 * - scale/周期/框高全部由值插值派生；缓存键 key 化（防 [object Object] 撞键）。
 */
import { describe, expect, it } from 'vitest';
import {
  blendProj,
  defaultProjParams,
  isBlend,
  project,
  projectionFrameLat,
  projectionPeriodAt,
  projectionWraps,
  projectionXScale,
  projSpecKey,
  quantizeBlend,
  unproject,
} from '../src/core/project/projections';

const pp = defaultProjParams();
const cases = [
  { lon: 0, lat: 0 },
  { lon: 120.5, lat: 45.2 },
  { lon: -179.9, lat: -60.1 },
  { lon: 77, lat: 84.9 },
  { lon: -30, lat: -89.5 },
];

describe('blendProj 值插值投影族', () => {
  it('端点精确：t=0/t=1 与两端投影逐点一致', () => {
    for (const ll of cases) {
      const a = project(ll, 'mercator', pp);
      const b = project(ll, 'robinson', pp);
      const s0 = project(ll, blendProj('mercator', 'robinson', 0), pp);
      const s1 = project(ll, blendProj('mercator', 'robinson', 1), pp);
      expect(s0.x).toBeCloseTo(a.x, 12);
      expect(s0.y).toBeCloseTo(a.y, 12);
      expect(s1.x).toBeCloseTo(b.x, 12);
      expect(s1.y).toBeCloseTo(b.y, 12);
    }
  });

  it('中间帧 = 坐标逐点 lerp（严格定义，非基准近似）', () => {
    for (const t of [0.25, 0.5, 0.75]) {
      for (const ll of cases) {
        const a = project(ll, 'mercator', pp);
        const b = project(ll, 'robinson', pp);
        const m = project(ll, blendProj('mercator', 'robinson', t), pp);
        expect(m.x).toBeCloseTo((1 - t) * a.x + t * b.x, 12);
        expect(m.y).toBeCloseTo((1 - t) * a.y + t * b.y, 12);
      }
    }
  });

  it('unproject 往返精确（回绕对：φ 二分 + λ=x/scale_t）', () => {
    for (const t of [0, 0.3, 0.5, 0.8, 1]) {
      const spec = blendProj('mercator', 'robinson', t);
      for (const ll of cases) {
        if (Math.abs(ll.lat) > 89) continue; // mercator 89.5 截断边界放宽
        const p = project(ll, spec, pp);
        const back = unproject(p.x, p.y, spec, pp);
        expect(back.lat).toBeCloseTo(ll.lat, 6);
        expect(back.lon).toBeCloseTo(ll.lon, 6);
      }
    }
  });

  it('scale/周期/框高 = 值插值派生', () => {
    // t=0 墨卡托 scale=1、t=1 罗宾森、中间 lerp
    expect(projectionXScale(blendProj('mercator', 'robinson', 0), 0.3)).toBe(1);
    expect(projectionXScale(blendProj('mercator', 'robinson', 1), 0.3)!).toBeCloseTo(
      projectionXScale('robinson', 0.3)!, 12,
    );
    const t = 0.4;
    const mid = projectionXScale(blendProj('mercator', 'robinson', t), 0.3)!;
    expect(mid).toBeGreaterThan(projectionXScale('robinson', 0.3)!);
    expect(mid).toBeLessThan(1);
    // 周期 = scale·2π
    expect(projectionPeriodAt(blendProj('mercator', 'robinson', t), 0.3)!).toBeCloseTo(mid * Math.PI * 2, 9);
    // 回绕判定：两端都回绕才回绕
    expect(projectionWraps(blendProj('mercator', 'robinson', t))).toBe(true);
    expect(projectionWraps('aeqd')).toBe(false);
    // 框高 lerp：85 → 90
    expect(projectionFrameLat(blendProj('mercator', 'robinson', 0))).toBe(85);
    expect(projectionFrameLat(blendProj('mercator', 'robinson', 1))).toBe(90);
    expect(projectionFrameLat(blendProj('mercator', 'robinson', 0.5))).toBeCloseTo(87.5, 9);
  });

  it('quantizeBlend：档 = floor 段（与渲染 alpha 推导同式）；端点并入 id 键', () => {
    const A = 'mercator' as const;
    const B = 'robinson' as const;
    // 档 0 → from id（复用现缓存）
    expect(quantizeBlend(blendProj(A, B, 0))).toBe(A);
    expect(quantizeBlend(blendProj(A, B, 0.01))).toBe(A);
    // 终点 → to id 本身（键合一，动画结束零重建）
    expect(quantizeBlend(blendProj(A, B, 1))).toBe(B);
    expect(quantizeBlend(blendProj(A, B, 0.999))).toEqual(blendProj(A, B, 2 / 3));
    // 段下界（与 mapRenderer alpha = t·n - floor(t·n) 推导一致）
    expect(quantizeBlend(blendProj(A, B, 0.4))).toEqual(blendProj(A, B, 1 / 3));
    expect(quantizeBlend(blendProj(A, B, 1 / 3))).toEqual(blendProj(A, B, 1 / 3)); // 段左闭
    expect(quantizeBlend(blendProj(A, B, 0.3333333))).toBe('mercator'); // 严格小于 1/3 → 段 0
    // 非 blend 原样
    expect(quantizeBlend(A)).toBe(A);
    // 档键有限（3 档 + 两端 id）
    const keys = new Set<string>();
    for (let i = 0; i <= 100; i++) keys.add(projSpecKey(quantizeBlend(blendProj(A, B, i / 100))));
    expect(keys.size).toBeLessThanOrEqual(5); // A、B、1/3、2/3（+端点别名）
  });

  it('projSpecKey：对象 key 化（防 [object Object] 撞键）+ 有限档', () => {
    const k1 = projSpecKey(blendProj('mercator', 'robinson', 0.25));
    const k2 = projSpecKey(blendProj('mercator', 'robinson', 0.25));
    const k3 = projSpecKey(blendProj('mercator', 'robinson', 0.5));
    expect(k1).toBe(k2); // 等值键稳定
    expect(k1).not.toBe(k3);
    expect(k1).toContain('mercator>robinson');
    expect(projSpecKey('mercator')).toBe('mercator');
    expect(isBlend('mercator')).toBe(false);
    expect(isBlend(blendProj('mercator', 'robinson', 0.1))).toBe(true);
  });
});
