from pathlib import Path

p = Path("/Users/zgy/mapedi/web/src/ui/Viewport.svelte")
t = p.read_text()

old_block_start = t.find("        if (isFreeLayer && drawActive) {")
old_block_end = t.find("        if (drawActive && drawTool === 'road')")
print("block", old_block_start, old_block_end)
assert old_block_start > 0 and old_block_end > old_block_start

new_block = r'''        if (isFreeLayer && drawActive) {
          const rect = canvas.getBoundingClientRect();
          const sx = e.clientX - rect.left;
          const sy = e.clientY - rect.top;
          const kind = focusLayer as PathKind;
          if (!world.paths) world.paths = [];

          /** 在投影空间把点击投到某条路径曲线上最近点 */
          const projectOntoPath = (pts: LonLat[], clickX: number, clickY: number) => {
            const xys = unwrapPathXY(pts);
            const poly = catmullRomPolyline(xys, 10);
            // 在屏幕空间找最近，再映射回折线段号
            let best = { dist: Infinity, seg: 0, t: 0, polyLen: poly.length };
            for (let i = 0; i < poly.length - 1; i++) {
              const a = bestScreenInFrame(poly[i].x, poly[i].y, rect);
              const b = bestScreenInFrame(poly[i + 1].x, poly[i + 1].y, rect);
              if (!a || !b) continue;
              const dx = b.sx - a.sx;
              const dy = b.sy - a.sy;
              const len2 = dx * dx + dy * dy || 1;
              let tt = ((clickX - a.sx) * dx + (clickY - a.sy) * dy) / len2;
              tt = Math.max(0, Math.min(1, tt));
              const dist = Math.hypot(a.sx + dx * tt - sx, a.sy + dy * tt - sy);
              if (dist < best.dist) best = { dist, seg: i, t: tt, polyLen: poly.length };
            }
            return best;
          };

          // 1) Shift + 控制点 → 删除（≥3 点才可删，保证仍有曲线）
          const hit = hitControlPoint(sx, sy, rect);
          if (hit) {
            if (e.shiftKey) {
              const path = world.paths[hit.pathIdx];
              const pts = pathPointsOf(path);
              if (pts.length > 2) {
                pts.splice(hit.ptIdx, 1);
                path.points = pts;
                editor.touchWorld();
                requestRender();
              }
              return;
            }
            // 拖动该控制点
            dragPathIdx = hit.pathIdx;
            dragPtIdx = hit.ptIdx;
            canvas.setPointerCapture(e.pointerId);
            return;
          }

          // 2) 草稿只有 1 点：第二点作为端点，形成初始曲线
          if (pathDraft && pathDraft.length === 1) {
            const ll = llAt(e);
            pathDraft = [pathDraft[0], ll];
            const feat = createPathFeature(kind, pathDraft);
            feat.id = `draft-${kind}`;
            world.paths = world.paths.filter((x) => x.id !== `draft-${kind}`);
            world.paths.push(feat);
            editor.touchWorld();
            requestRender();
            return;
          }

          // 3) 已有草稿曲线（≥2 点）：**点击投影到曲线最近点** 插入控制点
          if (pathDraft && pathDraft.length >= 2) {
            const hitC = projectOntoPath(pathDraft, sx, sy);
            const { points: nextPts, index } = insertControlPointOnPath(
              pathDraft,
              hitC.seg,
              hitC.t,
            );
            pathDraft = nextPts;
            const idx = world.paths.findIndex((x) => x.id === `draft-${kind}`);
            const feat = createPathFeature(kind, pathDraft);
            feat.id = `draft-${kind}`;
            if (idx >= 0) world.paths[idx] = feat;
            else world.paths.push(feat);
            dragPathIdx = world.paths.findIndex((x) => x.id === `draft-${kind}`);
            dragPtIdx = index;
            canvas.setPointerCapture(e.pointerId);
            editor.touchWorld();
            requestRender();
            return;
          }

          // 4) 无草稿：若点到本层已有曲线附近 → 在该曲线上投影插入
          let bestPath = -1;
          let bestHit = { dist: Infinity, seg: 0, t: 0, polyLen: 0 };
          for (let pi = 0; pi < world.paths.length; pi++) {
            const p = world.paths[pi];
            if (p.layerId !== kind || p.id === `draft-${kind}`) continue;
            const pts = pathPointsOf(p);
            if (pts.length < 2) continue;
            const h = projectOntoPath(pts, sx, sy);
            if (h.dist < bestHit.dist) {
              bestHit = h;
              bestPath = pi;
            }
          }
          const curvePickPx = Math.max(14, brushRadiusDeg * cam.scale * 0.15);
          if (bestPath >= 0 && bestHit.dist < curvePickPx) {
            const path = world.paths[bestPath];
            const { points: nextPts, index } = insertControlPointOnPath(
              pathPointsOf(path),
              bestHit.seg,
              bestHit.t,
            );
            path.points = nextPts;
            dragPathIdx = bestPath;
            dragPtIdx = index;
            canvas.setPointerCapture(e.pointerId);
            editor.touchWorld();
            requestRender();
            return;
          }

          // 5) 空白：开始新草稿（第 1 个控制点）
          const ll = llAt(e);
          pathDraft = [ll];
          editor.touchWorld();
          requestRender();
          return;
        }
'''

t = t[:old_block_start] + new_block + t[old_block_end:]

# Fix render handles: draw ALL points for free layer when drawActive, including draft
old_rh = t.find("    // 路/航/河：控制点手柄与曲线同一 unwrap / 世界副本")
old_rh_end = t.find("  }\n\n  function buildBiomeFill")
if old_rh < 0:
    old_rh_end = t.find("  function buildBiomeFill")
print("rh", old_rh, old_rh_end)

new_rh = r'''    // 路/航/河：显示本层**全部**控制点 + 草稿点，均可拖
    if (isFreeLayer && drawActive) {
      const rect = canvas.getBoundingClientRect();
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const drawHandle = (sx: number, sy: number, dragging: boolean, major: boolean) => {
        ctx.beginPath();
        ctx.arc(sx, sy, dragging ? 7 : major ? 5.5 : 4.5, 0, Math.PI * 2);
        ctx.fillStyle = dragging ? '#f0c36a' : major ? 'rgba(255,255,255,0.95)' : 'rgba(240,195,106,0.95)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.55)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      };
      const paths = world.paths ?? [];
      for (let pi = 0; pi < paths.length; pi++) {
        const p = paths[pi];
        if (p.layerId !== focusLayer) continue;
        const pts = pathPointsOf(p);
        const xys = unwrapPathXY(pts);
        const isDraft = p.id === `draft-${focusLayer}`;
        for (let ci = 0; ci < xys.length; ci++) {
          const sp = bestScreenInFrame(xys[ci].x, xys[ci].y, rect);
          if (!sp) continue;
          const dragging = dragPathIdx === pi && dragPtIdx === ci;
          drawHandle(sp.sx, sp.sy, dragging, ci === 0 || ci === xys.length - 1);
        }
        if (isDraft && pts.length === 1) {
          const sp = bestScreenInFrame(xys[0].x, xys[0].y, rect);
          if (sp) drawHandle(sp.sx, sp.sy, false, true);
        }
      }
      ctx.restore();
    }
'''
if old_rh > 0 and old_rh_end > old_rh:
    t = t[:old_rh] + new_rh + t[old_rh_end:]

p.write_text(t)
print("ok", len(t))
