// ===== 归档自 render/layers.ts：bgLayer（GL 已画 bg） =====
export const bgLayer: RenderLayer = {
  name: 'bg',
  repeat: false,
  draw(env) {
    const { ctx, style, dpr, w, h } = env;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = style.ocean;
    ctx.fillRect(0, 0, w, h);
  },
};



// ===== 归档自 render/layers.ts：cellsMeshLayer（GL 已画 cellsMesh） =====
/**
 * 地块网格层：每个 cell 只描边，不填色、不平滑（直线段）。
 * P0/P3：视口索引 + 合并 Path2D 一次 stroke。
 */
export const cellsMeshLayer: RenderLayer = {
  name: 'cellsMesh',
  repeat: true,
  draw(env) {
    const { ctx, world, cam, style, pcache, w, h, showCellMesh } = env;
    if (!showCellMesh) return;
    const pad = 2 / cam.scale;
    const drawDx = env.drawDx ?? env.contentOffsetX ?? 0;
    const viewL = cam.x - drawDx - w / 2 / cam.scale - pad;
    const viewR = cam.x - drawDx + w / 2 / cam.scale + pad;
    const viewT = cam.y + h / 2 / cam.scale + pad;
    const viewB = cam.y - h / 2 / cam.scale - pad;
    const ids = pcache.view.cellsInView({
      minX: viewL,
      maxX: viewR,
      minY: viewB,
      maxY: viewT,
    });
    if (!ids.length) return;
    beginWorld(ctx, env);
    clipToMapFrame(ctx, env);
    const stroke = style.cellStroke;
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = Math.max(stroke.width, 0.35) / cam.scale;
    ctx.lineJoin = 'miter';
    ctx.lineCap = 'butt';
    if (stroke.dash?.length) ctx.setLineDash(stroke.dash.map((d) => d / cam.scale));
    // 合并一次 stroke（P3 批处理）
    const batch = new Path2D();
    const period = projectionWorldPeriod(env.proj) ?? Math.PI * 2;
    for (const id of ids) {
      const polarOutline = pcache.polarOutlines.get(id);
      const poly = polarOutline ?? pcache.polys[id];
      if (!poly || poly.length < 6) continue;
      const p = cellPolyPath2D(pcache, id, poly, !!polarOutline, period);
      if (p) batch.addPath(p);
      else {
        batch.moveTo(poly[0], poly[1]);
        for (let i = 2; i < poly.length; i += 2) batch.lineTo(poly[i], poly[i + 1]);
        if (polarOutline) {
          batch.lineTo(unwrapXAgainst(poly[poly.length - 2], poly[0], period), poly[1]);
        } else {
          batch.closePath();
        }
      }
    }
    ctx.stroke(batch);
    ctx.setLineDash([]);
    ctx.restore();
    endWorld(ctx);
  },
};



// ===== 归档自 render/layers.ts：paintPieceParams（Canvas2D 元素画法） =====
/**
 * Canvas2D 元素画法（GL 不可用时的回退路径）。
 * 唯一样条路径：**同一 PieceParams.rings** 上做 fill / shadow / stroke。
 * 禁止 fill 用一套环、描边 unwrapChainX 另一套、阴影再 raw 环。
 * 内阴影 = clip(fill) + blur(2w 描边)——GL 的 Φ 剖面条带与其沿直线段数学等价。
 */
export function paintPieceParams(
  ctx: CanvasRenderingContext2D,
  piece: PieceParams,
): void {
  const sm = piece.smooth;
  const sc = piece.camScale;
  if (piece.fullFrame) {
    const f = piece.fullFrame;
    ctx.save();
    ctx.globalAlpha = f.alpha;
    ctx.fillStyle = f.color;
    ctx.fillRect(f.minX, f.minY, f.maxX - f.minX, f.maxY - f.minY);
    ctx.restore();
    return;
  }
  const live = piece.rings.filter((p) => p.pts.length >= 2);
  if (!live.length) return;
  const fill = new Path2D();
  const outline = new Path2D();
  for (const dx of piece.copies) {
    const transform = new DOMMatrix().translate(dx, 0);
    for (const ring of live) {
      if (ring.closed) {
        const p = ringPath2D(ring, sm, 'fill');
        if (p) fill.addPath(p, transform);
      }
      const p = ringPath2D(ring, sm, 'outline');
      if (p) outline.addPath(p, transform);
    }
  }

  // 所有周期副本共用一个 evenodd 遮罩，避免半透明重复着色。
  if (piece.fillOn) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, Math.min(1, piece.fillAlpha));
    ctx.fillStyle = piece.fillColor;
    ctx.fill(fill, 'evenodd');
    ctx.restore();
  }
  // 内阴影：clip 到填充 + 单遍 blur 描边
  if (piece.shadowW > 0 && piece.shadowAlpha > 0) {
    ctx.save();
    ctx.clip(fill, 'evenodd');
    const blurPx = (piece.shadowW * sc) / 2;
    ctx.filter = blurPx > 0.5 ? `blur(${blurPx.toFixed(1)}px)` : 'none';
    ctx.strokeStyle = piece.shadowColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.globalAlpha = piece.shadowAlpha;
    ctx.lineWidth = piece.shadowW * 2;
    ctx.stroke(outline);
    ctx.filter = 'none';
    ctx.restore();
  }
  if (piece.strokeW > 0 && piece.stroke !== 'transparent') {
    ctx.strokeStyle = piece.stroke;
    ctx.lineWidth = piece.strokeW;
    if (piece.selected) {
      ctx.shadowColor = piece.shadowColor;
      ctx.shadowBlur = 6 / sc;
    }
    ctx.stroke(outline);
    ctx.shadowBlur = 0;
  }
}



// ===== 归档自 render/layers.ts：elementsLayer（GL 已画元素） =====
/**
 * 元素层：**唯一展示接口**（选中 ≡ 显示）。
 * 对所有 shown 层的每个元素：边界内填充 + 元素边界（含内缘带）。
 * 海岸线（陆海界）**默认一直画**。选中元素最后画 → 最顶。
 *
 * fill / shadow / stroke 共用 `buildPieceParams` 的同一套环（禁止分叉预处理）；
 * GL 直绘消费同一份参数（见 render/gl/mapRenderer），两后端只差光栅化。
 */
export const elementsLayer: RenderLayer = {
  name: 'elements',
  repeat: false,
  draw(env) {
    const { ctx } = env;
    beginWorld(ctx, env, 0, true);
    clipToMapFrame(ctx, env, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const piece of buildPieceParams(env)) paintPieceParams(ctx, piece);
    ctx.restore();
    endWorld(ctx);
  },
};

