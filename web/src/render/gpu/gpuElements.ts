/**
 * WebGL2 元素层渲染器（RegionMesh 后端）。
 *
 * 与 Canvas2D 路径逐像素同义（RENDER_LOGIC 契约）：
 * - 填充：Hermite 环（`sampleMidRing` 同源曲线）→ 外部参考点三角扇 + stencil 奇偶
 *   = evenodd 语义（含世界副本间的重叠：奇偶天然不叠色，与 Canvas 单 Path2D 一致）
 * - 内阴影：环折线以 2×宽细长四边形渲到离屏纹理 → 高斯 blur → **按填充 stencil 合成**
 *   = Canvas 的 clip(fill) + blur 描边（合成必须裁进填充，否则外半圈阴影溢出元素）
 * - 描边：折线细长四边形（端头外延盖住连接处，≈ round join/round cap）
 * - z 序：按传入顺序逐件绘制；填充在下、内阴影中、描边上（fill→shadow→stroke）
 *
 * **闭合语义单源**：条带是否首尾相接由 `hermite.appendMidRing` 的 closePath 条件决定
 * （outline 模式遇 `virtualFrom` 跨界尾巴是**开环**——若强制闭合，首尾被连成一条
 * 横跨地图的直线段，即「地图中间一条横线」）。禁止在条带拼接处另立闭合规则。
 *
 * **热路径设计**（缩放 = 每 tick 全量重烘焙，GPU 必须 ≤ Canvas）：
 * - 几何全部按环对象缓存（WeakMap，与 ringPath2D 同款键）：Hermite 采样折线、三角扇
 *   （参考点取自环自身包围盒外侧）、条带（基点+方向布局，**宽度走 uHalfW uniform**）。
 *   缩放只改 uniform，零几何重算、零重采样；缓存数组按引用持有 VBO，跨帧零重传。
 * - GL 画布/离屏纹理 **只增不缩**（1024px 粒度）：缩放 tick 不再逐帧重建 MSAA 绘图缓冲
 *   与 RT（period 模式贴图宽随 TEX_SCALE 每 tick 涨 ~几百 px，逐帧 realloc = 数百 ms 尖峰）。
 *   活动区 [0,devW]×[0,devH] 锚定缓冲**左下**；全屏 pass 的 vUv 按 uVP 收窄到活动区，
 *   drawImage 源 y 补 (allocH-devH)（GL 缓冲 y 向上、图像 y 向下的固定换算）。
 * - **clear 全部按包围盒 scissor**：初始清屏 scissor 到各件联合盒，每件 stencil 清零
 *   scissor 到件盒（此前 = 13 次全画布 MSAA 清屏/烘焙）。
 * - **副本出窗裁剪**：±period 副本平移后与画布不相交的，扇形/条带整体不画。
 * - **阴影低清 blur 链**：σ_device ≥ 5px 用 1/2、≥10px 用 1/4 分辨率渲条带并 blur，
 *   合成线性上采样（阴影是低频信号，低清+上采样 ≈ 全清，成本 1/4~1/16，对齐 Skia 金字塔 blur）；
 *   合成仍按填充 stencil 在全分辨率裁剪。
 * - 合成 drawImage 只贴画过内容的联合包围盒（9 参 1:1）。
 *
 * 环曲线只经 core/ring/hermite 采样（平滑参数与 Canvas 同源）。
 * GL 不可用/异常时 render() 返回 false，调用方回退 Canvas2D（显示不降级）。
 */
import type { DisplayRing } from '../../core/ring/displayRing';
import { sampleMidRing } from '../../core/ring/hermite';

export interface GpuPieceSpec {
  /** preparePieces 输出的显示环 */
  rings: DisplayRing[];
  /** 填充色（css 颜色字符串）；undefined = 中空不填 */
  fill?: { color: string; alpha: number };
  /** 描边（用户单位宽）；undefined = 无描边 */
  border?: { color: string; width: number };
  /** 内阴影（用户单位宽） */
  shadow?: { color: string; width: number; alpha: number };
  smooth: number;
  /** 世界副本偏移（与 Canvas copies 同语义） */
  copies: number[];
  /** 整框底色片（无环全世界集）：按矩形填，不走 stencil */
  fullFrameFill?: { color: string; alpha: number; minX: number; maxX: number; minY: number; maxY: number };
}

interface RenderCtx2DLike {
  canvas: { width: number; height: number };
  save(): void;
  restore(): void;
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void;
  drawImage(
    img: CanvasImageSource,
    sx: number, sy: number, sw: number, sh: number,
    dx: number, dy: number, dw: number, dh: number,
  ): void;
}

interface GlUniformLoc { [k: string]: WebGLUniformLocation | null }

interface Pt {
  x: number;
  y: number;
}

/**
 * 环几何缓存：折线 + 三角扇 + 条带（基点+方向，宽度 uniform 化）。
 * 闭合语义只来自 hermite（willClose），不在此另立规则。
 */
interface RingGeo {
  /** fill：外部参考点三角扇（参考点取自本环包围盒外侧 → 与副本无关，可缓存） */
  fan: Float32Array | null;
  /** outline：条带顶点 [baseX, baseY, dirX, dirY] × 6 / 段；实际顶点 = base + dir * uHalfW */
  strip: Float32Array | null;
}

/** 预扫产物：一件的全部绘制信息（bbox/裁剪后副本/几何），画与 clear 都用它 */
interface Item {
  s: GpuPieceSpec;
  fills: RingGeo[];
  outs: RingGeo[];
  /** 内容包围盒（环点；不含 ref） */
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  /** 裁剪后仍与窗口相交的副本偏移 */
  copies: number[];
  /** 副本平移后的内容 x 范围 */
  copyMinX: number;
  copyMaxX: number;
  /** 设备像素盒（含条带/blur 余量） */
  bx0: number;
  bx1: number;
  by0: number;
  by1: number;
}

const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec2 uCam;
uniform float uScale;
uniform float uDpr;
uniform vec2 uHalf;
uniform float uDx;
void main() {
  float sx = ((aPos.x + uDx - uCam.x) * uScale + uHalf.x) * uDpr;
  float sy = ((uCam.y - aPos.y) * uScale + uHalf.y) * uDpr;
  gl_Position = vec4(sx / (uHalf.x * 2.0 * uDpr) * 2.0 - 1.0, 1.0 - sy / (uHalf.y * 2.0 * uDpr) * 2.0, 0.0, 1.0);
}`;

/** 条带：顶点 = aBase + aDir * uHalfW（几何与宽度解耦 → 缩放零重建） */
const VERT_STRIP = `#version 300 es
layout(location=0) in vec2 aBase;
layout(location=1) in vec2 aDir;
uniform vec2 uCam;
uniform float uScale;
uniform float uDpr;
uniform vec2 uHalf;
uniform float uDx;
uniform float uHalfW;
void main() {
  vec2 p = aBase + aDir * uHalfW;
  float sx = ((p.x + uDx - uCam.x) * uScale + uHalf.x) * uDpr;
  float sy = ((uCam.y - p.y) * uScale + uHalf.y) * uDpr;
  gl_Position = vec4(sx / (uHalf.x * 2.0 * uDpr) * 2.0 - 1.0, 1.0 - sy / (uHalf.y * 2.0 * uDpr) * 2.0, 0.0, 1.0);
}`;

const FRAG_COLOR = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 outColor;
void main() { outColor = uColor; }`;

const FRAG_TEX = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec4 uColor;
out vec4 outColor;
void main() {
  float a = texture(uTex, vUv).a;
  outColor = vec4(uColor.rgb, uColor.a * a);
}`;

// uVP：活动区 [0,devW]×[0,devH] 在分桶大缓冲里的占比。全屏 pass 的 vUv 按它收窄，
// 保证「内容绘制区 = blur 取样区 = 合成区」三者同一映射；NDC 仍是 [-1,1]（viewport 已限定活动区）。
const VERT_TEX = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec2 uVP;
out vec2 vUv;
void main() {
  vUv = (aPos * 0.5 + 0.5) * uVP;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG_BLUR = `#version 300 es
precision mediump float;
in vec2 vUv;
uniform sampler2D uTex;
uniform vec2 uDir;
uniform float uW[9];
out vec4 outColor;
void main() {
  float acc = 0.0;
  for (int i = 0; i < 9; i++) {
    acc += texture(uTex, vUv + uDir * float(i - 4)).a * uW[i];
  }
  outColor = vec4(acc, acc, acc, acc);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error('createShader');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram();
  if (!p) throw new Error('createProgram');
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error('program: ' + gl.getProgramInfoLog(p));
  }
  return p;
}

/** css 颜色（#rgb/#rrggbb/rgb()/rgba()）→ [r,g,b] 0-255；不识别返回 null */
function parseColor(css: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(css.trim());
  if (m) {
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  }
  const r = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(css.trim());
  if (r) return [+r[1], +r[2], +r[3]];
  return null;
}

/**
 * 折线 → 条带顶点（基点+单位方向；宽度由 uHalfW 施加）。
 * 每段端头沿切线外延 halfWidth 盖住连接处 ≈ round cap/join。
 * closed 语义与 hermite 一致：开环（跨界 virtualFrom 尾巴）绝不首尾相接。
 */
function buildStripLayout(pts: Pt[], closed: boolean): Float32Array {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  if (segs < 1) return new Float32Array(0);
  const out = new Float32Array(segs * 24);
  let o = 0;
  const push = (bx: number, by: number, dx: number, dy: number): void => {
    out[o++] = bx; out[o++] = by; out[o++] = dx; out[o++] = dy;
  };
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const len = Math.hypot(sx, sy) || 1;
    const ux = sx / len;
    const uy = sy / len;
    const nx = uy;
    const ny = -ux;
    // 顶点 = base + dir * halfWidth（dir = ±u ±n 的合成）
    push(a.x, a.y, -ux - nx, -uy - ny);
    push(a.x, a.y, -ux + nx, -uy + ny);
    push(b.x, b.y, ux + nx, uy + ny);
    push(a.x, a.y, -ux - nx, -uy - ny);
    push(b.x, b.y, ux + nx, uy + ny);
    push(b.x, b.y, ux - nx, uy - ny);
  }
  return out;
}

/** 环 → 外部参考点三角扇（stencil INVERT；扇形奇偶 = evenodd = Canvas fill 隐式闭合） */
function buildFan(pts: Pt[]): Float32Array {
  const n = pts.length;
  if (n < 3) return new Float32Array(0);
  let minX = Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  // 参考点只需在环外：包围盒正下方即保证外部（贴近包围盒 → 扇形光栅面积 ∝ 元素本身）
  const margin = Math.max(0.05, (maxY - minY) * 0.05);
  const refX = minX - margin;
  const refY = minY - margin;
  const out = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const o = i * 6;
    out[o] = refX;
    out[o + 1] = refY;
    out[o + 2] = pts[i].x;
    out[o + 3] = pts[i].y;
    out[o + 4] = pts[j].x;
    out[o + 5] = pts[j].y;
  }
  return out;
}

/** 环几何缓存：同一环对象跨帧/跨缩放复用（键与 ringPath2D 同款，语义平行） */
const geoCache = new WeakMap<object, Map<string, RingGeo>>();

function ringGeo(ring: DisplayRing, smooth: number, mode: 'fill' | 'outline'): RingGeo | null {
  let byKey = geoCache.get(ring as unknown as object);
  if (!byKey) {
    byKey = new Map();
    geoCache.set(ring as unknown as object, byKey);
  }
  const key = `${mode}:${smooth.toFixed(2)}`;
  const hit = byKey.get(key);
  if (hit) return hit;
  // 闭合条件 = hermite.appendMidRing 的 closePath 条件（唯一定义点）：
  // outline 模式遇 virtualFrom 跨界尾巴是**开环**——强制闭合会把首尾连成横跨地图的直线。
  const willClose = ring.closed && (mode === 'fill' || ring.virtualFrom === undefined);
  const pts = sampleMidRing(ring, smooth, mode);
  if (willClose && pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12) pts.pop();
  }
  if (mode === 'outline' ? pts.length < 2 : pts.length < 3) return null;
  const closed = willClose && pts.length >= 3;
  const geo: RingGeo = {
    fan: mode === 'fill' ? buildFan(pts) : null,
    strip: mode === 'outline' ? buildStripLayout(pts, closed) : null,
  };
  byKey.set(key, geo);
  return geo;
}

const BUCKET = 1024;
function bucketSize(v: number): number {
  return Math.max(BUCKET, Math.ceil(v / BUCKET) * BUCKET);
}

interface Rt {
  fb: WebGLFramebuffer;
  tex: WebGLTexture;
  w: number;
  h: number;
}

export class GpuElementsRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private progColor: WebGLProgram;
  private progStrip: WebGLProgram;
  private progTex: WebGLProgram;
  private progBlur: WebGLProgram;
  private locColor: GlUniformLoc = {};
  private locStrip: GlUniformLoc = {};
  private locTex: GlUniformLoc = {};
  private locBlur: GlUniformLoc = {};
  private vbo: WebGLBuffer;
  private fsVbo: WebGLBuffer;
  private rtA: Rt | null = null;
  private rtB: Rt | null = null;
  /** 低清 blur 链（k → 1/k 分辨率一对 RT）；阴影是低频信号，低清+线性上采样 ≈ 全清 */
  private rtLow = new Map<number, { a: Rt; b: Rt }>();
  /** 缓冲按数据数组缓存：几何数组不变则跨帧零重传 */
  private vboCache = new WeakMap<Float32Array, WebGLBuffer>();
  /** 当前帧变换（setStripUniforms 用） */
  private tCam: readonly [number, number] = [0, 0];
  private tScale = 1;
  private tDpr = 1;
  private tHalf: readonly [number, number] = [0, 0];
  /** 当前帧活动区（低清链 viewport / uVP 用） */
  private devW = 1;
  private devH = 1;
  private vpX = 1;
  private vpY = 1;

  private constructor() {
    const canvas = document.createElement('canvas');
    // premultipliedAlpha 必须为 true：GL 混合（SRC_ALPHA）写入缓冲的 rgb 已乘过 α，
    // 若声明直通（false），drawImage 会再乘一次 α → 半透明填充整体偏暗（实测深海 -2/-3/-10）。
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      stencil: true,
      depth: false,
      // drawImage 合成与 GL 绘制在同一同步块内（render() 内完成），无需保留绘图缓冲；
      // true 会强制驱动保留 MSAA 缓冲 + 每帧 resolve，是缩放烘焙的固定额外成本。
      preserveDrawingBuffer: false,
    });
    if (!gl) throw new Error('webgl2 不可用');
    this.canvas = canvas;
    this.gl = gl;
    this.progColor = link(gl, VERT, FRAG_COLOR);
    this.progStrip = link(gl, VERT_STRIP, FRAG_COLOR);
    this.progTex = link(gl, VERT_TEX, FRAG_TEX);
    this.progBlur = link(gl, VERT_TEX, FRAG_BLUR);
    for (const n of ['uCam', 'uScale', 'uDpr', 'uHalf', 'uDx', 'uColor']) {
      this.locColor[n] = gl.getUniformLocation(this.progColor, n);
    }
    for (const n of ['uCam', 'uScale', 'uDpr', 'uHalf', 'uDx', 'uHalfW', 'uColor']) {
      this.locStrip[n] = gl.getUniformLocation(this.progStrip, n);
    }
    for (const n of ['uTex', 'uColor', 'uVP']) {
      this.locTex[n] = gl.getUniformLocation(this.progTex, n);
    }
    for (const n of ['uTex', 'uDir', 'uW', 'uVP']) {
      this.locBlur[n] = gl.getUniformLocation(this.progBlur, n);
    }
    const vbo = gl.createBuffer();
    const fsVbo = gl.createBuffer();
    if (!vbo || !fsVbo) throw new Error('createBuffer');
    this.vbo = vbo;
    this.fsVbo = fsVbo;
    gl.bindBuffer(gl.ARRAY_BUFFER, fsVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  }

  static create(): GpuElementsRenderer | null {
    try {
      return new GpuElementsRenderer();
    } catch (e) {
      console.error('[gpuElements] 初始化失败，回退 Canvas2D：', e);
      return null;
    }
  }

  /** 渲染整片元素到目标 2d 上下文（在其当前裁剪内合成）；失败返回 false 由调用方回退 */
  render(
    target: RenderCtx2DLike,
    env: {
      cam: { x: number; y: number; scale: number };
      w: number;
      h: number;
      dpr: number;
    },
    specs: GpuPieceSpec[],
  ): boolean {
    const gl = this.gl;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    try {
      const dpr = env.dpr || 1;
      const devW = Math.max(1, Math.round(env.w * dpr));
      const devH = Math.max(1, Math.round(env.h * dpr));
      // 只增不缩（1024 粒度）：period 模式贴图宽随 TEX_SCALE 每 tick 涨数百 px，
      // 逐帧重建 MSAA 绘图缓冲 + RT = 数百 ms 尖峰；仅当需求超当前（或缩到一半以下）才重分配
      const needW = bucketSize(devW);
      const needH = bucketSize(devH);
      const curW = this.canvas.width;
      const curH = this.canvas.height;
      if (needW > curW || needH > curH || (needW < curW / 2 && needH < curH / 2)) {
        this.canvas.width = needW;
        this.canvas.height = needH;
        this.disposeRts();
      }
      const allocW = this.canvas.width;
      const allocH = this.canvas.height;
      this.ensureRt(this.rtA, allocW, allocH, 'a');
      this.ensureRt(this.rtB, allocW, allocH, 'b');
      const vpX = devW / allocW;
      const vpY = devH / allocH;
      this.devW = devW;
      this.devH = devH;
      this.vpX = vpX;
      this.vpY = vpY;
      // 活动区锚定缓冲左下（viewport 原语义）：GL 缓冲 y 向上、图像 y 向下
      gl.viewport(0, 0, devW, devH);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.enable(gl.BLEND);
      // 预乘约定：着色器输出直通色，混合 SRC_ALPHA 时预乘 → 缓冲 = 预乘（与 premultipliedAlpha:true 一致）
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);

      this.tCam = [env.cam.x, env.cam.y];
      this.tScale = env.cam.scale;
      this.tDpr = dpr;
      this.tHalf = [env.w / 2, env.h / 2];
      const scale = env.cam.scale;
      // 内容坐标 → 设备像素（与 VERT 同一映射；y 向下为正）
      const devX = (x: number): number => (x - env.cam.x) * scale * dpr + (env.w / 2) * dpr;
      const devY = (y: number): number => (env.cam.y - y) * scale * dpr + (env.h / 2) * dpr;
      // 窗口内容 x 范围（副本出窗裁剪用）
      const winMinX = env.cam.x - env.w / 2 / scale;
      const winMaxX = env.cam.x + env.w / 2 / scale;

      /** 设备像素矩形（向下 y）→ GL scissor；k>1 时按 1/k 缩放（低清 RT） */
      const scissorRect = (
        x0: number, y0: number, x1: number, y1: number, k = 1,
      ): boolean => {
        const s = 1 / k;
        const hgt = devH * s;
        const gx0 = Math.max(0, Math.floor(x0 * s));
        const gy0 = Math.max(0, Math.floor(y0 * s));
        const gx1 = Math.min(devW * s, Math.ceil(x1 * s));
        const gy1 = Math.min(hgt, Math.ceil(y1 * s));
        if (gx1 <= gx0 || gy1 <= gy0) return false;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(gx0, hgt - gy1, gx1 - gx0, gy1 - gy0);
        return true;
      };

      // ── 预扫：几何（缓存）+ 每件 bbox + 副本出窗裁剪 + 联合盒 ──────────────
      const items: Item[] = [];
      let uX0 = Infinity, uY0 = Infinity, uX1 = -Infinity, uY1 = -Infinity;
      for (const s of specs) {
        const frame = s.fullFrameFill;
        if (frame) {
          const x0 = devX(frame.minX), x1 = devX(frame.maxX);
          const y0 = devY(frame.maxY), y1 = devY(frame.minY);
          if (x1 <= 0 || x0 >= devW || y1 <= 0 || y0 >= devH) continue;
          items.push({
            s, fills: [], outs: [],
            minX: frame.minX, maxX: frame.maxX, minY: frame.minY, maxY: frame.maxY,
            copies: [], copyMinX: frame.minX, copyMaxX: frame.maxX,
            bx0: x0, bx1: x1, by0: y0, by1: y1,
          });
          uX0 = Math.min(uX0, x0); uY0 = Math.min(uY0, y0);
          uX1 = Math.max(uX1, x1); uY1 = Math.max(uY1, y1);
          continue;
        }
        if (!s.rings.length) continue;
        const fills: RingGeo[] = [];
        const outs: RingGeo[] = [];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const r of s.rings) {
          const fp = ringGeo(r, s.smooth, 'fill');
          if (fp && fp.fan) fills.push(fp);
          const op = ringGeo(r, s.smooth, 'outline');
          if (op && op.strip) outs.push(op);
        }
        const bboxOf = (arr: Float32Array, stride: number, base: number): void => {
          for (let i = 0; i < arr.length; i += stride) {
            const x = arr[i + base];
            const y = arr[i + base + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        };
        for (const fp of fills) {
          // 扇形顶点 = (ref, p_i, p_j)：只取两个环点（ref 在环外，不进 bbox）
          for (let i = 0; i < fp.fan!.length; i += 6) {
            for (const o of [2, 4]) {
              const x = fp.fan![i + o];
              const y = fp.fan![i + o + 1];
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        for (const op of outs) bboxOf(op.strip!, 4, 0); // 基点
        if (minX === Infinity) continue;
        const bd = s.border && s.border.width > 0 ? s.border : null;
        const sh = s.shadow && s.shadow.width > 0 && s.shadow.alpha > 0 ? s.shadow : null;
        const halfUser = Math.max(bd ? bd.width / 2 : 0, sh ? sh.width : 0);
        const padUser = halfUser + 2 / (scale * dpr);
        // 副本出窗裁剪：平移后与窗口（含条带余量）不相交的副本不画
        const copies: number[] = [];
        for (const dx of s.copies.length ? s.copies : [0]) {
          if (minX + dx > winMaxX + padUser || maxX + dx < winMinX - padUser) continue;
          copies.push(dx);
        }
        if (!copies.length) continue;
        let copyMinX = Infinity, copyMaxX = -Infinity;
        for (const dx of copies) {
          copyMinX = Math.min(copyMinX, minX + dx);
          copyMaxX = Math.max(copyMaxX, maxX + dx);
        }
        const halfDev = halfUser * scale * dpr;
        const blurPx = sh ? (sh.width * scale) / 2 : 0;
        const sigmaDev = blurPx * dpr;
        // blur 抽头可达 4×spacing（spacing = max(1, σ/2.5)）
        const blurReach = Math.ceil(4 * Math.max(1, sigmaDev / 2.5)) + 2;
        const padDev = halfDev + 2;
        const bx0 = devX(copyMinX) - padDev, bx1 = devX(copyMaxX) + padDev;
        const by0 = devY(maxY) - padDev, by1 = devY(minY) + padDev;
        if (bx1 <= 0 || bx0 >= devW || by1 <= 0 || by0 >= devH) continue;
        items.push({ s, fills, outs, minX, maxX, minY, maxY, copies, copyMinX, copyMaxX, bx0, bx1, by0, by1 });
        uX0 = Math.min(uX0, bx0); uY0 = Math.min(uY0, by0);
        uX1 = Math.max(uX1, bx1); uY1 = Math.max(uY1, by1);
      }

      // 初始清屏 scissor 到联合盒（合成只读联合盒；clear 是全帧最大的固定 GPU 开销）
      let blurMs = 0;
      if (items.length && uX1 > uX0 && uY1 > uY0 && scissorRect(uX0, uY0, uX1, uY1)) {
        gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
      }
      gl.disable(gl.SCISSOR_TEST);

      // ── 逐件绘制 ────────────────────────────────────────────────────────
      for (const it of items) {
        const s = it.s;
        const frame = s.fullFrameFill;
        if (frame) {
          const rgb = parseColor(frame.color);
          if (!rgb) continue;
          if (!scissorRect(it.bx0, it.by0, it.bx1, it.by1)) continue;
          gl.disable(gl.STENCIL_TEST);
          gl.colorMask(true, true, true, true);
          this.setColorUniforms(0);
          gl.uniform4f(this.locColor.uColor, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, Math.max(0, Math.min(1, frame.alpha)));
          this.uploadTransient(quad(frame.minX, frame.minY, frame.maxX, frame.maxY));
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          continue;
        }

        // 1) stencil 奇偶（填充/阴影共用）——件盒内先清 stencil 再 INVERT
        if (!scissorRect(it.bx0, it.by0, it.bx1, it.by1)) continue;
        gl.clear(gl.STENCIL_BUFFER_BIT);
        gl.enable(gl.STENCIL_TEST);
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 1, 0x01);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        for (const fp of it.fills) {
          this.uploadVerts(fp.fan!);
          for (const dx of it.copies) {
            this.setColorUniforms(dx);
            gl.drawArrays(gl.TRIANGLES, 0, fp.fan!.length / 2);
          }
        }

        // 2) 填充罩色（单次全覆盖，副本重叠不叠色）
        const fillRgb = s.fill ? parseColor(s.fill.color) : null;
        gl.colorMask(true, true, true, true);
        gl.stencilFunc(gl.NOTEQUAL, 0, 0x01);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        if (fillRgb && s.fill) {
          this.setColorUniforms(0);
          gl.uniform4f(this.locColor.uColor, fillRgb[0] / 255, fillRgb[1] / 255, fillRgb[2] / 255, Math.max(0, Math.min(1, s.fill.alpha)));
          this.uploadTransient(quad(it.copyMinX, it.minY, it.copyMaxX, it.maxY));
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        // 3) 内阴影：描边(2×宽)→离屏 blur→**按填充 stencil 合成**（= Canvas clip(fill)）
        const sh = s.shadow && s.shadow.width > 0 && s.shadow.alpha > 0 ? s.shadow : null;
        const blurT0 = performance.now();
        if (sh && it.outs.length) {
          const blurPx = (sh.width * scale) / 2;
          const sigmaDev = blurPx * dpr;
          // 低清级别：σ 越大 blur 越低频，1/2 或 1/4 分辨率 + 线性上采样视觉等价（≈Skia 金字塔）
          const k = sigmaDev >= 10 ? 4 : sigmaDev >= 5 ? 2 : 1;
          const blurReach = Math.ceil(4 * Math.max(1, sigmaDev / 2.5)) + 2;
          const anyStrip = it.outs.some((o) => o.strip && o.strip.length);
          if (anyStrip) {
            const cOk = scissorRect(
              it.bx0 - 2 * blurReach, it.by0 - 2 * blurReach,
              it.bx1 + 2 * blurReach, it.by1 + 2 * blurReach, k,
            );
            if (cOk) {
              const shRgb = parseColor(sh.color) ?? [0, 0, 0];
              this.renderBlurredOutline(it, sh.width, sigmaDev, k, blurReach);
              // 合成裁到条带盒，并重新挂上填充 stencil（内阴影不得溢出元素外缘）
              scissorRect(it.bx0, it.by0, it.bx1, it.by1);
              gl.enable(gl.STENCIL_TEST);
              gl.stencilFunc(gl.NOTEQUAL, 0, 0x01);
              gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
              const srcRt = k === 1 ? this.rtA! : this.rtLow.get(k)!.a;
              gl.useProgram(this.progTex);
              gl.activeTexture(gl.TEXTURE0);
              gl.bindTexture(gl.TEXTURE_2D, srcRt.tex);
              gl.uniform1i(this.locTex.uTex, 0);
              gl.uniform2f(this.locTex.uVP, vpX, vpY);
              gl.uniform4f(
                this.locTex.uColor,
                shRgb[0] / 255,
                shRgb[1] / 255,
                shRgb[2] / 255,
                Math.max(0, Math.min(1, sh.alpha)),
              );
              this.bindFsTriangle();
              gl.drawArrays(gl.TRIANGLES, 0, 3);
            }
          }
        }
        blurMs += performance.now() - blurT0;

        // 4) 描边（圆角端头盖住连接处）
        gl.disable(gl.STENCIL_TEST);
        const bd = s.border && s.border.width > 0 ? s.border : null;
        if (bd) {
          const rgb = parseColor(bd.color);
          if (rgb && bd.color !== 'transparent') {
            scissorRect(it.bx0, it.by0, it.bx1, it.by1);
            for (const op of it.outs) {
              if (!op.strip || !op.strip.length) continue;
              this.uploadStrip(op.strip);
              for (const dx of it.copies) {
                this.setStripUniforms(dx, bd.width / 2);
                gl.uniform4f(this.locStrip.uColor, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1);
                gl.drawArrays(gl.TRIANGLES, 0, op.strip.length / 4);
              }
            }
          }
        }
      }

      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      target.save();
      target.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (items.length && uX1 > uX0 && uY1 > uY0) {
        const x0 = Math.max(0, Math.floor(uX0));
        const y0 = Math.max(0, Math.floor(uY0));
        const x1 = Math.min(devW, Math.ceil(uX1));
        const y1 = Math.min(devH, Math.ceil(uY1));
        if (x1 > x0 && y1 > y0) {
          // 9 参 1:1 子矩形拷贝；源 y 补 (allocH - devH)——活动区锚定缓冲左下，图像 y 向下
          const yOff = allocH - devH;
          target.drawImage(
            this.canvas,
            x0, yOff + y0, x1 - x0, y1 - y0,
            x0 / dpr, y0 / dpr, (x1 - x0) / dpr, (y1 - y0) / dpr,
          );
        }
      }
      target.restore();
      // 运行计数/耗时：外部可验证 GPU 通道确实在跑、缩放烘焙耗时量级
      if (typeof window !== 'undefined') {
        const g = window as unknown as { __gpuRan?: number; __gpuMs?: number; __gpuBlurMs?: number };
        g.__gpuRan = (g.__gpuRan ?? 0) + 1;
        g.__gpuMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
        g.__gpuBlurMs = blurMs;
      }
      return true;
    } catch (e) {
      console.error('[gpuElements] 渲染失败，回退 Canvas2D：', e);
      if (typeof window !== 'undefined') {
        (window as unknown as Record<string, unknown>).__gpuErr = String(
          e instanceof Error ? e.stack || e.message : e,
        );
      }
      return false;
    }
  }

  /**
   * 条带渲到离屏并做可分离高斯 blur（纹理 blur 内阴影）。
   * k>1 时整链（条带/blur/读写区）按 1/k 分辨率执行，合成端线性上采样；
   * scissor 仍按「条带盒 + 2×blurReach」的 1/k 缩放版（调用方已设）。
   */
  private renderBlurredOutline(
    it: Item,
    halfWidth: number,
    sigmaDev: number,
    k: number,
    blurReach: number,
  ): void {
    const gl = this.gl;
    const pair = k === 1
      ? { a: this.rtA!, b: this.rtB! }
      : this.ensureLowRt(k);
    const vpX = this.vpX; // uVP 是归一化占比，k 缩放后不变
    const vpY = this.vpY;
    const rt = pair.a;
    const rt2 = pair.b;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
    gl.viewport(0, 0, Math.ceil(this.devW / k), Math.ceil(this.devH / k));
    gl.colorMask(true, true, true, true);
    gl.disable(gl.STENCIL_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const op of it.outs) {
      if (!op.strip || !op.strip.length) continue;
      this.uploadStrip(op.strip);
      for (const dx of it.copies) {
        // uDpr 除以 k：内容映射整体缩到 1/k 分辨率，NDC 不变
        this.setStripUniforms(dx, halfWidth, k);
        gl.uniform4f(this.locStrip.uColor, 1, 1, 1, 1);
        gl.drawArrays(gl.TRIANGLES, 0, op.strip.length / 4);
      }
    }

    // 可分离高斯：低清像素里 σ'=σ/k，spacing 同公式（k 的选择保证 σ/k ≥ 2.5 → spacing ≥ 1）
    const sigma = Math.max(0.5, sigmaDev / k);
    const spacing = Math.max(1, sigma / 2.5);
    const wts: number[] = [];
    let wsum = 0;
    for (let i = 0; i < 9; i++) {
      const x = (i - 4) * spacing;
      const wv = Math.exp(-(x * x) / (2 * sigma * sigma));
      wts.push(wv);
      wsum += wv;
    }
    for (let i = 0; i < 9; i++) wts[i] /= wsum;
    const blurPass = (
      src: Rt,
      dst: Rt,
      dirX: number,
      dirY: number,
    ): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.disable(gl.BLEND); // blur 是覆盖写，混合会让结果被旧底调制
      gl.useProgram(this.progBlur);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(this.locBlur.uTex, 0);
      gl.uniform2f(this.locBlur.uVP, vpX, vpY);
      gl.uniform2f(this.locBlur.uDir, (dirX * spacing) / src.w, (dirY * spacing) / src.h);
      gl.uniform1fv(this.locBlur.uW, new Float32Array(wts));
      this.bindFsTriangle();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    blurPass(rt, rt2, 1, 0);
    blurPass(rt2, rt, 0, 1);
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.devW, this.devH);
  }

  private setColorUniforms(dx: number): void {
    const gl = this.gl;
    gl.useProgram(this.progColor);
    gl.uniform2f(this.locColor.uCam, this.tCam[0], this.tCam[1]);
    gl.uniform1f(this.locColor.uScale, this.tScale);
    gl.uniform1f(this.locColor.uDpr, this.tDpr);
    gl.uniform2f(this.locColor.uHalf, this.tHalf[0], this.tHalf[1]);
    gl.uniform1f(this.locColor.uDx, dx);
  }

  private setStripUniforms(dx: number, halfW: number, dprDiv = 1): void {
    const gl = this.gl;
    gl.useProgram(this.progStrip);
    gl.uniform2f(this.locStrip.uCam, this.tCam[0], this.tCam[1]);
    gl.uniform1f(this.locStrip.uScale, this.tScale);
    gl.uniform1f(this.locStrip.uDpr, this.tDpr / dprDiv);
    gl.uniform2f(this.locStrip.uHalf, this.tHalf[0], this.tHalf[1]);
    gl.uniform1f(this.locStrip.uDx, dx);
    gl.uniform1f(this.locStrip.uHalfW, halfW);
  }

  private bindFsTriangle(): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.fsVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.disableVertexAttribArray(1);
  }

  /** 上传/绑定缓存 VBO（数据数组不变则零重传）；stride=8 纯位置 */
  private uploadVerts(data: Float32Array): void {
    const gl = this.gl;
    const buf = this.bufferFor(data);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.disableVertexAttribArray(1);
  }

  /** 瞬态几何（矩形罩色等）：走共享动态 VBO，不进缓存 */
  private uploadTransient(data: Float32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.disableVertexAttribArray(1);
  }

  /** 条带 VBO：[baseX, baseY, dirX, dirY] stride=16 */
  private uploadStrip(data: Float32Array): void {
    const gl = this.gl;
    const buf = this.bufferFor(data);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  }

  private bufferFor(data: Float32Array): WebGLBuffer {
    const gl = this.gl;
    const hit = this.vboCache.get(data);
    if (hit) return hit;
    const buf = gl.createBuffer();
    if (!buf) throw new Error('createBuffer');
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    this.vboCache.set(data, buf);
    return buf;
  }

  private makeRt(w: number, h: number): Rt {
    const gl = this.gl;
    const tex = gl.createTexture();
    const fb = gl.createFramebuffer();
    if (!tex || !fb) throw new Error('createTexture/Framebuffer');
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, tex, w, h };
  }

  private ensureRt(cur: Rt | null, w: number, h: number, slot: 'a' | 'b'): Rt {
    if (cur && cur.w === w && cur.h === h) return cur;
    if (cur) {
      this.gl.deleteTexture(cur.tex);
      this.gl.deleteFramebuffer(cur.fb);
    }
    const rt = this.makeRt(w, h);
    if (slot === 'a') this.rtA = rt;
    else this.rtB = rt;
    return rt;
  }

  private ensureLowRt(k: number): { a: Rt; b: Rt } {
    const w = Math.max(1, Math.ceil(this.canvas.width / k));
    const h = Math.max(1, Math.ceil(this.canvas.height / k));
    let pair = this.rtLow.get(k);
    if (pair && pair.a.w === w && pair.a.h === h) return pair;
    if (pair) {
      this.gl.deleteTexture(pair.a.tex);
      this.gl.deleteFramebuffer(pair.a.fb);
      this.gl.deleteTexture(pair.b.tex);
      this.gl.deleteFramebuffer(pair.b.fb);
    }
    pair = { a: this.makeRt(w, h), b: this.makeRt(w, h) };
    this.rtLow.set(k, pair);
    return pair;
  }

  private disposeRts(): void {
    const gl = this.gl;
    for (const rt of [this.rtA, this.rtB]) {
      if (rt) {
        gl.deleteTexture(rt.tex);
        gl.deleteFramebuffer(rt.fb);
      }
    }
    this.rtA = null;
    this.rtB = null;
    for (const pair of this.rtLow.values()) {
      gl.deleteTexture(pair.a.tex);
      gl.deleteFramebuffer(pair.a.fb);
      gl.deleteTexture(pair.b.tex);
      gl.deleteFramebuffer(pair.b.fb);
    }
    this.rtLow.clear();
  }
}

function quad(minX: number, minY: number, maxX: number, maxY: number): Float32Array {
  return new Float32Array([
    minX, minY,
    maxX, minY,
    maxX, maxY,
    minX, minY,
    maxX, maxY,
    minX, maxY,
  ]);
}
