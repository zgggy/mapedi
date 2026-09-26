from pathlib import Path

p = Path("/Users/zgy/mapedi/web/src/render/layers.ts")
t = p.read_text()
start = t.find("/** 贝塞尔路径：道路")
if start < 0:
    start = t.find("export const pathsLayer")
end = t.find("/** 在贝塞尔折线上取参数")
if end < 0:
    end = t.find("export const labelsLayer")
print("start", start, "end", end)
assert start > 0 and end > start

new = r'''/** 过点曲线路径：道路（双线）/ 航线（虚线）/ 河流（渐粗） */
export const pathsLayer: RenderLayer = {
  name: 'paths',
  repeat: true,
  draw(env) {
    const { ctx, world, cam, focus } = env;
    if (!world.paths?.length) return;
    beginWorld(ctx, env);
    clipToMapFrame(ctx, env);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const path of world.paths) {
      if (!path.points || path.points.length < 2) continue;
      const kind = path.layerId;
      const dim = focus === kind ? 1 : 0.45;
      ctx.globalAlpha = dim;

      const ctrl: Pt[] = [];
      let prev: Pt | null = null;
      for (const ll of path.points) {
        const p = projectPt(env, ll);
        const u: Pt = prev
          ? { x: unwrapXAgainst(prev.x, p.x), y: p.y }
          : { x: p.x, y: p.y };
        ctrl.push(u);
        prev = u;
      }
      const poly = catmullRomPolyline(ctrl, 10);
      if (poly.length < 2) continue;

      const strokePoly = (width: number, color: string, dash: number[]) => {
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y);
        ctx.setLineDash(dash.map((d) => d / cam.scale));
        ctx.strokeStyle = color;
        ctx.lineWidth = width / cam.scale;
        ctx.stroke();
        ctx.setLineDash([]);
      };

      if (kind === 'road') {
        strokePoly(3.2, 'rgba(30,24,12,0.4)', []);
        strokePoly(1.5, path.color || '#e8c36a', []);
      } else if (kind === 'route') {
        strokePoly(2.0, 'rgba(20,40,60,0.3)', [2, 3]);
        strokePoly(1.3, path.color || '#7ec8e3', [7, 5]);
      } else {
        const w0 = (path.widthStart ?? 0.5) * 2.4;
        const w1 = (path.widthEnd ?? 1.0) * 2.4;
        const n = poly.length;
        for (let i = 0; i < n - 1; i++) {
          const t = i / (n - 1);
          const w = w0 + (w1 - w0) * t;
          const a = poly[i];
          const b = poly[i + 1];
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.strokeStyle = 'rgba(10,28,48,0.35)';
          ctx.lineWidth = (w * 1.45) / cam.scale;
          ctx.stroke();
          ctx.strokeStyle = path.color || '#3d8ec9';
          ctx.lineWidth = w / cam.scale;
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore();
    endWorld(ctx);
  },
};

'''
p.write_text(t[:start] + new + t[end:])
print("pathsLayer replaced")
