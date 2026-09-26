/**
 * GPU 批量多边形填充渲染器。
 *
 * 替代 Canvas2D 逐 cell `ctx.fill`：把一批多边形（世界坐标，来自
 * `projCache.getProjCache().polys`）三角化后用**一次 draw call** 画到 canvas，
 * 复刻 `MapTransform.worldToScreen` 的坐标变换（含 y 翻转 + drawDx）与
 * 垂直线性渐变（用顶点色线性插值近似 CanvasGradient）。
 *
 * 职责单一：只负责「已知多边形 + 每顶点颜色 → 批量填充」，不碰投影、
 * 拾取、交互、描边、雾效。描边沿用 Canvas2D 已有的 Path2D 批处理。
 * 仅接受凸多边形（Voronoi cell 即凸），扇形三角化；非凸/退化会被跳过。
 */

export interface GpuFillView {
  cam: { x: number; y: number; scale: number };
  /** 目标画布设备像素宽高 */
  w: number;
  h: number;
  drawDx?: number;
  /** devicePixelRatio；uScale 实际生效值为 cam.scale * dpr */
  dpr?: number;
}

/** 按世界 y 给出顶点颜色 [r,g,b,a]，各分量 0..1。用于复刻垂直渐变。 */
export type FillColorFn = (worldY: number) => [number, number, number, number];

const VERT_SRC = `
attribute vec2 aPos;
attribute vec4 aColor;
uniform vec2 uCam;
uniform float uScale;
uniform vec2 uRes;
uniform float uDrawDx;
varying vec4 vColor;
void main() {
  float sx = (aPos.x + uDrawDx - uCam.x) * uScale + uRes.x * 0.5;
  float sy = -(aPos.y - uCam.y) * uScale + uRes.y * 0.5;
  gl_Position = vec4(sx / uRes.x * 2.0 - 1.0, 1.0 - sy / uRes.y * 2.0, 0.0, 1.0);
  vColor = aColor;
}`;

const FRAG_SRC = `
precision mediump float;
varying vec4 vColor;
void main() { gl_FragColor = vColor; }`;

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('gpuFill: createShader failed');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh) ?? '';
    gl.deleteShader(sh);
    throw new Error('gpuFill: shader compile failed: ' + log);
  }
  return sh;
}


// ---- 带洞多边形三角化:ear clipping(支持凹) + 桥接 holes ----
function _signedArea(pts: number[]): number {
  let a = 0; const n = pts.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++)
    a += pts[j * 2] * pts[i * 2 + 1] - pts[i * 2] * pts[j * 2 + 1];
  return a / 2;
}
function _inTri(px: number, py: number, ax: number, ay: number, bx: number, by: number, cx: number, cy: number): boolean {
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by);
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy);
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}
/** 简单多边形(可凹,单环)→三角形索引 [i0,i1,i2,...]。输入扁平 [x,y,...]。 */
function earClipIndices(pts: number[]): number[] {
  const n = pts.length >> 1;
  const out: number[] = [];
  if (n < 3) return out;
  const idx: number[] = [];
  for (let i = 0; i < n; i++) idx.push(i);
  if (_signedArea(pts) < 0) idx.reverse(); // 统一逆时针
  let guard = 0; const maxGuard = n * n + 16;
  while (idx.length > 3 && guard++ < maxGuard) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const i0 = idx[(i + idx.length - 1) % idx.length];
      const i1 = idx[i];
      const i2 = idx[(i + 1) % idx.length];
      const ax = pts[i0 * 2], ay = pts[i0 * 2 + 1];
      const bx = pts[i1 * 2], by = pts[i1 * 2 + 1];
      const cx = pts[i2 * 2], cy = pts[i2 * 2 + 1];
      const cross = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (cross <= 0) continue;
      let has = false;
      for (const j of idx) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (_inTri(pts[j * 2], pts[j * 2 + 1], ax, ay, bx, by, cx, cy)) { has = true; break; }
      }
      if (has) continue;
      out.push(i0, i1, i2);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break;
  }
  if (idx.length === 3) out.push(idx[0], idx[1], idx[2]);
  return out;
}


/** 把洞桥接到外环，退化成单个简单多边形（可直接 ear clipping）。
 *  桥接语义: ring[0..best] + 洞绕一圈(h[hi]..h[hi]) + ring[best](回桥) + ring[best+1..]。
 *  简化实现: 洞按最左点就近桥到外环右侧顶点。常见「洞完全在外环内」情况正确；
 *  洞与外环接近/相交等复杂边界可能产生自交——未验证。 */
function bridgeHoles(outer: number[], holes: number[][]): number[] {
  let ring = _signedArea(outer) < 0 ? outer.slice().reverse() : outer.slice();
  const minX = (r: number[]): number => { let m = Infinity; for (let i = 0; i < r.length; i += 2) if (r[i] < m) m = r[i]; return m; };
  const sorted = holes.slice().sort((a, b) => minX(a) - minX(b));
  for (const hole0 of sorted) {
    const h = _signedArea(hole0) > 0 ? hole0.slice().reverse() : hole0.slice();
    const hn = h.length >> 1;
    let hi = 0;
    for (let i = 1; i < hn; i++) if (h[i * 2] < h[hi * 2]) hi = i;
    const hx = h[hi * 2], hy = h[hi * 2 + 1];
    const rn = ring.length >> 1;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < rn; i++) {
      const rx = ring[i * 2], ry = ring[i * 2 + 1];
      if (rx < hx) continue;
      const d = (rx - hx) * (rx - hx) + (ry - hy) * (ry - hy);
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) continue;
    const out: number[] = [];
    for (let i = 0; i <= best; i++) out.push(ring[i * 2], ring[i * 2 + 1]);
    for (let k = 0; k <= hn; k++) { const j = (hi + k) % hn; out.push(h[j * 2], h[j * 2 + 1]); }
    out.push(ring[best * 2], ring[best * 2 + 1]);
    for (let i = best + 1; i < rn; i++) out.push(ring[i * 2], ring[i * 2 + 1]);
    ring = out;
  }
  return ring;
}

/** 三角化结果缓存：同一 ring 的 pts 数组在 preparePieces 后引用稳定，不必每帧 ear clipping。 */
const triCache = new WeakMap<object, number[]>();

function cachedEarClip(ptsObj: object, pts: number[]): number[] {
  const hit = triCache.get(ptsObj);
  if (hit) return hit;
  const tri = earClipIndices(pts);
  triCache.set(ptsObj, tri);
  return tri;
}

export class GpuFillRenderer {
  private gl: WebGLRenderingContext;
  private prog: WebGLProgram;
  private buf: WebGLBuffer;
  private aPos: number;
  private aColor: number;
  private uCam: WebGLUniformLocation;
  private uScale: WebGLUniformLocation;
  private uRes: WebGLUniformLocation;
  private uDrawDx: WebGLUniformLocation;
  private verts: number[] = [];
  canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: true,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('gpuFill: WebGL not available');
    this.gl = gl;
    this.canvas = canvas;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const prog = gl.createProgram();
    if (!prog) throw new Error('gpuFill: createProgram failed');
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog) ?? '';
      gl.deleteProgram(prog);
      throw new Error('gpuFill: program link failed: ' + log);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.prog = prog;

    const buf = gl.createBuffer();
    if (!buf) throw new Error('gpuFill: createBuffer failed');
    this.buf = buf;

    this.aPos = gl.getAttribLocation(prog, 'aPos');
    this.aColor = gl.getAttribLocation(prog, 'aColor');
    const uCam = gl.getUniformLocation(prog, 'uCam');
    const uScale = gl.getUniformLocation(prog, 'uScale');
    const uRes = gl.getUniformLocation(prog, 'uRes');
    const uDrawDx = gl.getUniformLocation(prog, 'uDrawDx');
    if (!uCam || !uScale || !uRes || !uDrawDx) throw new Error('gpuFill: uniform location missing');
    this.uCam = uCam;
    this.uScale = uScale;
    this.uRes = uRes;
    this.uDrawDx = uDrawDx;

    gl.useProgram(prog);
    gl.disable(gl.CULL_FACE); // 多边形绕向不定，双面填充
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** 清空已累积的多边形（下一帧重新累积）。 */
  clear(): void {
    this.verts = [];
  }

  /**
   * 累积一个简单多边形（世界坐标 [x0,y0,x1,y1,...]）。
   * `cacheKey` 稳定时复用三角化结果，避免每帧 O(n²) ear clipping。
   */
  addPolygon(poly: Float64Array, colorFn: FillColorFn, cacheKey?: object): void {
    const n = poly.length >> 1;
    if (n < 3) return;
    const flat = Array.from(poly);
    const tri = cacheKey ? cachedEarClip(cacheKey, flat) : earClipIndices(flat);
    for (let t = 0; t < tri.length; t += 3) {
      for (let k = 0; k < 3; k++) {
        const i = tri[t + k];
        const c = colorFn(poly[i * 2 + 1]);
        this.verts.push(poly[i * 2], poly[i * 2 + 1], c[0], c[1], c[2], c[3]);
      }
    }
  }

  /** 带洞多边形（evenodd 语义）：桥接 holes 后 ear clipping。`cacheKey` 稳定时缓存三角化。 */
  addPolygonWithHoles(outer: Float64Array, holes: Float64Array[], colorFn: FillColorFn, cacheKey?: object): void {
    const merged = bridgeHoles(Array.from(outer), holes.map((h) => Array.from(h)));
    if (merged.length >= 6) this.addPolygon(Float64Array.from(merged), colorFn, cacheKey);
  }

  render(view: GpuFillView): void {
    const gl = this.gl;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const count = this.verts.length / 6;
    if (count === 0) return;

    gl.useProgram(this.prog);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.verts), gl.DYNAMIC_DRAW);

    const stride = 24;
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.aColor);
    gl.vertexAttribPointer(this.aColor, 4, gl.FLOAT, false, stride, 8);

    const dpr = view.dpr ?? 1;
    gl.uniform2f(this.uCam, view.cam.x, view.cam.y);
    // uScale 必须是设备像素/世界单位：与 beginWorld 的 (scale,dpr) 复合一致
    gl.uniform1f(this.uScale, view.cam.scale * dpr);
    gl.uniform2f(this.uRes, view.w, view.h);
    gl.uniform1f(this.uDrawDx, view.drawDx ?? 0);

    gl.drawArrays(gl.TRIANGLES, 0, count);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.buf);
    gl.deleteProgram(this.prog);
  }
}
