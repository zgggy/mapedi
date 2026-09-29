/**
 * 罗宾森「水平结构 = scale(y)·λ」连续性断言（包1：数据域连续化）。
 *
 * 回归背景：projCache/链化曾用常数 2π 做 x 域 unwrap，而罗宾森真实周期
 * = scale(y)·2π（赤道 5.33 ≠ 6.283）→ 跨缝顶点错位 +0.951 → cell 撕裂、
 * 缝附近填充乱（用户报「罗宾森下地图显示/填充有问题」的根因之一）。
 */
import { describe, expect, it } from 'vitest';
import {
  project,
  unproject,
  defaultProjParams,
  projectionXScale,
  projectionPeriodAt,
  projectionWraps,
} from '../src/core/project/projections';
import { getProjCache } from '../src/render/projCache';
import { createWorld, rebuildSharedEdgesFromCells } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import type { World } from '../src/core/types';

const pp = defaultProjParams();
const rob = (ll: { lon: number; lat: number }) => project(ll, 'robinson', pp);

describe('罗宾森 scale(y)·λ 水平结构', () => {
  it('scale/周期 = 局部纬度函数；赤道周期 5.33（≠2π），高纬更窄', () => {
    const s0 = projectionXScale('robinson', 0)!;
    const p0 = projectionPeriodAt('robinson', 0)!;
    expect(p0).toBeCloseTo(0.8487 * Math.PI * 2, 6); // 赤道 5.3313
    expect(p0).toBeLessThan(Math.PI * 2);
    // 与实际投影同源：x(λ=180°,φ) / π = scale(y(φ))
    const eq = rob({ lon: 180, lat: 0 });
    expect(s0).toBeCloseTo(eq.x / Math.PI, 6);
    const mid = rob({ lon: 180, lat: 60 });
    const y60 = rob({ lon: 0, lat: 60 }).y;
    expect(projectionXScale('robinson', y60)!).toBeCloseTo(mid.x / Math.PI, 6);
    // 局部周期随纬度单调内收
    expect(projectionPeriodAt('robinson', y60)!).toBeLessThan(p0);
    expect(projectionWraps('robinson')).toBe(true);
    // 圆柱族 scale 常数（兼容性）
    expect(projectionXScale('mercator', 0)).toBe(1);
    expect(projectionPeriodAt('mercator', 3)).toBeCloseTo(Math.PI * 2, 12);
    expect(projectionXScale('behrmann', 1)!).toBeCloseTo(Math.sin(Math.PI / 6), 12);
    // 非回绕投影无水平结构
    expect(projectionXScale('aeqd', 0)).toBeNull();
  });

  it('跨缝 cell 多边形连续：相邻顶点 |Δx| ≤ 局部半周期（旧实现错位 +0.95）', () => {
    const world: World = createWorld({ seed: 4242, count: 800 });
    generateDemoContinents(world, 4242);
    if (!world.sharedEdges?.size) world.sharedEdges = rebuildSharedEdgesFromCells(world);
    const cache = getProjCache(world, 'robinson', pp);
    let seamCells = 0;
    let worst = 0;
    for (const cell of world.cells) {
      const poly = cache.polys[cell.id];
      if (!poly || poly.length < 6) continue;
      const hasSeam = (cell.polygon ?? []).some(
        (q) => Math.abs(q.lon) > 178,
      );
      if (!hasSeam) continue;
      seamCells++;
      for (let i = 0; i + 3 < poly.length; i += 2) {
        const dx = Math.abs(poly[i + 2] - poly[i]);
        const half = (projectionPeriodAt('robinson', poly[i + 1]) ?? Infinity) / 2;
        worst = Math.max(worst, dx / half);
        // 相邻顶点跨距必须在局部半周期内（旧实现跨缝处 ≈0.95/2.67 → 且后续链漂移）
        expect(dx).toBeLessThanOrEqual(half + 1e-6);
      }
    }
    expect(seamCells).toBeGreaterThan(0); // fixture 必须真的含跨缝 cell
    expect(worst).toBeLessThanOrEqual(1);
  });

  it('跨缝顶点不再被 2π 错移：投影位置 = 真值（λ 连续域）', () => {
    // 等价性：unwrapXAgainst 用局部周期后，跨缝点应落在 λ=180.1 的真值处
    const a = rob({ lon: 179.9, lat: 0 });
    const b = rob({ lon: -179.9, lat: 0 });
    const local = projectionPeriodAt('robinson', 0)!;
    // 局部周期修位后的 x ≈ λ=180.1 真值
    const fixed = b.x + local;
    const truth = rob({ lon: 180.1, lat: 0 }).x;
    expect(Math.abs(fixed - truth)).toBeLessThan(0.01); // 旧常数 2π 误差 0.951
    const wrong = b.x + Math.PI * 2;
    expect(Math.abs(wrong - truth)).toBeGreaterThan(0.9); // 记录旧错位量级
    // 反解闭环（命中链路依赖）
    const ll = unproject(a.x, a.y, 'robinson', pp);
    expect(ll.lon).toBeCloseTo(179.9, 3);
  });
});
