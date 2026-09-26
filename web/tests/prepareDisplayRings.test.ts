import { describe, expect, it } from 'vitest';
import { chainEdgesToMidpointRings } from '../src/core/ring/build';
import { prepareDisplayRings } from '../src/core/ring/normalize';
import { splitOuterHoleRings, type MidRing } from '../src/core/ring/displayRing';
import { traceMidRing } from '../src/core/ring/trace';
import { project, defaultProjParams } from '../src/core/project/projections';

/** 断链判定（与旧 midRingHasJump 同规则）：只看 x 落差 > π；高纬大 y 差不算断链 */
function hasXJump(r: { pts: { x: number; y: number }[] }): boolean {
  for (let i = 1; i < r.pts.length; i++) {
    if (Math.abs(r.pts[i].x - r.pts[i - 1].x) > Math.PI) return true;
  }
  return false;
}

const pp = defaultProjParams();
const proj = (ll: { lon: number; lat: number }) => project(ll, 'mercator', pp);
const frameY = {
  minY: proj({ lon: 0, lat: -85 }).y,
  maxY: proj({ lon: 0, lat: 85 }).y,
};

describe('prepareDisplayRings — fill/stroke/shadow 共用', () => {
  it('普通闭环无跳变时原样返回，verts 与 pts 对齐', () => {
    const ring: MidRing = {
      pts: [
        { x: 0.1, y: 0.2 },
        { x: 0.4, y: 0.25 },
        { x: 0.35, y: 0.5 },
        { x: 0.15, y: 0.45 },
      ],
      verts: [
        { x: 0.25, y: 0.18 },
        { x: 0.42, y: 0.35 },
        { x: 0.3, y: 0.52 },
        { x: 0.1, y: 0.35 },
      ],
      closed: true,
    };
    const out = prepareDisplayRings(ring, frameY);
    expect(out).toHaveLength(1);
    expect(out[0].pts).toHaveLength(4);
    expect(out[0].verts).toHaveLength(4);
    expect(hasXJump(out[0])).toBe(false);
  });

  it('高纬大 y 差（x 连续）不跳变、不沿框线拉伸', () => {
    // 80°–84°：墨卡托 y 有落差但是正常投影；x 必须连续
    const y1 = proj({ lon: 0, lat: 80 }).y;
    const y2 = proj({ lon: 0.3, lat: 84 }).y;
    const y3 = proj({ lon: 0.15, lat: 82 }).y;
    const ring: MidRing = {
      pts: [
        { x: 0, y: y1 },
        { x: 0.3, y: y2 },
        { x: 0.15, y: y3 },
      ],
      verts: [
        { x: 0.15, y: (y1 + y2) / 2 },
        { x: 0.22, y: (y2 + y3) / 2 },
        { x: 0.08, y: (y3 + y1) / 2 },
      ],
      closed: true,
    };
    const out = prepareDisplayRings(ring, frameY);
    expect(out).toHaveLength(1);
    for (const p of out[0].pts) {
      expect(p.y).toBeGreaterThan(frameY.maxY * 0.5);
      // 不得被压到外框纬线（旧误伤路径）
      if (Math.abs(p.y - frameY.maxY) < 1e-9) continue;
    }
    expect(hasXJump(out[0])).toBe(false);
  });

  it('verts 对齐段中点 unwrap，不飞到对面半球', () => {
    // 已连续的跨日界线链（unwrap 后 x≈3.0→3.5）
    const ring: MidRing = {
      pts: [
        { x: 3.0, y: 0.1 },
        { x: 3.28, y: 0.12 },
        { x: 3.48, y: 0.2 },
      ],
      verts: [
        { x: 3.1, y: 0.1 },
        { x: 3.38, y: 0.15 },
        { x: 3.24, y: 0.2 },
      ],
      closed: true,
    };
    const out = prepareDisplayRings(ring, frameY);
    expect(out.length).toBeGreaterThanOrEqual(1);
    for (const piece of out) {
      expect(piece.verts.length).toBe(piece.pts.length);
      for (let i = 0; i < piece.verts.length; i++) {
        const a = piece.pts[i];
        const b = piece.pts[(i + 1) % piece.pts.length];
        const v = piece.verts[i];
        const mid = (a.x + b.x) / 2;
        expect(Math.abs(v.x - mid)).toBeLessThan(0.5);
      }
    }
  });

  it('raw 跨日界线链 prepare 后 pts 连续、vert 贴段', () => {
    const ring: MidRing = {
      pts: [
        { x: 3.0, y: 0.1 },
        { x: -3.0, y: 0.12 },
        { x: -2.8, y: 0.2 },
      ],
      verts: [
        { x: 3.1, y: 0.1 },
        { x: -3.1, y: 0.15 },
        { x: -2.9, y: 0.2 },
      ],
      closed: true,
    };
    const out = prepareDisplayRings(ring, frameY);
    for (const piece of out) {
      for (let i = 1; i < piece.pts.length; i++) {
        expect(Math.abs(piece.pts[i].x - piece.pts[i - 1].x)).toBeLessThan(Math.PI);
      }
      for (let i = 0; i < piece.verts.length; i++) {
        const a = piece.pts[i];
        const b = piece.pts[(i + 1) % piece.pts.length];
        const mid = (a.x + b.x) / 2;
        expect(Math.abs(piece.verts[i].x - mid)).toBeLessThan(0.8);
      }
    }
  });

  it('真极冠（y 出框 + x 近绕圈）沿框线闭合，verts 对齐', () => {
    const yPole = proj({ lon: 0, lat: 89 }).y;
    expect(Math.abs(yPole)).toBeGreaterThan(Math.abs(frameY.maxY) * 1.05);
    // x 跨度 ≈ 2.5+2.5=5 > 0.85π，且 y 出框
    const ring: MidRing = {
      pts: [
        { x: -2.5, y: yPole },
        { x: 0, y: yPole * 0.98 },
        { x: 2.5, y: yPole },
      ],
      verts: [
        { x: -1.2, y: yPole },
        { x: 1.2, y: yPole },
        { x: 0, y: yPole },
      ],
      closed: true,
    };
    const out = prepareDisplayRings(ring, frameY, 'north');
    expect(out).toHaveLength(1);
    expect(out[0].closed).toBe(true);
    expect(out[0].pts.length).toBe(out[0].verts.length);
    const edgeY = frameY.maxY;
    const closes = out[0].pts.filter((p) => Math.abs(p.y - edgeY) < 1e-6);
    expect(closes.length).toBeGreaterThanOrEqual(2);
  });

  it('高纬小跨度断链不补极冠框边（非绕行环原样返回）', () => {
    const yHi = proj({ lon: 0, lat: 88 }).y;
    // xSpan 很小，只在日界线附近断开
    const cutRing: MidRing = {
      pts: [
        { x: 2.8, y: yHi },
        { x: 3.3, y: yHi * 0.99 },
        { x: -3.3, y: yHi * 0.98 },
      ],
      verts: [
        { x: 3.05, y: yHi },
        { x: 0, y: yHi },
        { x: -3.0, y: yHi },
      ],
      closed: true,
    };
    const out = prepareDisplayRings(cutRing, frameY, 'north');
    // 不是极冠框线：任何输出点不得落在框线上（非绕行环 winding=0，不补虚边）
    for (const piece of out) {
      const onFrame = piece.pts.filter((p) => Math.abs(p.y - frameY.maxY) < 1e-6).length;
      expect(onFrame).toBe(0);
    }
  });

  it('高纬大 y 差不算断链：prepare 后单段且 x 连续', () => {
    const y1 = proj({ lon: 0, lat: 80 }).y;
    const y2 = proj({ lon: 0.2, lat: 89 }).y;
    const ring: MidRing = {
      pts: [
        { x: 0, y: y1 },
        { x: 0.2, y: y2 },
        { x: 0.4, y: y1 },
      ],
      verts: [],
      closed: false,
    };
    const out = prepareDisplayRings(ring, frameY);
    expect(out).toHaveLength(1);
    expect(hasXJump(out[0])).toBe(false);
  });

  it('退化/稀疏 MidRing 不读 undefined.y', () => {
    const ctx = {
      beginPath() {}, moveTo() {}, lineTo() {}, bezierCurveTo() {}, closePath() {},
      stroke() {}, fill() {}, clip() {}, save() {}, restore() {},
      strokeStyle: '', fillStyle: '', lineWidth: 1, globalAlpha: 1,
      lineJoin: '', lineCap: '', shadowBlur: 0, shadowColor: '',
    } as unknown as CanvasRenderingContext2D;
    const cases: MidRing[] = [
      { pts: [], verts: [], closed: true },
      { pts: [{ x: 0, y: 0 }], verts: [], closed: true },
      { pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }], verts: [], closed: true },
      {
        pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
        verts: [undefined as never, { x: 0.5, y: 0 }, undefined as never],
        closed: true,
      },
      {
        pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
        verts: [{ x: 0.5, y: 0 }],
        closed: true,
      },
      {
        pts: [{ x: 0, y: 0 }, { x: 1, y: 0 }, undefined as never, { x: 0, y: 1 }],
        verts: [],
        closed: true,
      },
      {
        pts: [{ x: -2.5, y: 4.7 }, { x: 0, y: 4.7 }, { x: 2.5, y: 4.7 }],
        verts: [],
        closed: false,
      },
    ];
    for (const ring of cases) {
      const out = prepareDisplayRings(ring, frameY);
      for (const p of out) {
        expect(() => splitOuterHoleRings([p])).not.toThrow();
        expect(() => traceMidRing(ctx, p, 0.65)).not.toThrow();
        expect(() => hasXJump(p)).not.toThrow();
        expect(p.pts.every((q) => q && Number.isFinite(q.y))).toBe(true);
        expect(p.verts.length).toBe(p.pts.length);
      }
    }
  });

  it('chainEdgesToMidpointRings 为闭环补齐 verts，长度等于 pts', () => {
    const edges = [
      { p0: { x: 0, y: 0 }, p1: { x: 1, y: 0 } },
      { p0: { x: 1, y: 0 }, p1: { x: 1, y: 1 } },
      { p0: { x: 1, y: 1 }, p1: { x: 0, y: 1 } },
      { p0: { x: 0, y: 1 }, p1: { x: 0, y: 0 } },
    ];
    const rings = chainEdgesToMidpointRings(edges);
    expect(rings.length).toBeGreaterThanOrEqual(1);
    const r = rings.find((x) => x.closed) ?? rings[0];
    expect(r.pts.length).toBe(r.verts.length);
  });
});
