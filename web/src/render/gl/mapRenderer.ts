/**
 * GL 直绘渲染器（一期）——「相机即 uniform」逐帧直绘。
 *
 * 为什么旧 GPU 烘焙跑不赢 Canvas：旧链每帧把世界重烘进离屏贴图再 drawImage 回 2D，
 * 缩放每 tick 全量重烘 + 合成回读，GPU 只当了 Canvas 的贴图打印机；
 * 而 Canvas2D 本身已被浏览器 GPU 化（Skia/Metal），烘焙链结构上 ≤ Canvas。
 * 本渲染器改为：几何缓存（环对象 → VBO）+ 相机 uniform 逐帧直绘，
 * 缩放/平移只改 uniform，零重烘、零 drawImage、零读回。
 *
 * 通道（z 序 = displayPieces 顺序）：
 * 1. bg：整幅清海色（框外由 frame 层遮罩，与 Canvas 同观感）
 * 2. cellsMesh：cell 边条带（共享边去重——Canvas 单次 stroke 不双混，GL 重叠四边形会）
 * 3. elements：每片 stencil 奇偶填充（= Canvas evenodd，含副本重叠不叠色）→
 *    → 描边；片间严格按 displayPieces 顺序，后片填充盖前片描边（与 Canvas 同序）。
 *
 * 地图外框 = gl.scissor（与 clipToMapFrame 同矩形）；框外遮罩仍在 2D 层画。
 * 世界副本 = 顶点着色器 aDx 实例属性（一次 draw 覆盖所有副本）。
 *
 * 闭合语义只来自 hermite（geometry.ringGeo 的 willClose），此处不另立规则。
 */
import type { DisplayRing } from '../../core/ring/displayRing';
import {
  buildPieceParams,
  cssToRgba,
  getFrameRect,
  type PieceParams,
  type RenderEnv,
} from '../layers';
import { ringGeo, buildCellMeshStrips, type Pt , type CellMeshGeo } from './geometry';
import { triangulateRings, trianglesMatchRings } from './triangulate';
import { projectionWorldPeriod } from '../../core/project/projections';

interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 一片元素的合并几何（所有环 × 同一 smooth；副本由实例属性施加） */
interface PieceGeo {
  /** 填充三角形 [x,y]×3×n（直绘主路径；与 xorTris 同源采样） */
  tri: Float32Array | null;
  /** 剖分面积自检通过；false → stencil 兜底 */
  triOk: boolean;
  /** stencil 路径用：逐环奇偶三角组（earcut 精确面积，逐环缓存；含扇形回退） */
  xorTris: Float32Array | null;
  strip: Float32Array | null;
  bbox: BBox | null;
}

type BufRole = 'fan' | 'strip';

interface GpuBuf {
  vbo: WebGLBuffer;
  ibo: WebGLBuffer | null;
  vao: WebGLVertexArrayObject;
  count: number;
  last: number;
}

const VERT_FAN = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in float aDx;
uniform vec2 uCam;
uniform float uScale;
uniform vec2 uSize;
void main() {
  float x = (aPos.x + aDx - uCam.x) * uScale + uSize.x * 0.5;
  float y = (uCam.y - aPos.y) * uScale + uSize.y * 0.5;
  gl_Position = vec4(x * 2.0 / uSize.x - 1.0, 1.0 - y * 2.0 / uSize.y, 0.0, 1.0);
}`;

/** 单位矩形 + uRect 世界矩形（覆盖面/整框片，零缓冲上传） */
const VERT_QUAD = `#version 300 es
layout(location=0) in vec2 aUnit;
uniform vec2 uCam;
uniform float uScale;
uniform vec2 uSize;
uniform vec4 uRect;
void main() {
  vec2 p = uRect.xy + aUnit * uRect.zw;
  float x = (p.x - uCam.x) * uScale + uSize.x * 0.5;
  float y = (uCam.y - p.y) * uScale + uSize.y * 0.5;
  gl_Position = vec4(x * 2.0 / uSize.x - 1.0, 1.0 - y * 2.0 / uSize.y, 0.0, 1.0);
}`;

const VERT_STRIP = `#version 300 es
layout(location=0) in vec2 aBase;
layout(location=1) in vec2 aDir;
layout(location=2) in float aDx;
uniform vec2 uCam;
uniform float uScale;
uniform vec2 uSize;
uniform float uHalfW;
void main() {
  vec2 p = aBase + aDir * uHalfW;
  float x = (p.x + aDx - uCam.x) * uScale + uSize.x * 0.5;
  float y = (uCam.y - p.y) * uScale + uSize.y * 0.5;
  gl_Position = vec4(x * 2.0 / uSize.x - 1.0, 1.0 - y * 2.0 / uSize.y, 0.0, 1.0);
}`;

const FRAG_COLOR = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  outColor = uColor;
}`;

interface Program {
  prog: WebGLProgram;
  uCam: WebGLUniformLocation | null;
  uScale: WebGLUniformLocation | null;
  uSize: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uHalfW: WebGLUniformLocation | null;
  uRect: WebGLUniformLocation | null;
}

function compile(
  gl: WebGL2RenderingContext,
  vs: string,
  fs: string,
  label: string,
): WebGLProgram | null {
  const make = (type: number, src: string): WebGLShader | null => {
    const sh = gl.createShader(type);
    if (!sh) return null;
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      pushErr(`[${label}] shader: ${gl.getShaderInfoLog(sh) ?? ''}`);
      gl.deleteShader(sh);
      return null;
    }
    return sh;
  };
  const v = make(gl.VERTEX_SHADER, vs);
  const f = make(gl.FRAGMENT_SHADER, fs);
  if (!v || !f) return null;
  const p = gl.createProgram();
  if (!p) return null;
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    pushErr(`[${label}] link: ${gl.getProgramInfoLog(p) ?? ''}`);
    gl.deleteProgram(p);
    return null;
  }
  return p;
}

function pushErr(msg: string): void {
  const w = globalThis as unknown as { __gpuErr?: string[] };
  (w.__gpuErr ??= []).push(msg);
  console.error('[mapGl]', msg);
}

function toProgram(gl: WebGL2RenderingContext, prog: WebGLProgram): Program {
  return {
    prog,
    uCam: gl.getUniformLocation(prog, 'uCam'),
    uScale: gl.getUniformLocation(prog, 'uScale'),
    uSize: gl.getUniformLocation(prog, 'uSize'),
    uColor: gl.getUniformLocation(prog, 'uColor'),
    uHalfW: gl.getUniformLocation(prog, 'uHalfW'),
    uRect: gl.getUniformLocation(prog, 'uRect'),
  };
}

function unionBox(a: BBox | null, x1: number, x2: number, y1: number, y2: number): BBox {
  if (!a) return { minX: x1, maxX: x2, minY: y1, maxY: y2 };
  return {
    minX: Math.min(a.minX, x1),
    maxX: Math.max(a.maxX, x2),
    minY: Math.min(a.minY, y1),
    maxY: Math.max(a.maxY, y2),
  };
}

function mergeF(arrays: Float32Array[]): Float32Array | null {
  let n = 0;
  for (const a of arrays) n += a.length;
  if (!n) return null;
  const out = new Float32Array(n);
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

export class MapGlRenderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private progFan: Program;
  private progQuad: Program;
  private progStrip: Program;
  private dxsBuf: WebGLBuffer;
  private quadVbo: WebGLBuffer;
  private quadVao: WebGLVertexArrayObject;
  /** 数组 → GPU 缓冲（WeakMap 看生死；Set 供定额清扫 deleteBuffer） */
  private bufs = new WeakMap<Float32Array, GpuBuf>();
  private bufAll = new Set<GpuBuf>();
  private frame = 0;
  /** 环数组 → 合并几何（同一环集跨帧复用，副本变化不影响它） */
  private geoCache = new WeakMap<object, Map<string, PieceGeo>>();
  private meshCache = new WeakMap<object, { buf: GpuBuf | null; geo: CellMeshGeo }>();
  private failed = false;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const pFan = compile(gl, VERT_FAN, FRAG_COLOR, 'fan');
    const pQuad = compile(gl, VERT_QUAD, FRAG_COLOR, 'quad');
    const pStrip = compile(gl, VERT_STRIP, FRAG_COLOR, 'strip');
    if (!pFan || !pQuad || !pStrip) throw new Error('shader compile failed');
    this.progFan = toProgram(gl, pFan);
    this.progQuad = toProgram(gl, pQuad);
    this.progStrip = toProgram(gl, pStrip);

    this.dxsBuf = gl.createBuffer()!;
    this.quadVbo = gl.createBuffer()!;
    this.quadVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.quadVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    // premultipliedAlpha:true 的画布：rgb 由 SRC_ALPHA 乘一次，禁止二次乘 α（否则半透明变深）
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.failed = true;
      pushErr('webglcontextlost');
    });
  }

  static create(canvas: HTMLCanvasElement): MapGlRenderer | null {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      premultipliedAlpha: true,
      antialias: true,
      depth: false,
      stencil: true,
    });
    if (!gl) return null;
    try {
      return new MapGlRenderer(canvas, gl);
    } catch (e) {
      pushErr(`init: ${e}`);
      return null;
    }
  }

  get ok(): boolean {
    return !this.failed;
  }

  /** 预热：为件集构建环几何/三角化缓存（切层顺滑；缓存按环对象存续） */
  prime(pieces: PieceParams[]): void {
    for (const p of pieces) {
      if (p.fullFrame || !p.rings.length) continue;
      this.pieceGeo(p.rings, p.smooth);
    }
  }

  /** 逐帧直绘：bg + cellsMesh + elements。true = 已绘；false = 调用方回退 Canvas2D */
  render(env: RenderEnv, channels: { cellsMesh: boolean; elements: boolean }): boolean {
    if (this.failed) return false;
    const gl = this.gl;
    try {
      const t0 = performance.now();
      this.frame++;
      const devW = Math.max(1, Math.round(env.w * env.dpr));
      const devH = Math.max(1, Math.round(env.h * env.dpr));
      if (this.canvas.width !== devW || this.canvas.height !== devH) {
        this.canvas.width = devW;
        this.canvas.height = devH;
      }
      gl.viewport(0, 0, devW, devH);

      // bg：整幅清海色；框外由 frame 层遮罩
      const ocean = cssToRgba(env.style.ocean) ?? [0, 0, 0, 1];
      gl.disable(gl.SCISSOR_TEST);
      gl.disable(gl.STENCIL_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(ocean[0], ocean[1], ocean[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

      // 地图外框 scissor（与 clipToMapFrame 同矩形：外框固定在投影空间，不随 drawDx）
      const fr = getFrameRect(env);
      const s = this.frameRectDevice(env, fr, devH);
      gl.enable(gl.SCISSOR_TEST);
      gl.scissor(s.x, s.y, s.w, s.h);

      this.setCam(env, this.progFan);
      this.setCam(env, this.progQuad);
      this.setCam(env, this.progStrip);

      const tParams = performance.now();
      const pieces = channels.elements ? buildPieceParams(env) : [];
      const tSubmit = performance.now();
      if (channels.cellsMesh && env.showCellMesh) this.drawCellMesh(env);
      for (const piece of pieces) this.drawPiece(env, piece, s);
      const tEnd = performance.now();
      const gp = globalThis as unknown as {
        __glParamsMs?: number;
        __glSubmitMs?: number;
        __glSeg?: { params: number; submit: number }[];
      };
      gp.__glParamsMs = tSubmit - tParams;
      gp.__glSubmitMs = tEnd - tSubmit;
      (gp.__glSeg ??= []).push({ params: tSubmit - tParams, submit: tEnd - tSubmit });
      if (gp.__glSeg.length > 240) gp.__glSeg.shift();
      gl.disable(gl.SCISSOR_TEST);
      gl.flush();
      const w = globalThis as unknown as { __gpuMs?: number; __gpuRan?: number };
      w.__gpuMs = performance.now() - t0;
      w.__gpuRan = (w.__gpuRan ?? 0) + 1;
      return true;
    } catch (e) {
      pushErr(`render: ${e}`);
      this.failed = true;
      return false;
    }
  }

  private setCam(env: RenderEnv, pr: Program): void {
    const gl = this.gl;
    gl.useProgram(pr.prog);
    if (pr.uCam) gl.uniform2f(pr.uCam, env.cam.x, env.cam.y);
    if (pr.uScale) gl.uniform1f(pr.uScale, env.cam.scale);
    if (pr.uSize) gl.uniform2f(pr.uSize, env.w, env.h);
  }

  /** 外框 → 设备像素 scissor 矩形（GL 原点在左下） */
  private frameRectDevice(
    env: RenderEnv,
    fr: { minX: number; maxX: number; minY: number; maxY: number },
    devH: number,
  ): { x: number; y: number; w: number; h: number } {
    const sc = env.cam.scale;
    const x0 = (fr.minX - env.cam.x) * sc + env.w / 2;
    const x1 = (fr.maxX - env.cam.x) * sc + env.w / 2;
    const yTop = (env.cam.y - fr.maxY) * sc + env.h / 2;
    const yBot = (env.cam.y - fr.minY) * sc + env.h / 2;
    const dpr = env.dpr;
    const sx = Math.floor(x0 * dpr);
    const sy = Math.floor(devH - yBot * dpr);
    const sw = Math.ceil(x1 * dpr) - sx;
    const sh = Math.ceil(yBot * dpr) - Math.floor(yTop * dpr);
    return { x: sx, y: sy, w: Math.max(1, sw), h: Math.max(1, sh) };
  }

  /** 世界 bbox → 设备像素 scissor（并与外框相交） */
  private pieceScissor(
    env: RenderEnv,
    b: BBox,
    frame: { x: number; y: number; w: number; h: number },
    devH: number,
  ): { x: number; y: number; w: number; h: number } {
    const sc = env.cam.scale * env.dpr;
    const x0 = Math.floor((b.minX - env.cam.x) * sc + (env.w * env.dpr) / 2);
    const x1 = Math.ceil((b.maxX - env.cam.x) * sc + (env.w * env.dpr) / 2);
    const yTop = Math.floor((env.cam.y - b.maxY) * sc + (env.h * env.dpr) / 2);
    const yBot = Math.ceil((env.cam.y - b.minY) * sc + (env.h * env.dpr) / 2);
    const gx0 = Math.max(frame.x, x0);
    const gy0 = Math.max(frame.y, devH - yBot);
    const gx1 = Math.min(frame.x + frame.w, x1);
    const gy1 = Math.min(frame.y + frame.h, devH - yTop);
    return { x: gx0, y: gy0, w: Math.max(1, gx1 - gx0), h: Math.max(1, gy1 - gy0) };
  }

  private setDxs(dxs: number[]): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dxsBuf);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(dxs), gl.DYNAMIC_DRAW);
  }

  /** 数组 → VAO（按角色布局） */
  private bufFor(arr: Float32Array, role: BufRole): GpuBuf {
    const gl = this.gl;
    const hit = this.bufs.get(arr);
    if (hit) {
      hit.last = this.frame;
      return hit;
    }
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, arr, gl.STATIC_DRAW);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    const stride = role === 'fan' ? 8 : 16;
    if (role === 'fan') {
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dxsBuf);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 4, 0);
      gl.vertexAttribDivisor(1, 1);
    } else if (role === 'strip') {
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dxsBuf);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 4, 0);
      gl.vertexAttribDivisor(2, 1);
    }
    const count = arr.length / (stride / 4);
    gl.bindVertexArray(null);
    const rec: GpuBuf = { vbo, ibo: null, vao, count, last: this.frame };
    this.bufs.set(arr, rec);
    this.bufAll.add(rec);
    this.sweep();
    return rec;
  }

  /** 定额清扫：600 帧未用的缓冲 deleteBuffer（几何换代后不泄漏显存） */
  private sweep(): void {
    if (this.bufAll.size < 1024) return;
    for (const rec of this.bufAll) {
      if (this.frame - rec.last <= 600) continue;
      const gl = this.gl;
      gl.deleteBuffer(rec.vbo);
      if (rec.ibo) gl.deleteBuffer(rec.ibo);
      gl.deleteVertexArray(rec.vao);
      this.bufAll.delete(rec);
    }
  }

  /** 同一环集的合并几何（fan/strip + 环并集 bbox） */
  private pieceGeo(rings: DisplayRing[], smooth: number): PieceGeo | null {
    const key = smooth.toFixed(2);
    let byKey = this.geoCache.get(rings as unknown as object);
    if (!byKey) {
      byKey = new Map();
      this.geoCache.set(rings as unknown as object, byKey);
    }
    const hit = byKey.get(key);
    if (hit) return hit;
    const xors: Float32Array[] = [];
    const strips: Float32Array[] = [];
    const fillEntries: { ring: DisplayRing; pts: Pt[] }[] = [];
    let bbox: BBox | null = null;
    for (const ring of rings) {
      if (ring.pts.length < 2) continue;
      // 只有闭合环参与填充；开环只描边
      const fill = ring.closed ? ringGeo(ring, smooth, 'fill') : null;
      const outline = ringGeo(ring, smooth, 'outline');
      const g = fill ?? outline;
      if (g) bbox = unionBox(bbox, g.bbox.minX, g.bbox.maxX, g.bbox.minY, g.bbox.maxY);
      if (fill?.fillPts && fill.fillPts.length >= 3) fillEntries.push({ ring, pts: fill.fillPts });
      if (fill?.xorTris) xors.push(fill.xorTris);
      if (outline?.strip) strips.push(outline.strip);
    }
    // 大件（总采样点 > 2000，如大洋=框减百洞）不做整块 earcut：单洞变化会触发
    // 整块重三角化（实测帧尖峰 0.3-1.4s）。tri=null → drawPiece 走 stencil 路径，
    // stencil 用**逐环三角组**（xorTris：earcut 精确面积光栅，按环对象缓存，
    // 补丁只重做变动环；自检失败的环回退扇形）。
    let ptsTotal = 0;
    for (const fe of fillEntries) ptsTotal += fe.pts.length;
    let tri = ptsTotal > 2000 ? null : triangulateRings(fillEntries);
    // 回验：三角形必须落在环集奇偶内（自交环 earcut 会出错乱三角形）
    if (tri?.tris && !trianglesMatchRings(tri.tris, fillEntries.map((f) => f.pts))) tri = null;
    const geo: PieceGeo = {
      tri: tri?.tris ?? null,
      triOk: !!tri?.areaOk,
      xorTris: mergeF(xors),
      strip: mergeF(strips),
      bbox,
    };
    byKey.set(key, geo);
    return geo;
  }

  /** 一件元素：fill → stroke，后件盖前件。 */
  private drawPiece(
    env: RenderEnv,
    piece: PieceParams,
    frame: { x: number; y: number; w: number; h: number },
  ): void {
    const gl = this.gl;
    const devW = Math.round(env.w * env.dpr);
    const devH = Math.round(env.h * env.dpr);
    if (piece.fullFrame) {
      const f = piece.fullFrame;
      const c = cssToRgba(f.color);
      if (!c) return;
      this.drawQuad(f.minX, f.minY, f.maxX - f.minX, f.maxY - f.minY, c[0], c[1], c[2], f.alpha * c[3]);
      return;
    }
    const geo = this.pieceGeo(piece.rings, piece.smooth);
    const gbox = geo?.bbox;
    if (!geo || !gbox) return;
    const strokeOn = piece.strokeW > 0 && piece.stroke !== 'transparent';
    const strokeC = strokeOn ? cssToRgba(piece.stroke) : null;
    const fillC = piece.fillOn ? cssToRgba(typeof piece.fillColor === 'string' ? piece.fillColor : '') : null;
    if (!piece.fillOn && !strokeOn) return;
    if ((piece.fillOn && !fillC) || (strokeOn && !strokeC)) {
      this.failed = true;
      pushErr(`piece ${piece.key}: 非纯色样式`);
      return;
    }

    const scale = env.cam.scale;
    const viewL = env.cam.x - env.w / 2 / scale;
    const viewR = env.cam.x + env.w / 2 / scale;
    const all = piece.copies.length ? piece.copies : [0];
    const copies = all.filter((dx) => gbox.maxX + dx > viewL - 1e-9 && gbox.minX + dx < viewR + 1e-9);
    if (!copies.length) return;
    let minDx = Infinity;
    let maxDx = -Infinity;
    for (const dx of copies) {
      if (dx < minDx) minDx = dx;
      if (dx > maxDx) maxDx = dx;
    }
    const period = projectionWorldPeriod(env.proj);
    const overlap = period !== null && gbox.maxX - gbox.minX >= period;
    const fast = !!geo.tri && geo.triOk;

    if (fast) {
      const triBuf = this.bufFor(geo.tri!, 'fan');
      const af = piece.fillOn && fillC ? Math.max(0, Math.min(1, piece.fillAlpha)) * fillC[3] : 0;
      this.setDxs(copies);
      if (overlap) {
        const margin = piece.strokeW + 1 / env.cam.scale;
        const bbx: BBox = {
          minX: gbox.minX + minDx - margin,
          maxX: gbox.maxX + maxDx + margin,
          minY: gbox.minY - margin,
          maxY: gbox.maxY + margin,
        };
        const scx = this.pieceScissor(env, bbx, frame, devH);
        gl.enable(gl.STENCIL_TEST);
        gl.scissor(scx.x, scx.y, scx.w, scx.h);
        gl.stencilMask(0xff);
        gl.clearStencil(0);
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 0, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        gl.useProgram(this.progFan.prog); // 必须设程序：否则沿用上一件的着色器，奇偶画的是垃圾几何
        gl.bindVertexArray(triBuf.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, triBuf.count, copies.length);
        gl.colorMask(true, true, true, true);
        gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      }
      gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.scissor(frame.x, frame.y, frame.w, frame.h);
      if (piece.fillOn && fillC) {
        gl.useProgram(this.progFan.prog);
        if (this.progFan.uColor) gl.uniform4f(this.progFan.uColor, fillC[0], fillC[1], fillC[2], af);
        gl.bindVertexArray(triBuf.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, triBuf.count, copies.length);
        gl.bindVertexArray(null);
      }
      if (overlap) gl.disable(gl.STENCIL_TEST);
    } else {
      this.drawPieceStencil(env, piece, geo, frame, copies, minDx, maxDx, {
        devW,
        devH,
        fillC,
        strokeC,
        strokeOn,
      });
    }

    if (strokeOn && strokeC && geo.strip) {
      gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      const buf = this.bufFor(geo.strip, 'strip');
      gl.useProgram(this.progStrip.prog);
      if (this.progStrip.uHalfW) gl.uniform1f(this.progStrip.uHalfW, piece.strokeW / 2);
      if (this.progStrip.uColor) {
        gl.uniform4f(this.progStrip.uColor, strokeC[0], strokeC[1], strokeC[2], strokeC[3]);
      }
      gl.bindVertexArray(buf.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, buf.count, copies.length);
      gl.bindVertexArray(null);
    }
    gl.scissor(frame.x, frame.y, frame.w, frame.h);
  }

  /** 大件语义路径：stencil INVERT 逐环三角组 + 覆盖面（奇偶与 Canvas evenodd 同语义） */
  private drawPieceStencil(
    env: RenderEnv,
    piece: PieceParams,
    geo: PieceGeo,
    frame: { x: number; y: number; w: number; h: number },
    copies: number[],
    minDx: number,
    maxDx: number,
    s: {
      devW: number;
      devH: number;
      fillC: [number, number, number, number] | null;
      strokeC: [number, number, number, number] | null;
      strokeOn: boolean;
    },
  ): void {
    void s.strokeC;
    void s.strokeOn;
    const gbox = geo.bbox;
    if (!gbox) return;
    const gl = this.gl;
    const margin = piece.strokeW + 1 / env.cam.scale;
    const bb: BBox = {
      minX: gbox.minX + minDx - margin,
      maxX: gbox.maxX + maxDx + margin,
      minY: gbox.minY - margin,
      maxY: gbox.maxY + margin,
    };
    const sc = this.pieceScissor(env, bb, frame, s.devH);
    gl.enable(gl.STENCIL_TEST);
    gl.scissor(sc.x, sc.y, sc.w, sc.h);
    gl.stencilMask(0xff);
    gl.clearStencil(0);
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.colorMask(false, false, false, false);
    gl.stencilFunc(gl.ALWAYS, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
    this.setDxs(copies);
    if (geo.xorTris) {
      const buf = this.bufFor(geo.xorTris, 'fan');
      gl.useProgram(this.progFan.prog);
      gl.bindVertexArray(buf.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, buf.count, copies.length);
      gl.bindVertexArray(null);
    }
    gl.colorMask(true, true, true, true);
    gl.stencilFunc(gl.NOTEQUAL, 0, 0xff);
    gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    if (piece.fillOn && s.fillC) {
      this.drawQuad(
        gbox.minX + minDx,
        gbox.minY,
        gbox.maxX - gbox.minX + (maxDx - minDx),
        gbox.maxY - gbox.minY,
        s.fillC[0],
        s.fillC[1],
        s.fillC[2],
        Math.max(0, Math.min(1, piece.fillAlpha)) * s.fillC[3],
      );
    }
    gl.disable(gl.STENCIL_TEST);
    gl.scissor(frame.x, frame.y, frame.w, frame.h);
  }

  private drawQuad(
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
    g: number,
    b: number,
    a: number,
  ): void {
    const gl = this.gl;
    gl.useProgram(this.progQuad.prog);
    if (this.progQuad.uRect) gl.uniform4f(this.progQuad.uRect, x, y, w, h);
    if (this.progQuad.uColor) gl.uniform4f(this.progQuad.uColor, r, g, b, a);
    gl.bindVertexArray(this.quadVao);
    gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
    gl.bindVertexArray(null);
  }

  private drawCellMesh(env: RenderEnv): void {
    const gl = this.gl;
    const stroke = env.style.cellStroke;
    const color = cssToRgba(stroke.color);
    if (!color) return;
    // 每 pcache 构建一次网格条带（共享边去重 + 桶化）；相机变化只改 uniform
    let entry = this.meshCache.get(env.pcache as unknown as object);
    if (!entry) {
      const period = projectionWorldPeriod(env.proj) ?? Math.PI * 2;
      const geo = buildCellMeshStrips(env.pcache.polys, env.pcache.polarOutlines, period);
      entry = { geo, buf: geo.data.length ? this.bufFor(geo.data, 'strip') : null };
      this.meshCache.set(env.pcache as unknown as object, entry);
    }
    if (!entry.buf) return;
    const scale = env.cam.scale;
    const viewL = env.cam.x - env.w / 2 / scale;
    const viewR = env.cam.x + env.w / 2 / scale;
    const viewT = env.cam.y + env.h / 2 / scale;
    const viewB = env.cam.y - env.h / 2 / scale;
    const all = env.worldDxs?.length ? env.worldDxs : [env.contentOffsetX ?? 0];
    const bb = env.pcache.worldBBox;
    const copies = all.filter((dx) => bb.maxX + dx > viewL && bb.minX + dx < viewR);
    if (!copies.length) return;
    this.setDxs(copies);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.progStrip.prog);
    if (this.progStrip.uHalfW) {
      gl.uniform1f(this.progStrip.uHalfW, Math.max(stroke.width, 0.35) / env.cam.scale / 2);
    }
    if (this.progStrip.uColor) {
      gl.uniform4f(this.progStrip.uColor, color[0], color[1], color[2], color[3]);
    }
    gl.bindVertexArray(entry.buf.vao);
    // 视口行段裁剪：桶行主序 → 每可见行一个连续顶点段；副本平移只影响 x，取并集（只多画不少画）
    const g = entry.geo;
    const pad = Math.max(stroke.width, 0.35) / scale / 2 + g.cell;
    let uL = Infinity;
    let uR = -Infinity;
    for (const dx of copies) {
      const l = viewL - dx;
      const r = viewR - dx;
      if (l < uL) uL = l;
      if (r > uR) uR = r;
    }
    const ci = (x: number) => Math.max(0, Math.min(g.cols - 1, Math.floor((x - g.minX) / g.cell)));
    const cj = (y: number) => Math.max(0, Math.min(g.rows - 1, Math.floor((y - g.minY) / g.cell)));
    const i0 = ci(uL - pad);
    const i1 = ci(uR + pad);
    const j0 = cj(viewB - pad);
    const j1 = cj(viewT + pad);
    for (let j = j0; j <= j1; j++) {
      const a = (j * g.cols + i0) * 2;
      const b = (j * g.cols + i1) * 2;
      const first = g.ranges[a] >> 2; // 顶点单位（每顶点 4 float）
      const end = (g.ranges[b] + g.ranges[b + 1]) >> 2;
      const count = end - first;
      if (count > 0) gl.drawArraysInstanced(gl.TRIANGLES, first, count, copies.length);
    }
    // 长线段（极区框边等）不入桶：任何视口都画
    if (g.wide[1] > 0) {
      gl.drawArraysInstanced(gl.TRIANGLES, g.wide[0] >> 2, g.wide[1] >> 2, copies.length);
    }
    gl.bindVertexArray(null);
  }
}
