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
import { contentOffsetAt, frameRect, frameOutline, worldCopyKs } from '../src/render/space';
import { createWorld, rebuildSharedEdgesFromCells } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import type { World } from '../src/core/types';

const pp = defaultProjParams();
const rob = (ll: { lon: number; lat: number }) => project(ll, 'robinson', pp);

describe('平移重映射（转动地球经度）', () => {
  it('contentOffsetAt = scale(y)·Δλ：位移随纬度内收，圆柱族退化常数', () => {
    // 罗宾森：同 Δλ 在赤道位移大、高纬位移小（这不是畸变，是重投影本身）
    const d = 0.5;
    const eq = contentOffsetAt('robinson', 0, d);
    const hi = contentOffsetAt('robinson', 1.2, d);
    expect(eq).toBeCloseTo(projectionXScale('robinson', 0)! * d, 12);
    expect(Math.abs(hi)).toBeLessThan(Math.abs(eq));
    // 圆柱族 = 刚性（= 旧行为）
    expect(contentOffsetAt('mercator', 0.7, d)).toBeCloseTo(d, 12);
    expect(contentOffsetAt('behrmann', 0.3, d)).toBeCloseTo(0.5 * d, 12);
    // 非回绕：Δλ 即投影域位移（保留旧语义）
    expect(contentOffsetAt('aeqd', 0, d)).toBeCloseTo(d, 12);
  });

  it('回绕连续：Δλ 转动后副本 k 覆盖视口（左右拖不出世界）', () => {
    const cam = { x: 0, y: 0, scale: 60 };
    const viewW = 900;
    for (const pan of [0, 1.3, -2.9, 7.0, -11.5]) {
      const ks = worldCopyKs(pan, cam, viewW, 'robinson', {
        minX: -2.7, maxX: 2.7, minY: -1.4, maxY: 1.4,
      });
      expect(ks.length).toBeGreaterThan(0);
      // 至少一个副本的内容区间与视口相交（经 scale 区间保守判定）
      const halfW = viewW / 2 / cam.scale;
      const viewL = cam.x - halfW, viewR = cam.x + halfW;
      const hit = ks.some((k) => {
        const T = pan + k * Math.PI * 2;
        const lo = Math.min(projectionXScale('robinson', -1.4)! * T, projectionXScale('robinson', 1.4)! * T);
        const hi = Math.max(projectionXScale('robinson', -1.4)! * T, projectionXScale('robinson', 1.4)! * T);
        return -2.7 + lo <= viewR && 2.7 + hi >= viewL;
      });
      expect(hit).toBe(true);
    }
  });
});

describe('罗宾森轮廓视口（frameRect/frameOutline）', () => {
  it('frameRect 水平半宽 = 赤道最宽（旧四角法把赤道两侧裁掉 1.14）', () => {
    const fr = frameRect(rob, 90);
    const eq = rob({ lon: 180, lat: 0 }).x;
    expect(fr.maxX).toBeCloseTo(eq, 9); // 2.666（旧 = ±lat 角 1.416，赤道只见 ±103°）
    expect(fr.maxX).toBeGreaterThan(2.6);
    expect(fr.maxY).toBeCloseTo(rob({ lon: 0, lat: 90 }).y, 9);
  });

  it('frameOutline 左右边界 = ±scale(y)·π（与 scale 同源），副本位移下逐点重合', () => {
    const out = frameOutline(rob, 'robinson');
    expect(out.length).toBeGreaterThanOrEqual(96);
    for (let i = 0; i < out.length; i += 7) {
      const q = out[i];
      const s = projectionXScale('robinson', q.y)!;
      expect(Math.abs(Math.abs(q.x) - s * Math.PI)).toBeLessThan(1e-9);
      // 关键不变量：轮廓半宽·2 = 局部周期 → 副本 k 与 k+1 的轮廓边逐点重合
      const w = Math.abs(q.x) * 2;
      expect(w).toBeCloseTo(projectionPeriodAt('robinson', q.y)!, 9);
    }
    // 多边形闭合靠首尾相连的底边：首=右底角、尾=左底角（同 y 底边，x 关于0对称）
    expect(out[0].y).toBeCloseTo(out[out.length - 1].y, 12);
    expect(out[0].x).toBeCloseTo(-out[out.length - 1].x, 12);
  });

  it('圆柱族轮廓 = 矩形 4 角（与旧行为等价）', () => {
    const m = (ll: { lon: number; lat: number }) => project(ll, 'mercator', pp);
    const out = frameOutline(m, 'mercator');
    expect(out).toHaveLength(4);
    const xs = new Set(out.map((q) => q.x.toFixed(6)));
    expect(xs.size).toBe(2); // 只有 ±π 两列 x
  });
});

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
