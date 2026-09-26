from pathlib import Path
import re

p = Path("/Users/zgy/mapedi/web/src/ui/Viewport.svelte")
t = p.read_text()

# 1) Replace hitControlPoint + hitOnCurve block
old_hit_start = t.find("  /** 找屏幕坐标附近的控制点")
old_hit_end = t.find("  function buildProvinceFill")
if old_hit_start < 0 or old_hit_end < 0:
    # try after isFreeLayer
    old_hit_start = t.find("function hitControlPoint")
    # go back to comment
    old_hit_start = t.rfind("/**", 0, old_hit_start)
    old_hit_end = t.find("function buildProvinceFill")
print("hit", old_hit_start, old_hit_end)

new_hit = r'''  /** 路径控制点：points 为曲线上顶点 */
  function pathPointsOf(p: {
    points?: LonLat[];
    start?: LonLat;
    end?: LonLat;
    controls?: LonLat[];
  }): LonLat[] {
    if (p.points?.length) return p.points;
    return migrateToPathFeature(p as Record<string, unknown>).points;
  }

  function hitControlPoint(sx: number, sy: number, rect: DOMRect) {
    if (!world.paths) return null;
    const threshold = 8;
    for (let pi = 0; pi < world.paths.length; pi++) {
      const p = world.paths[pi];
      if (p.layerId !== focusLayer) continue;
      const pts = pathPointsOf(p);
      const xys = unwrapPathXY(pts);
      for (let ci = 0; ci < xys.length; ci++) {
        const sp = bestScreenInFrame(xys[ci].x, xys[ci].y, rect);
        if (!sp) continue;
        if (Math.hypot(sp.sx - sx, sp.sy - sy) < threshold)
          return { pathIdx: pi, ptIdx: ci };
      }
    }
    return null;
  }

  /** 点落在 Catmull-Rom 曲线附近时，返回最近段 */
  function hitOnCurve(sx: number, sy: number, rect: DOMRect) {
    if (!world.paths) return null;
    const threshold = 8;
    let best: {
      pathIdx: number;
      dist: number;
      seg: number;
      t: number;
      polyLen: number;
    } | null = null;
    for (let pi = 0; pi < world.paths.length; pi++) {
      const p = world.paths[pi];
      if (p.layerId !== focusLayer) continue;
      const pts = pathPointsOf(p);
      if (pts.length < 2) continue;
      const xys = unwrapPathXY(pts);
      const poly = catmullRomPolyline(xys, 10);
      let localBest = { dist: Infinity, seg: 0, t: 0 };
      for (let i = 0; i < poly.length - 1; i++) {
        const a = bestScreenInFrame(poly[i].x, poly[i].y, rect);
        const b = bestScreenInFrame(poly[i + 1].x, poly[i + 1].y, rect);
        if (!a || !b) continue;
        const dx = b.sx - a.sx;
        const dy = b.sy - a.sy;
        const len2 = dx * dx + dy * dy || 1;
        let t = ((sx - a.sx) * dx + (sy - a.sy) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        const dist = Math.hypot(a.sx + dx * t - sx, a.sy + dy * t - sy);
        if (dist < localBest.dist) localBest = { dist, seg: i, t };
      }
      if (localBest.dist <= threshold && (!best || localBest.dist < best.dist)) {
        best = {
          pathIdx: pi,
          dist: localBest.dist,
          seg: localBest.seg,
          t: localBest.t,
          polyLen: poly.length,
        };
      }
    }
    return best;
  }

'''
if old_hit_start > 0 and old_hit_end > old_hit_start:
    t = t[:old_hit_start] + new_hit + t[old_hit_end:]

# 2) Replace free-layer pointerdown block
old_dn = t.find("        if (isFreeLayer && drawActive) {")
# find matching end: "        return;\n      }\n" after pathDraft = null block
# Use unique start through "pathDraft = null" section end
start_block = t.find("      if (e.button === 0 && (drawActive || canPaint) && !spaceDown) {")
# find "if (isFreeLayer && drawActive)" inside
i = t.find("        if (isFreeLayer && drawActive) {", start_block)
j = t.find("        if (drawActive && drawTool === 'road')", i)
print("down", i, j)
new_down = r'''        if (isFreeLayer && drawActive) {
          const rect = canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const kind = focusLayer as PathKind;
          // 1) Shift+控制点 → 删除（至少保留 2 点）
          const hit = hitControlPoint(sx, sy, rect);
          if (hit) {
            if (e.shiftKey) {
              const path = world.paths![hit.pathIdx];
              const pts = pathPointsOf(path);
              if (pts.length > 2) {
                pts.splice(hit.ptIdx, 1);
                path.points = pts;
                editor.touchWorld();
                requestRender();
              }
              return;
            }
            dragPathIdx = hit.pathIdx;
            dragPtIdx = hit.ptIdx;
            canvas.setPointerCapture(e.pointerId);
            return;
          }
          // 2) 点击曲线上 → 插入控制点
          const onCurve = hitOnCurve(sx, sy, rect);
          if (onCurve) {
            const path = world.paths![onCurve.pathIdx];
            const pts = pathPointsOf(path);
            path.points = insertControlPointOnPath(
              pts,
              onCurve.seg,
              onCurve.t,
              onCurve.polyLen,
            );
            dragPathIdx = onCurve.pathIdx;
            dragPtIdx = Math.min(
              path.points.length - 1,
              Math.floor(onCurve.seg / 10) + 1,
            );
            canvas.setPointerCapture(e.pointerId);
            editor.touchWorld();
            requestRender();
            return;
          }
          // 3) 空白：新建 / 追加过点曲线（双击结束）
          const ll = llAt(e);
          if (!pathDraft) pathDraft = [ll];
          else pathDraft = [...pathDraft, ll];
          if (!world.paths) world.paths = [];
          if (pathDraft.length >= 2) {
            const idx = world.paths.findIndex((x) => x.id === `draft-${kind}`);
            const feat = createPathFeature(kind, pathDraft, `${kind} 草稿`);
            feat.id = `draft-${kind}`;
            if (idx >= 0) world.paths[idx] = feat;
            else world.paths.push(feat);
          }
          editor.touchWorld();
          requestRender();
          return;
        }
'''
if i > 0 and j > i:
    t = t[:i] + new_down + t[j:]

# 3) drag pointermove path points
t = t.replace(
    """          if (dragPtIdx === 0) p.start = ll;
          else if (dragPtIdx === p.controls.length + 1) p.end = ll;
          else p.controls[dragPtIdx - 1] = ll;""",
    """          const pts = pathPointsOf(p);
          if (dragPtIdx >= 0 && dragPtIdx < pts.length) {
            pts[dragPtIdx] = ll;
            p.points = pts;
          }""",
)

# 4) render handles for points + draft
old_rh = t.find("        const all = [p.start, ...p.controls, p.end];")
if old_rh > 0:
    t = t.replace(
        "        const all = [p.start, ...p.controls, p.end];",
        "        const all = pathPointsOf(p);",
    )

p.write_text(t)
print("viewport patched, len", len(t))
