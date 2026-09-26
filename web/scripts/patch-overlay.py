from pathlib import Path

p = Path("/Users/zgy/mapedi/web/src/ui/Viewport.svelte")
t = p.read_text()

# 1) overlayDirty
t = t.replace(
    "  let dirty = false;\n  let raf = 0;",
    "  let dirty = false;\n  let overlayDirty = false;\n  let raf = 0;",
    1,
)

# 2) remove second requestRender if duplicated - find both
idx1 = t.find("  function requestRender() {")
idx2 = t.find("  function requestRender() {", idx1 + 1)
print("requestRender", idx1, idx2)
if idx2 > 0:
    # delete second occurrence through next function
    end2 = t.find("\n  function ", idx2 + 10)
    # find old requestRender end - next "  function" after idx2
    if end2 > idx2:
        t = t[:idx2] + t[end2+1:]

# 3) remove duplicate render() - keep first (new one that calls renderOverlay)
r1 = t.find("  function render() {")
r2 = t.find("  function render() {", r1 + 1)
print("render", r1, r2)
if r2 > 0:
    # second render is the old full one - remove until next top-level function after it
    # find end: "\n  function " after r2 that's not nested - or "  onMount"
    end = t.find("\n  onMount(", r2)
    if end < 0:
        end = t.find("\n  $effect(", r2)
    print("end", end)
    if end > r2:
        t = t[:r2] + t[end+1:]

# 4) pointermove path drag: requestOverlay only
t = t.replace(
    """          pts[dragPtIdx] = ll;
            p.points = pts;
          }
          // 拖动中只重绘，不 touchWorld（避免投影/边界全量失效 → 卡顿）
          requestRender();
        }""",
    """          pts[dragPtIdx] = ll;
            p.points = pts;
          }
          // 拖动中只刷覆盖层（控件/曲线），不重绘地图
          requestOverlay();
        }""",
)

# 5) paint pointermove: brush overlay only + throttled map
t = t.replace(
    """      if (painting) {
        paintAt(e);
        requestRender();
        return;
      }""",
    """      if (painting) {
        paintAt(e);
        requestOverlay();
        const now = performance.now();
        if (now - lastPaintRender > 90) {
          lastPaintRender = now;
          requestRender();
        }
        return;
      }""",
)

if "lastPaintRender" not in t.split("function render")[0]:
    t = t.replace(
        "  let overlayDirty = false;",
        "  let overlayDirty = false;\n  let lastPaintRender = 0;",
        1,
    )

p.write_text(t)
print("patched", len(t))
print("requestRender count", t.count("function requestRender"))
print("render count", t.count("function render()"))
