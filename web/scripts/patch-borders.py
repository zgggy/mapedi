from pathlib import Path

p = Path("/Users/zgy/mapedi/web/src/render/layers.ts")
text = p.read_text()
start = text.find(
    "/** 行政/语义边界：sharedEdges→按 owner 分组→链成顶点环→法线内收→贝塞尔平滑 */"
)
end = text.find("/** 贝塞尔路径：道路（细实线）、航线（虚线）、河流（渐粗） */")
print("start", start, "end", end)
assert start > 0 and end > start

new = """/** 行政/语义边界：每个 owner 的 cell 并集 → 外边界多边形环 → 平滑 / 内收 / 专属色内阴影 */
export const bordersLayer: RenderLayer = {
  name: 'borders',
  repeat: true,
  draw(env) {
    const { ctx, world, cam, style, focus } = env;
    if (focus === 'height' || !world.sharedEdges?.size) return;

    const ownerMap = buildOwnerMap(world, focus);
    if (!ownerMap.size) return;

    const regionById = new Map(world.regions.map((r) => [r.id, r]));
    const owners = new Set(ownerMap.values());

    beginWorld(ctx, env);
    clipToMapFrame(ctx, env);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const inset = 0.004;
    const bw = style.border.width;

    function darken(hex: string, f = 0.6): string {
      const m = /^#?([0-9a-f]{6})$/i.exec(hex);
      if (!m) return hex;
      const v = parseInt(m[1], 16);
      return `rgb(${Math.floor(((v >> 16) & 255) * f)},${Math.floor(((v >> 8) & 255) * f)},${Math.floor((v & 255) * f)})`;
    }

    for (const oid of owners) {
      const region = regionById.get(oid);
      const rings = ownerBoundaryRings(world, ownerMap, oid, (ll) => projectPt(env, ll));
      if (!rings.length) continue;
      const baseColor = region ? darken(region.color, 0.75) : style.border.color;
      const excl = region?.exclusiveColor;

      for (const ring of rings) {
        const cont = unwrapChainX(ring);
        if (cont.length < 3) continue;
        ctx.beginPath();
        traceSmoothRing(ctx, cont, true);
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = bw / cam.scale;
        ctx.stroke();

        const inner = insetRing(cont, inset);
        ctx.beginPath();
        traceSmoothRing(ctx, inner, true);
        if (excl) {
          ctx.strokeStyle = excl;
          ctx.globalAlpha = 0.55;
          ctx.lineWidth = (bw * 1.6) / cam.scale;
        } else {
          ctx.strokeStyle = baseColor;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = (bw * 0.6) / cam.scale;
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
    endWorld(ctx);
  },
};

"""

p.write_text(text[:start] + new + text[end:])
print("replaced ok")
