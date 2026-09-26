from pathlib import Path

p = Path("/Users/zgy/mapedi/web/src/ui/Viewport.svelte")
t = p.read_text()

# Update imports
t = t.replace(
    """  import {
    catmullRomPolyline,
    createPathFeature,
    insertControlPointOnPath,
    migrateToPathFeature,
    nearestOnPolyline,
    type PathKind,
  } from '../core/paths';""",
    """  import {
    catmullRomPolyline,
    createPathFeature,
    deleteControlPoint,
    insertControlPointOnPath,
    migrateToPathFeature,
    solePathOfKind,
    type PathKind,
  } from '../core/paths';""",
)

# Replace entire free-layer pointerdown + handle drawing
start = t.find("        if (isFreeLayer && drawActive) {")
end = t.find("        if (drawActive && drawTool === 'road')")
print("down", start, end)
assert start > 0 and end > start

new_down = r'''        if (isFreeLayer && drawActive) {
          const rect = canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const kind = focusLayer as PathKind;
          if (!world.paths) world.paths = [];

          /** 一层只允许一条曲线 */
          let path = solePathOfKind(world.paths, kind);
          const pathPoints = () => (path ? pathPointsOf(path) : []);

          const projectOnto = (pts: LonLat[], cx: number, cy: number) => {
            const xys = unwrapPathXY(pts);
            const poly = catmullRomPolyline(xys, 10);
            let best = { dist: Infinity, seg: 0, t: 0 };
            for (let i = 0; i < poly.length - 1; i++) {
              const a = bestScreenInFrame(poly[i].x, poly[i].y, rect);
              const b = bestScreenInFrame(poly[i + 1].x, poly[i + 1].y, rect);
              if (!a || !b) continue;
              const dx = b.sx - a.sx;
              const dy = b.sy - a.sy;
              const len2 = dx * dx + dy * dy || 1;
              let tt = ((cx - a.sx) * dx + (cy - a.sy) * dy) / len2;
              tt = Math.max(0, Math.min(1, tt));
              const dist = Math.hypot(a.sx + dx * tt - cx, a.sy + dy * tt - cy);
              if (dist < best.dist) best = { dist, seg: i, t: tt };
            }
            return best;
          };

          const hit = hitControlPoint(sx, sy, rect);
          if (hit && path && hit.pathIdx === world.paths.indexOf(path)) {
            if (e.shiftKey) {
              const pts = pathPoints();
              path.points = deleteControlPoint(pts, hit.ptIdx);
              editor.touchWorld();
              requestRender();
              return;
            }
            dragPathIdx = hit.pathIdx;
            dragPtIdx = hit.ptIdx;
            canvas.setPointerCapture(e.pointerId);
            return;
          }
          // hit 其它层路径也允许拖/删（若误配 layer）
          if (hit) {
            if (e.shiftKey) {
              const p2 = world.paths[hit.pathIdx];
              const pts = pathPointsOf(p2);
              p2.points = deleteControlPoint(pts, hit.ptIdx);
              editor.touchWorld();
              requestRender();
              return;
            }
            dragPathIdx = hit.pathIdx;
            dragPtIdx = hit.ptIdx;
            canvas.setPointerCapture(e.pointerId);
            return;
          }

          const ll = llAt(e);

          // 尚无曲线：前两点 → 直线
          if (!path) {
            if (!pathDraft) {
              pathDraft = [ll];
            } else if (pathDraft.length === 1) {
              pathDraft = [pathDraft[0], ll];
              const feat = createPathFeature(kind, pathDraft);
              path = feat;
              world.paths.push(feat);
              pathDraft = null;
              dragPathIdx = world.paths.indexOf(feat);
              dragPtIdx = 1;
              canvas.setPointerCapture(e.pointerId);
              editor.touchWorld();
              requestRender();
            }
            return;
          }

          // 已有曲线：只编辑这一条。点在线条附近 → 投影最近点插入控制点
          const pts = pathPoints();
          if (pts.length < 2) return;
          const h = projectOnto(pts, sx, sy);
          const pickPx = Math.max(12, (brushRadiusDeg || 1.5) * cam.scale * 0.08);
          if (h.dist <= pickPx) {
            const { points: nextPts, index } = insertControlPointOnPath(pts, h.seg, h.t);
            path.points = nextPts;
            dragPathIdx = world.paths.indexOf(path);
            dragPtIdx = index;
            canvas.setPointerCapture(e.pointerId);
            editor.touchWorld();
            requestRender();
          }
          return;
        }
'''
t = t[:start] + new_down + t[end:]

# Replace handle drawing block
hstart = t.find("    // 路/航/河：显示本层**全部**控制点")
if hstart < 0:
    hstart = t.find("    // 路/航/河：控制点")
hend = t.find("  }\n\n  function buildBiomeFill")
if hend < 0:
    hend = t.find("  function buildBiomeFill")
print("handles", hstart, hend)

new_h = r'''    // 路/航/河编辑：全部控制点 + 到曲线最近点的细虚线
    if (isFreeLayer && drawActive) {
      const rect = canvas.getBoundingClientRect();
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const kind = focusLayer as PathKind;
      const path = solePathOfKind(world.paths, kind);
      const list: { pts: LonLat[]; pi: number; isPath: boolean }[] = [];
      if (path && world.paths) {
        list.push({ pts: pathPointsOf(path), pi: world.paths.indexOf(path), isPath: true });
      }
      if (pathDraft && pathDraft.length >= 1) {
        list.push({ pts: pathDraft, pi: -1, isPath: false });
      }

      for (const item of list) {
        const xys = unwrapPathXY(item.pts);
        const poly =
          item.pts.length >= 2 ? catmullRomPolyline(xys, 10) : xys;
        for (let ci = 0; ci < xys.length; ci++) {
          const sp = bestScreenInFrame(xys[ci].x, xys[ci].y, rect);
          if (!sp) continue;
          // 控制点 → 曲线最近点 虚线
          if (poly.length >= 2) {
            let best = { dist: Infinity, px: 0, py: 0 };
            for (let i = 0; i < poly.length - 1; i++) {
              const a = bestScreenInFrame(poly[i].x, poly[i].y, rect);
              const b = bestScreenInFrame(poly[i + 1].x, poly[i + 1].y, rect);
              if (!a || !b) continue;
              const dx = b.sx - a.sx;
              const dy = b.sy - a.sy;
              const len2 = dx * dx + dy * dy || 1;
              let tt = ((sp.sx - a.sx) * dx + (sp.sy - a.sy) * dy) / len2;
              tt = Math.max(0, Math.min(1, tt));
              const px = a.sx + dx * tt;
              const py = a.sy + dy * tt;
              const dist = Math.hypot(px - sp.sx, py - sp.sy);
              if (dist < best.dist) best = { dist, px, py };
            }
            if (Number.isFinite(best.dist)) {
              ctx.beginPath();
              ctx.setLineDash([3, 3]);
              ctx.strokeStyle = 'rgba(240,195,106,0.55)';
              ctx.lineWidth = 1;
              ctx.moveTo(sp.sx, sp.sy);
              ctx.lineTo(best.px, best.py);
              ctx.stroke();
              ctx.setLineDash([]);
            }
          }
          const dragging = dragPathIdx === item.pi && dragPtIdx === ci;
          const isEnd = ci === 0 || ci === xys.length - 1;
          ctx.beginPath();
          ctx.arc(sp.sx, sp.sy, dragging ? 7 : isEnd ? 6 : 5, 0, Math.PI * 2);
          ctx.fillStyle = dragging
            ? '#f0c36a'
            : isEnd
              ? 'rgba(255,255,255,0.95)'
              : 'rgba(240,195,106,0.95)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.55)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
      }
      ctx.restore();
    }
'''
if hstart > 0 and hend > hstart:
    t = t[:hstart] + new_h + t[hend:]

p.write_text(t)
print("done", len(t))
