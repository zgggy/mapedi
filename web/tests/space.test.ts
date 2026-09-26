import { describe, expect, it } from 'vitest';
import {
  WORLD_PERIOD,
  chainSegments,
  frameClipInUserSpace,
  frameRect,
  projectRing,
  screenToContentX,
  unwrapChainX,
  unwrapSegments,
  unwrapXAgainst,
  vertexKey,
  worldCopyDxs,
  worldToScreenX,
  wrapLon,
  wrapPeriod,
} from '../src/render/space';

const PI = Math.PI;

describe('space wrap/unwrap', () => {
  it('wrapPeriod folds into (-π, π]', () => {
    expect(wrapPeriod(0)).toBeCloseTo(0);
    expect(wrapPeriod(PI + 0.1)).toBeCloseTo(PI + 0.1 - WORLD_PERIOD);
    expect(wrapPeriod(-PI)).toBeCloseTo(PI); // -π maps to π (half-open)
  });

  it('unwrapXAgainst keeps continuity across dateline', () => {
    // 179° → 181° 应展开为 +360° 而不是跳回
    const a = (179 * PI) / 180;
    const b = (-179 * PI) / 180; // 等价 181°
    const u = unwrapXAgainst(a, b);
    expect(u).toBeGreaterThan(a);
    expect(u - a).toBeCloseTo((2 * PI) / 180, 5);
  });

  it('unwrapChainX produces continuous polyline', () => {
    const pts = [
      { x: (170 * PI) / 180, y: 0 },
      { x: (-175 * PI) / 180, y: 0 },
      { x: (-170 * PI) / 180, y: 0 },
    ];
    const chain = unwrapChainX(pts);
    for (let i = 1; i < chain.length; i++) {
      expect(Math.abs(chain[i].x - chain[i - 1].x)).toBeLessThan(PI);
    }
    expect(chain[1].x).toBeGreaterThan(chain[0].x);
  });

  it('projectRing unwraps lon before project-like mapping', () => {
    // 用恒等“投影”x=lon 弧度，便于断言
    const ring = [
      { lon: 179, lat: 0 },
      { lon: -179, lat: 0 },
      { lon: -178, lat: 0 },
    ];
    const pts = projectRing(ring, (ll) => ({ x: (ll.lon * PI) / 180, y: 0 }));
    expect(pts[1].x).toBeGreaterThan(pts[0].x);
  });
});

describe('world copies compose with contentOffset', () => {
  const cam = { x: 0, y: 0, scale: 100 };
  const viewW = 800;

  it('includes primary offset and ±period copies near origin', () => {
    const dxs = worldCopyDxs(0, cam, viewW);
    expect(dxs.some((d) => Math.abs(d) < 1e-9)).toBe(true);
    expect(dxs.some((d) => Math.abs(d - WORLD_PERIOD) < 1e-9)).toBe(true);
    expect(dxs.some((d) => Math.abs(d + WORLD_PERIOD) < 1e-9)).toBe(true);
  });

  it('composes contentOffset instead of replacing it', () => {
    const off = 0.5;
    const dxs = worldCopyDxs(off, cam, viewW);
    expect(dxs.some((d) => Math.abs(d - off) < 1e-9)).toBe(true);
    expect(dxs.some((d) => Math.abs(d - (off + WORLD_PERIOD)) < 1e-9)).toBe(true);
    expect(dxs.some((d) => Math.abs(d - (off - WORLD_PERIOD)) < 1e-9)).toBe(true);
  });

  it('tracks camera far from origin without wrapping', () => {
    // 中键拖动后 cam.x 可任意大：副本应落在相机附近，而不是仍钉在 0 附近
    const farCam = { x: 20, y: 0, scale: 100 };
    const dxs = worldCopyDxs(0, farCam, viewW);
    const near = dxs.some((d) => Math.abs(d + 20) < WORLD_PERIOD);
    // 存在某个副本使内容 0 出现在视口附近：|0+dx-cam.x| < halfW+period
    const halfW = viewW / 2 / farCam.scale;
    const visible = dxs.some((d) => Math.abs(d - farCam.x) < halfW + WORLD_PERIOD);
    expect(visible).toBe(true);
    expect(near || visible).toBe(true);
  });

  it('screen inverse uses the same drawDx', () => {
    const drawDx = 0.3;
    const x = 1.2;
    const sx = worldToScreenX(x, cam, viewW, drawDx);
    const back = screenToContentX(sx, cam, viewW, drawDx);
    expect(back).toBeCloseTo(x, 6);
  });
});

describe('frameRect', () => {
  it('is fixed in projected space and independent of camera', () => {
    const project = (ll: { lon: number; lat: number }) => ({
      x: (ll.lon * PI) / 180,
      y: (ll.lat * PI) / 180,
    });
    const fr = frameRect(project);
    expect(fr.minX).toBeCloseTo(-PI, 5);
    expect(fr.maxX).toBeCloseTo(PI, 5);
  });
});

describe('chainSegments', () => {
  it('chains a simple open polyline', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    const c = { x: 2, y: 0 };
    const chains = chainSegments([
      [a, b],
      [b, c],
    ]);
    expect(chains.length).toBe(1);
    expect(chains[0].closed).toBe(false);
    expect(chains[0].pts.length).toBeGreaterThanOrEqual(3);
  });

  it('chains across antimeridian when vertices are twins in wrap space', () => {
    // 同一球面顶点：一侧存 +π-ε，另一侧存 -π+ε
    const eps = 0.01;
    const vW = { x: PI - eps, y: 0 }; // 西侧
    const vE = { x: -PI + eps, y: 0 }; // 东侧（wrap 后与 vW 不同点，但是链上的中间点）
    const a = { x: PI - 0.05, y: 0 };
    const b = { x: PI + 0.02, y: 0 }; // unwrap 后越过 π
    // 用 wrap 键应把 b 与 -π+0.02 视为同一顶点
    const bTwin = { x: -PI + 0.02, y: 0 };
    expect(vertexKey(b)).toBe(vertexKey(bTwin));
    const c = { x: -PI + 0.05, y: 0 };
    const chains = chainSegments([
      [a, b],
      [bTwin, c],
    ]);
    expect(chains.length).toBe(1);
    expect(chains[0].pts.length).toBeGreaterThanOrEqual(3);
    // 输出连续：相邻点横向差 < π
    const pts = chains[0].pts;
    for (let i = 1; i < pts.length; i++) {
      expect(Math.abs(pts[i].x - pts[i - 1].x)).toBeLessThan(PI);
    }
    void vW;
    void vE;
  });

  it('unwrapSegments makes segment ends continuous', () => {
    const segs: [{ x: number; y: number }, { x: number; y: number }][] = [
      [
        { x: (179 * PI) / 180, y: 0 },
        { x: (-179 * PI) / 180, y: 0 },
      ],
    ];
    const u = unwrapSegments(segs);
    expect(u[0][1].x).toBeGreaterThan(u[0][0].x);
  });
});

describe('frameClipInUserSpace', () => {
  it('compensates drawDx so clip stays fixed on screen', () => {
    const fr = { minX: -PI, maxX: PI, minY: -1, maxY: 1 };
    const clip0 = frameClipInUserSpace(fr, 0);
    expect(clip0.minX).toBeCloseTo(-PI);
    expect(clip0.maxX).toBeCloseTo(PI);

    const dx = -WORLD_PERIOD; // 世界副本
    const clip = frameClipInUserSpace(fr, dx);
    // 用户空间可见 x ∈ [fr.min - dx, fr.max - dx] = [π, 3π]
    expect(clip.minX).toBeCloseTo(PI);
    expect(clip.maxX).toBeCloseTo(3 * PI);

    // 内容点 x=3.2（unwrap 刺）在 dx=-2π 时应落在 clip 内
    const x = 3.2;
    expect(x).toBeGreaterThanOrEqual(clip.minX);
    expect(x).toBeLessThanOrEqual(clip.maxX);
  });
});

describe('wrapLon', () => {
  it('wraps degrees into (-180, 180]', () => {
    expect(wrapLon(181)).toBeCloseTo(-179);
    expect(wrapLon(-181)).toBeCloseTo(179);
    expect(wrapLon(10)).toBe(10);
  });
});
