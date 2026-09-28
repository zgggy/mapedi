// ===== 归档自 render/gl/geometry.ts：内阴影 Φ 剖面渐隐条带 =====
/**
 * 折线 → 内阴影渐隐条带（连续 ribbon，无重叠关节）。
 * 每点 2 顶点：u=-2.5 / +2.5（单位 = uHalfW = 阴影半宽 w）；
 * 片元 α = Φ(2−2|u|) − Φ(−2−2|u|) —— 半宽 w、σ=w/2 矩形描边的高斯剖面，
 * 与 Canvas「clip(fill) + blur(2w 描边)」沿直线段数学等价；外侧半条由填充 stencil 裁掉。
 */
function buildFadeRibbon(pts: Pt[]): { verts: Float32Array; idx: Uint32Array } | null {
  const n = pts.length;
  if (n < 2) return null;
  const verts = new Float32Array(n * 2 * 5);
  const idx = new Uint32Array((n - 1) * 6);
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const a = pts[i > 0 ? i - 1 : 0];
    const b = pts[i < n - 1 ? i + 1 : n - 1];
    let nx = b.y - a.y;
    let ny = -(b.x - a.x);
    const l = Math.hypot(nx, ny) || 1;
    nx /= l;
    ny /= l;
    const o = i * 10;
    verts[o] = p.x; verts[o + 1] = p.y; verts[o + 2] = nx; verts[o + 3] = ny; verts[o + 4] = -2.5;
    verts[o + 5] = p.x; verts[o + 6] = p.y; verts[o + 7] = nx; verts[o + 8] = ny; verts[o + 9] = 2.5;
    if (i < n - 1) {
      const k = i * 6;
      const v0 = i * 2;
      idx[k] = v0; idx[k + 1] = v0 + 1; idx[k + 2] = v0 + 2;
      idx[k + 3] = v0 + 1; idx[k + 4] = v0 + 3; idx[k + 5] = v0 + 2;
    }
  }
  return { verts, idx };
}

