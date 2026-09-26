import { describe, expect, it } from 'vitest';
import {
  catmullRomPolyline,
  deleteControlPoint,
  insertControlPointOnPath,
  migrateToPathFeature,
} from '../src/core/paths';

describe('path features', () => {
  it('catmullRom passes through control points for 2-pt line', () => {
    const poly = catmullRomPolyline(
      [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
      ],
      4,
    );
    expect(poly[0]).toEqual({ x: 0, y: 0 });
    expect(poly[poly.length - 1]).toEqual({ x: 2, y: 0 });
  });

  it('catmullRom interpolates through mid control point', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 0 },
    ];
    const poly = catmullRomPolyline(pts, 8);
    const mid = poly.reduce(
      (best, p) => {
        const d = Math.hypot(p.x - 1, p.y - 1);
        return d < best.d ? { d, p } : best;
      },
      { d: Infinity, p: pts[0] },
    );
    expect(mid.d).toBeLessThan(0.05);
  });

  it('insertControlPointOnPath inserts at projected segment, not only at end', () => {
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 10, lat: 0 },
      { lon: 20, lat: 0 },
    ];
    // 命中第 0 控制段中点（折线段 ~5，samplesPerSeg=10）
    const { points, index } = insertControlPointOnPath(pts, 5, 0.5);
    expect(points.length).toBe(4);
    expect(index).toBe(1);
    expect(points[1].lon).toBeCloseTo(5, 5);
  });

  it('migrates legacy bezier path to points', () => {
    const legacy = {
      id: 'x',
      layerId: 'road',
      name: 'r',
      start: { lon: 0, lat: 0 },
      controls: [{ lon: 1, lat: 1 }],
      end: { lon: 2, lat: 0 },
      color: '#fff',
    };
    const p = migrateToPathFeature(legacy);
    expect(p.points.length).toBe(3);
    expect(p.points[1].lon).toBe(1);
  });

  it('endpoint delete promotes next control as new end', () => {
    const pts = [
      { lon: 0, lat: 0 },
      { lon: 5, lat: 1 },
      { lon: 10, lat: 0 },
      { lon: 15, lat: 2 },
    ];
    const afterStart = deleteControlPoint(pts, 0);
    expect(afterStart.length).toBe(3);
    expect(afterStart[0].lon).toBe(5);
    const afterEnd = deleteControlPoint(pts, pts.length - 1);
    expect(afterEnd.length).toBe(3);
    expect(afterEnd[afterEnd.length - 1].lon).toBe(10);
  });
});
