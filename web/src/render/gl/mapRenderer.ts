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
 *    解析内阴影（Φ 剖面渐隐条带 = Canvas「clip(fill) + blur(2w 描边)」沿直线段数学等价）
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
import { ringGeo, buildCellMeshStrips, type Pt } from './geometry';
import { triangulateRings } from './triangulate';
import { projectionWorldPeriod } from '../../core/project/projections';

interface BBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** 一片元素的合并几何（所有环 × 同一 smooth；副本由实例属性施加） */
interface PieceGeo {
  /** 填充三角形 [x,y]×3×n（直绘主路径；与 fan 同源采样） */
  tri: Float32Array | null;
  /** 剖分面积自检通过；false → stencil 兜底 */
  triOk: boolean;
  /** stencil 兜底路径用（外部参考点扇形） */
  fan: Float32Array | null;
  strip: Float32Array | null;
  fadeV: Float32Array | null;
  fadeI: Uint32Array | null;
  bbox: BBox | null;
}

type BufRole = 'fan' | 'strip' | 'fade';

/** 阴影场图集 tile：图集坐标 + 屏幕原点（设备像素，GL 左下原点） */
interface FieldTile {
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
}

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

const VERT_FADE = `#version 300 es
layout(location=0) in vec2 aPos;
layout(location=1) in vec2 aNorm;
layout(location=2) in float aU;
layout(location=3) in float aDx;
uniform vec2 uCam;
uniform float uScale;
uniform vec2 uSize;
uniform float uHalfW;
out float vU;
void main() {
  vec2 p = aPos + aNorm * (aU * uHalfW);
  vU = aU;
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

/**
 * 内阴影剖面：α(u) = Φ(2−2|u|) − Φ(−2−2|u|)。
 * 半宽 w、σ=w/2 矩形描边的高斯剖面（u = 距边界距离 / w），
 * 与 Canvas「clip(fill) + blur(2w 描边)」沿直线段数学等价；外侧半条由填充 stencil 裁掉。
 */
const FRAG_FADE = `#version 300 es
precision highp float;
in float vU;
uniform vec4 uColor;
out vec4 outColor;
float erfApx(float x) {
  float s = sign(x);
  x = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * x);
  float y = 1.0 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * exp(-x * x);
  return s * y;
}
float Phi(float z) {
  return 0.5 * (1.0 + erfApx(z * 0.7071067811865476));
}
void main() {
  float u = abs(vU);
  float a = Phi(2.0 - 2.0 * u) - Phi(-2.0 - 2.0 * u);
  // 场值（纯剖面）写入并集缓冲：各环以 MAX 归并 = Canvas「描边并集再模糊」，禁止叠加求和
  outColor = vec4(a, a, a, a);
}`;

/** 填充 + 内阴影一次合成（X/A 代数 = Canvas「fill→shadow over」精确等价，af<1 也成立） */
const FRAG_FILL_FIELD = `#version 300 es
precision highp float;
uniform vec4 uColor;
uniform vec4 uShadow;
uniform sampler2D uField;
uniform vec4 uTile;
out vec4 outColor;
void main() {
  // uTile = (图集原点 − 屏幕原点, 图集尺寸)：屏幕像素 → 图集 UV（tile 按屏幕包围盒 1:1 烘）
  vec2 uv = (gl_FragCoord.xy + uTile.xy) / uTile.zw;
  float s = texture(uField, uv).r * uShadow.a;
  float af = uColor.a;
  float A = 1.0 - (1.0 - af) * (1.0 - s);
  if (A <= 0.0005) discard;
  vec3 X = (uColor.rgb * af * (1.0 - s) + uShadow.rgb * s) / A;
  outColor = vec4(X, A);
}`;

/** 渐隐场 → 阴影合成（RT 的 r = 场强，一次 over 合成到填充上） */
const FRAG_FADE_COMPOSITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uField;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  float a = texture(uField, vUv).r * uColor.a;
  outColor = vec4(uColor.rgb, a);
}`;

/** 屏幕矩形 → 位置；图集矩形 → 场 UV（两者 1:1 对应，tile 按屏幕包围盒 1:1 烘） */
const VERT_SCREEN = `#version 300 es
layout(location=0) in vec2 aUnit;
uniform vec4 uRect;
uniform vec4 uUvRect;
uniform vec2 uSizeDev;
uniform vec2 uAtlas;
out vec2 vUv;
void main() {
  vec2 p = uRect.xy + aUnit * uRect.zw;
  vUv = (uUvRect.xy + aUnit * uUvRect.zw) / uAtlas;
  gl_Position = vec4(p / uSizeDev * 2.0 - 1.0, 0.0, 1.0);
}`;

interface Program {
  prog: WebGLProgram;
  uCam: WebGLUniformLocation | null;
  uScale: WebGLUniformLocation | null;
  uSize: WebGLUniformLocation | null;
  uColor: WebGLUniformLocation | null;
  uHalfW: WebGLUniformLocation | null;
  uRect: WebGLUniformLocation | null;
  uSizeDev: WebGLUniformLocation | null;
  uField: WebGLUniformLocation | null;
  uShadow: WebGLUniformLocation | null;
  uTile: WebGLUniformLocation | null;
  uUvRect: WebGLUniformLocation | null;
  uAtlas: WebGLUniformLocation | null;
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
    uSizeDev: gl.getUniformLocation(prog, 'uSizeDev'),
    uField: gl.getUniformLocation(prog, 'uField'),
    uShadow: gl.getUniformLocation(prog, 'uShadow'),
    uTile: gl.getUniformLocation(prog, 'uTile'),
    uUvRect: gl.getUniformLocation(prog, 'uUvRect'),
    uAtlas: gl.getUniformLocation(prog, 'uAtlas'),
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

/** 合并 fade 顶点 + 索引（按顶点数偏移） */
function mergeFade(
  verts: Float32Array[],
  idxs: Uint32Array[],
): { v: Float32Array; i: Uint32Array } | null {
  const v = mergeF(verts);
  if (!v) return null;
  let n = 0;
  for (const a of idxs) n += a.length;
  const i = new Uint32Array(n);
  let io = 0;
  let base = 0;
  for (let k = 0; k < idxs.length; k++) {
    const a = idxs[k];
    for (let j = 0; j < a.length; j++) i[io++] = a[j] + base;
    base += verts[k].length / 5;
  }
  return { v, i };
}

export class MapGlRenderer {
  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private progFan: Program;
  private progQuad: Program;
  private progStrip: Program;
  private progFade: Program;
  private progComposite: Program;
  private progFillField: Program;
  private fadeTex: WebGLTexture | null = null;
  private fadeFbo: WebGLFramebuffer | null = null;
  private fadeW = 0;
  private fadeH = 0;
  private dxsBuf: WebGLBuffer;
  private quadVbo: WebGLBuffer;
  private quadVao: WebGLVertexArrayObject;
  /** 数组 → GPU 缓冲（WeakMap 看生死；Set 供定额清扫 deleteBuffer） */
  private bufs = new WeakMap<Float32Array, GpuBuf>();
  private bufAll = new Set<GpuBuf>();
  private frame = 0;
  /** 环数组 → 合并几何（同一环集跨帧复用，副本变化不影响它） */
  private geoCache = new WeakMap<object, Map<string, PieceGeo>>();
  private meshCache = new WeakMap<object, { buf: GpuBuf | null }>();
  private failed = false;

  private constructor(canvas: HTMLCanvasElement, gl: WebGL2RenderingContext) {
    this.canvas = canvas;
    this.gl = gl;
    const pFan = compile(gl, VERT_FAN, FRAG_COLOR, 'fan');
    const pQuad = compile(gl, VERT_QUAD, FRAG_COLOR, 'quad');
    const pStrip = compile(gl, VERT_STRIP, FRAG_COLOR, 'strip');
    const pFade = compile(gl, VERT_FADE, FRAG_FADE, 'fade');
    const pComposite = compile(gl, VERT_SCREEN, FRAG_FADE_COMPOSITE, 'fadeComposite');
    const pFillField = compile(gl, VERT_FAN, FRAG_FILL_FIELD, 'fillField');
    if (!pFan || !pQuad || !pStrip || !pFade || !pComposite || !pFillField) throw new Error('shader compile failed');
    this.progFan = toProgram(gl, pFan);
    this.progQuad = toProgram(gl, pQuad);
    this.progStrip = toProgram(gl, pStrip);
    this.progFade = toProgram(gl, pFade);
    this.progComposite = toProgram(gl, pComposite);
    this.progFillField = toProgram(gl, pFillField);

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

      // bg：整幅清海色（与 Canvas bgLayer 同色）；框外由 frame 层遮罩
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
      this.setCam(env, this.progFade);

      const tParams = performance.now();
      const pieces = channels.elements ? buildPieceParams(env) : [];
      const tSubmit = performance.now();
      if (channels.cellsMesh && env.showCellMesh) this.drawCellMesh(env);
      // 相位 A：阴影场（整帧只绑一次场 FBO；各片的场写进图集独立 tile）
      const tiles = this.fieldPass(env, pieces);
      // 相位 B：场景顺序（fill+阴影一次合成 → stroke，后件盖前件）
      for (const piece of pieces) this.drawPiece(env, piece, s, tiles);
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

  /** 渐隐场缓冲（设备像素，只增不缩）：多环/副本的场值以 MAX 归并 */
  private ensureFadeRT(devW: number, devH: number): void {
    const gl = this.gl;
    if (this.fadeTex && devW <= this.fadeW && devH <= this.fadeH) return;
    if (this.fadeTex) gl.deleteTexture(this.fadeTex);
    if (this.fadeFbo) gl.deleteFramebuffer(this.fadeFbo);
    this.fadeW = Math.max(devW, this.fadeW);
    this.fadeH = Math.max(devH, this.fadeH);
    this.fadeTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.fadeTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.fadeW, this.fadeH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fadeFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fadeFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fadeTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private setDxs(dxs: number[]): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dxsBuf);
    gl.bufferData(gl.ARRAY_BUFFER, Float32Array.from(dxs), gl.DYNAMIC_DRAW);
  }

  /** 数组 → VAO（按角色布局；fade 携带索引缓冲） */
  private bufFor(arr: Float32Array, role: BufRole, idx?: Uint32Array): GpuBuf {
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
    const stride = role === 'fan' ? 8 : role === 'strip' ? 16 : 20;
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
    } else {
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 8);
      gl.enableVertexAttribArray(2);
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 16);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.dxsBuf);
      gl.enableVertexAttribArray(3);
      gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 4, 0);
      gl.vertexAttribDivisor(3, 1);
    }
    let ibo: WebGLBuffer | null = null;
    let count = role === 'fade' ? (idx ? idx.length : 0) : arr.length / (stride / 4);
    if (role === 'fade' && idx) {
      ibo = gl.createBuffer()!;
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    }
    gl.bindVertexArray(null);
    const rec: GpuBuf = { vbo, ibo, vao, count, last: this.frame };
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

  /** 同一环集的合并几何（fan/strip/fade + 环并集 bbox） */
  private pieceGeo(rings: DisplayRing[], smooth: number): PieceGeo | null {
    const key = smooth.toFixed(2);
    let byKey = this.geoCache.get(rings as unknown as object);
    if (!byKey) {
      byKey = new Map();
      this.geoCache.set(rings as unknown as object, byKey);
    }
    const hit = byKey.get(key);
    if (hit) return hit;
    const fans: Float32Array[] = [];
    const strips: Float32Array[] = [];
    const fadeVs: Float32Array[] = [];
    const fadeIs: Uint32Array[] = [];
    const fillEntries: { ring: DisplayRing; pts: Pt[] }[] = [];
    let bbox: BBox | null = null;
    for (const ring of rings) {
      if (ring.pts.length < 2) continue;
      // 与 paintPieceParams 同语义：只有闭合环参与填充；开环只描边/阴影
      const fill = ring.closed ? ringGeo(ring, smooth, 'fill') : null;
      const outline = ringGeo(ring, smooth, 'outline');
      const g = fill ?? outline;
      if (g) bbox = unionBox(bbox, g.bbox.minX, g.bbox.maxX, g.bbox.minY, g.bbox.maxY);
      if (fill?.fillPts && fill.fillPts.length >= 3) fillEntries.push({ ring, pts: fill.fillPts });
      if (fill?.fan) fans.push(fill.fan);
      if (outline?.strip) strips.push(outline.strip);
      if (outline?.fade) {
        fadeVs.push(outline.fade.verts);
        fadeIs.push(outline.fade.idx);
      }
    }
    const merged = mergeFade(fadeVs, fadeIs);
    const tri = triangulateRings(fillEntries);
    const geo: PieceGeo = {
      tri: tri?.tris ?? null,
      triOk: !!tri?.areaOk,
      fan: mergeF(fans),
      strip: mergeF(strips),
      fadeV: merged?.v ?? null,
      fadeI: merged?.i ?? null,
      bbox,
    };
    byKey.set(key, geo);
    return geo;
  }

  /**
   * 一件元素的整段绘制（fill → 内阴影 → stroke，后件盖前件 = Canvas 同序）。
   *
   * 主路径（tri/剖分自检通过且副本不重叠）：**填充三角形直绘**——
   * 有阴影时 ① 场缓冲：填充三角写 0 + 渐隐条带 MAX 归并（= 描边并集再模糊）
   * ② 填充三角采样场值一次合成（X/A 代数与 Canvas「fill→shadow over」精确等价）。
   * 全程无包围盒级 clear/覆盖面/扇形（旧路径的大头），也无 stencil。
   *
   * 兜底路径（剖分失败 / 副本几何可能重叠：件宽 ≥ 世界周期）：stencil 奇偶 +
   * 外部参考点扇形 + 覆盖面 + 渐隐 RT 合成——语义精确（evenodd 含副本重叠不叠色），
   * 只给罕见件用。
   */
  /**
   * 相位 A：阴影场构建（**整帧只绑一次场 FBO**——FBO 切换在 tiler 上是渲染通道边界，
   * 每片一切换曾烧掉 ~15ms/帧）。各片的场写进图集的独立 tile（gl.viewport 定位，
   * 零成本状态切换），tile = 该片屏幕包围盒（含条带外伸）1:1。
   * 场内容 = 填充三角写 0（覆盖旧场）→ 渐隐条带 MAX 归并（= Canvas「描边并集再模糊」）。
   * 返回每片的 tile（null = 装箱失败/无阴影 → 场景相位走兜底或无阴影）。
   */
  private fieldPass(env: RenderEnv, pieces: PieceParams[]): Map<PieceParams, FieldTile | null> {
    const out = new Map<PieceParams, FieldTile | null>();
    const shadowed = pieces.filter(
      (p) => !p.fullFrame && p.shadowW > 0 && p.shadowAlpha > 0 && p.rings.length,
    );
    if (!shadowed.length) return out;
    const gl = this.gl;
    const devW = Math.round(env.w * env.dpr);
    const devH = Math.round(env.h * env.dpr);
    const scale = env.cam.scale * env.dpr;
    const halfW = (env.w * env.dpr) / 2;
    const halfH = (env.h * env.dpr) / 2;
    // 每片屏幕包围盒（含渐隐条带外伸 ±2.5w + 安全余量）
    type Item = { piece: PieceParams; w: number; h: number; x: number; y: number };
    const items: Item[] = [];
    for (const p of shadowed) {
      const geo = this.pieceGeo(p.rings, p.smooth);
      const gbox = geo?.bbox;
      if (!geo || !gbox || !geo.fadeV || !geo.fadeI || !geo.tri || !geo.triOk) {
        out.set(p, null);
        continue;
      }
      const margin = 2.6 * p.shadowW + 1 / env.cam.scale;
      const all = p.copies.length ? p.copies : [0];
      let minX = Infinity;
      let maxX = -Infinity;
      for (const dx of all) {
        minX = Math.min(minX, gbox.minX + dx);
        maxX = Math.max(maxX, gbox.maxX + dx);
      }
      // 只需覆盖屏幕可见部分（uv 映射以屏幕原点为基准）
      const x0 = Math.max(0, Math.floor((minX - margin - env.cam.x) * scale + halfW));
      const x1 = Math.min(devW, Math.ceil((maxX + margin - env.cam.x) * scale + halfW));
      const y0 = Math.max(0, Math.floor((env.cam.y - (gbox.maxY + margin)) * scale + halfH));
      const y1 = Math.min(devH, Math.ceil((env.cam.y - (gbox.minY - margin)) * scale + halfH));
      const w = Math.min(Math.max(1, x1 - x0), 8192);
      const h = Math.min(Math.max(1, y1 - y0), 8192);
      if (w <= 0 || h <= 0) {
        out.set(p, null);
        continue;
      }
      items.push({ piece: p, w, h, x: x0, y: y0 });
    }
    if (!items.length) return out;
    // 货架装箱（按高降序）；图集只增不缩
    items.sort((a, b) => b.h - a.h);
    let texW = 1024;
    let texH = 1024;
    const pack = (): Map<PieceParams, FieldTile> | null => {
      const res = new Map<PieceParams, FieldTile>();
      let shelfY = 0;
      let shelfH = 0;
      let cursorX = 0;
      for (const it of items) {
        if (it.w > texW || it.h > texH) return null;
        if (cursorX + it.w > texW) {
          shelfY += shelfH;
          shelfH = 0;
          cursorX = 0;
        }
        if (shelfY + it.h > texH) return null;
        res.set(it.piece, { x: cursorX, y: shelfY, w: it.w, h: it.h, sx: it.x, sy: it.y });
        cursorX += it.w;
        shelfH = Math.max(shelfH, it.h);
      }
      return res;
    };
    let tiles = pack();
    let grows = 0;
    while (!tiles && grows++ < 6 && (texW < 8192 || texH < 8192)) {
      const nw = texW <= texH ? Math.min(8192, texW * 2) : texW;
      const nh = texW <= texH ? texH : Math.min(8192, texH * 2);
      if (nw === texW && nh === texH) break;
      texW = nw;
      texH = nh;
      tiles = pack();
    }
    if (!tiles) {
      for (const it of items) out.set(it.piece, null);
      return out;
    }
    this.ensureFadeRT(texW, texH);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fadeFbo);
    // tiler 提示：附件旧内容无用 → 跳过 load（tile 每帧全覆盖重写）
    gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.COLOR_ATTACHMENT0]);
    gl.disable(gl.STENCIL_TEST);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.scissor(0, 0, texW, texH);
    for (const [piece, tile] of tiles) {
      out.set(piece, tile);
      const geo = this.pieceGeo(piece.rings, piece.smooth);
      if (!geo?.fadeV || !geo.fadeI) continue;
      const copies = piece.copies.length ? piece.copies : [0];
      this.setDxs(copies);
      gl.viewport(tile.x, tile.y, tile.w, tile.h);
      gl.scissor(tile.x, tile.y, tile.w, tile.h);
      // ① 场清零：三角形写 0（光栅=填充面积）；无三角形的兜底件退化为 tile 域 clear
      gl.blendFunc(gl.ONE, gl.ZERO);
      if (geo.tri) {
        gl.useProgram(this.progFan.prog);
        if (this.progFan.uColor) gl.uniform4f(this.progFan.uColor, 0, 0, 0, 0);
        const tbuf = this.bufFor(geo.tri, 'fan');
        gl.bindVertexArray(tbuf.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, tbuf.count, copies.length);
        gl.bindVertexArray(null);
      } else {
        gl.clearColor(0, 0, 0, 0);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
      // ② 渐隐条带 MAX 归并（= Canvas「描边并集再模糊」语义，禁止叠加求和）
      gl.blendEquationSeparate(gl.MAX, gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE); // MIN/MAX 方程下混合因子被忽略
      const fbuf = this.bufFor(geo.fadeV, 'fade', geo.fadeI);
      gl.useProgram(this.progFade.prog);
      if (this.progFade.uHalfW) gl.uniform1f(this.progFade.uHalfW, piece.shadowW);
      gl.bindVertexArray(fbuf.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, fbuf.count, gl.UNSIGNED_INT, 0, copies.length);
      gl.bindVertexArray(null);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, devW, devH);
    return out;
  }

  private drawPiece(
    env: RenderEnv,
    piece: PieceParams,
    frame: { x: number; y: number; w: number; h: number },
    tiles: Map<PieceParams, FieldTile | null>,
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
    const shadowOn = piece.shadowW > 0 && piece.shadowAlpha > 0;
    const strokeOn = piece.strokeW > 0 && piece.stroke !== 'transparent';
    const strokeC = strokeOn ? cssToRgba(piece.stroke) : null;
    const shadowC = shadowOn ? cssToRgba(piece.shadowColor) : null;
    const fillC = piece.fillOn ? cssToRgba(typeof piece.fillColor === 'string' ? piece.fillColor : '') : null;
    if (!piece.fillOn && !shadowOn && !strokeOn) return;
    if ((piece.fillOn && !fillC) || (shadowOn && !shadowC) || (strokeOn && !strokeC)) {
      this.failed = true;
      pushErr(`piece ${piece.key}: 非纯色样式，回退 Canvas2D`);
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
    const tile = tiles.get(piece);
    const useField = shadowOn && shadowC && !!tile;
    const fast = !!geo.tri && geo.triOk && (!shadowOn || useField);

    if (fast) {
      const triBuf = this.bufFor(geo.tri!, 'fan');
      const af = piece.fillOn && fillC ? Math.max(0, Math.min(1, piece.fillAlpha)) * fillC[3] : 0;
      this.setDxs(copies);
      if (overlap) {
        const margin = Math.max(shadowOn ? 2.6 * piece.shadowW : 0, piece.strokeW) + 1 / env.cam.scale;
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
      if (useField) {
        // 填充 + 内阴影一次合成（X/A = Canvas fill→shadow over 精确等价）
        gl.useProgram(this.progFillField.prog);
        if (this.progFillField.uColor && fillC) {
          gl.uniform4f(this.progFillField.uColor, fillC[0], fillC[1], fillC[2], af);
        } else if (this.progFillField.uColor) {
          gl.uniform4f(this.progFillField.uColor, 0, 0, 0, 0);
        }
        if (this.progFillField.uShadow && shadowC) {
          gl.uniform4f(this.progFillField.uShadow, shadowC[0], shadowC[1], shadowC[2], piece.shadowAlpha * shadowC[3]);
        }
        if (this.progFillField.uTile) {
          gl.uniform4f(this.progFillField.uTile, tile!.x - tile!.sx, tile!.y - tile!.sy, this.fadeW || 1, this.fadeH || 1);
        }
        if (this.progFillField.uField) {
          gl.activeTexture(gl.TEXTURE0);
          gl.bindTexture(gl.TEXTURE_2D, this.fadeTex);
          gl.uniform1i(this.progFillField.uField, 0);
        }
        gl.bindVertexArray(triBuf.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, triBuf.count, copies.length);
        gl.bindVertexArray(null);
      } else if (piece.fillOn && fillC) {
        gl.useProgram(this.progFan.prog);
        if (this.progFan.uColor) gl.uniform4f(this.progFan.uColor, fillC[0], fillC[1], fillC[2], af);
        gl.bindVertexArray(triBuf.vao);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, triBuf.count, copies.length);
        gl.bindVertexArray(null);
      }
      if (overlap) gl.disable(gl.STENCIL_TEST);
    } else {
      this.drawPieceStencil(env, piece, geo, frame, copies, minDx, maxDx, tiles.get(piece) ?? null, {
        devW,
        devH,
        fillC,
        shadowC,
        strokeC,
        shadowOn,
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

  /** 三角化自检失败时的语义兜底：stencil INVERT 扇形 + 覆盖面 + 渐隐场合成（罕见件） */
  private drawPieceStencil(
    env: RenderEnv,
    piece: PieceParams,
    geo: PieceGeo,
    frame: { x: number; y: number; w: number; h: number },
    copies: number[],
    minDx: number,
    maxDx: number,
    tile: FieldTile | null,
    s: {
      devW: number;
      devH: number;
      fillC: [number, number, number, number] | null;
      shadowC: [number, number, number, number] | null;
      strokeC: [number, number, number, number] | null;
      shadowOn: boolean;
      strokeOn: boolean;
    },
  ): void {
    void s.strokeC;
    void s.strokeOn;
    const gbox = geo.bbox;
    if (!gbox) return;
    const gl = this.gl;
    const margin = Math.max(s.shadowOn ? 2.6 * piece.shadowW : 0, piece.strokeW) + 1 / env.cam.scale;
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
    if (geo.fan) {
      const buf = this.bufFor(geo.fan, 'fan');
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
    if (s.shadowOn && s.shadowC && tile) {
      // 阴影场已在相位 A 建好（图集 tile）；这里只做场→填充的合成（stencil 仍裁到填充）
      gl.useProgram(this.progComposite.prog);
      gl.scissor(sc.x, sc.y, sc.w, sc.h);
      if (this.progComposite.uRect) gl.uniform4f(this.progComposite.uRect, sc.x, sc.y, sc.w, sc.h);
      if (this.progComposite.uUvRect) {
        gl.uniform4f(this.progComposite.uUvRect, tile.x + (sc.x - tile.sx), tile.y + (sc.y - tile.sy), sc.w, sc.h);
      }
      if (this.progComposite.uSizeDev) gl.uniform2f(this.progComposite.uSizeDev, s.devW, s.devH);
      if (this.progComposite.uAtlas) gl.uniform2f(this.progComposite.uAtlas, this.fadeW || 1, this.fadeH || 1);
      if (this.progComposite.uColor) {
        gl.uniform4f(this.progComposite.uColor, s.shadowC[0], s.shadowC[1], s.shadowC[2], piece.shadowAlpha * s.shadowC[3]);
      }
      if (this.progComposite.uField) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, this.fadeTex);
        gl.uniform1i(this.progComposite.uField, 0);
      }
      gl.bindVertexArray(this.quadVao);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, 4);
      gl.bindVertexArray(null);
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
    // 每 pcache 构建一次网格条带（共享边去重）；相机变化只改 uniform
    let entry = this.meshCache.get(env.pcache as unknown as object);
    if (!entry) {
      const period = projectionWorldPeriod(env.proj) ?? Math.PI * 2;
      const strips = buildCellMeshStrips(env.pcache.polys, env.pcache.polarOutlines, period);
      entry = { buf: strips.length ? this.bufFor(strips, 'strip') : null };
      this.meshCache.set(env.pcache as unknown as object, entry);
    }
    if (!entry.buf) return;
    const scale = env.cam.scale;
    const viewL = env.cam.x - env.w / 2 / scale;
    const viewR = env.cam.x + env.w / 2 / scale;
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
    gl.drawArraysInstanced(gl.TRIANGLES, 0, entry.buf.count, copies.length);
    gl.bindVertexArray(null);
  }
}
