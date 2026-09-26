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
 * **热路径设计**（缩放 = 每 tick 全量重烘焙，GPU 不得比 Canvas 慢）：
 * - 几何全部按环对象缓存（WeakMap，与 ringPath2D 同款键）：Hermite 采样折线、三角扇
 *   （参考点取自环自身包围盒外侧）、条带（基点+方向布局，**宽度走 uHalfW uniform**）。
 *   缩放只改 uniform，零几何重算、零重采样；缓存数组按引用持有 VBO，跨帧零重传。
 * - GL 画布/离屏纹理按 256px 分桶增长：缩放 tick 不再逐帧重建 MSAA 绘图缓冲与 RT。
 *   活动区 [0,devW]×[0,devH] 锚定在缓冲**左下**（viewport 原语义）；全屏 pass 的
 *   vUv 按 uVP=(devW/allocW, devH/allocH) 收窄到活动区，drawImage 源 y 补 (allocH-devH)
 *   （GL 缓冲 y 向上、图像 y 向下的固定换算）。
 * - 阴影 清屏/条带/blur/合成 全部 scissor 到「条带包围盒 + blur 半径」，不做全屏 9 抽头；
 *   烘焙窗口外的件整体跳过；合成 drawImage 只贴画过内容的联合包围盒。
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

const BUCKET = 256;
function bucketSize(v: number): number {
  return Math.ceil(v / BUCKET) * BUCKET;
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
  private rtA: { fb: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private rtB: { fb: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private rtW = 0;
  private rtH = 0;
  /** 缓冲按数据数组缓存：几何数组不变则跨帧零重传 */
  private vboCache = new WeakMap<Float32Array, WebGLBuffer>();
  /** 当前帧变换（setStripUniforms 用） */
  private tCam: readonly [number, number] = [0, 0];
  private tScale = 1;
  private tDpr = 1;
  private tHalf: readonly [number, number] = [0, 0];

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
      // 分桶分配：缩放 tick 的小尺寸变化不重建 MSAA 绘图缓冲 / RT
      const allocW = bucketSize(devW);
      const allocH = bucketSize(devH);
      if (this.canvas.width !== allocW || this.canvas.height !== allocH) {
        this.canvas.width = allocW;
        this.canvas.height = allocH;
      }
      this.ensureRts(allocW, allocH);
      const vpX = devW / allocW;
      const vpY = devH / allocH;
      // 活动区锚定缓冲左下（viewport 原语义）：GL 缓冲 y 向上、图像 y 向下
      gl.viewport(0, 0, devW, devH);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.SCISSOR_TEST);
      gl.enable(gl.BLEND);
      // 预乘约定：着色器输出直通色，混合 SRC_ALPHA 时预乘 → 缓冲 = 预乘（与 premultipliedAlpha:true 一致）
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

      this.tCam = [env.cam.x, env.cam.y];
      this.tScale = env.cam.scale;
      this.tDpr = dpr;
      this.tHalf = [env.w / 2, env.h / 2];
      const scale = env.cam.scale;
      // 内容坐标 → 设备像素（与 VERT 同一映射；y 向下为正）
      const devX = (x: number): number => (x - env.cam.x) * scale * dpr + (env.w / 2) * dpr;
      const devY = (y: number): number => (env.cam.y - y) * scale * dpr + (env.h / 2) * dpr;

      /** 设备像素矩形（向下 y）→ GL scissor（活动区左下锚定：翻转基准 = devH） */
      const scissorRect = (x0: number, y0: number, x1: number, y1: number): boolean => {
        const gx0 = Math.max(0, Math.floor(x0));
        const gy0 = Math.max(0, Math.floor(y0));
        const gx1 = Math.min(devW, Math.ceil(x1));
        const gy1 = Math.min(devH, Math.ceil(y1));
        if (gx1 <= gx0 || gy1 <= gy0) return false;
        gl.enable(gl.SCISSOR_TEST);
        gl.scissor(gx0, devH - gy1, gx1 - gx0, gy1 - gy0);
        return true;
      };

      // 合成只贴画过内容的联合包围盒（烘焙画布可能数千 px，逐帧全幅 drawImage 拖死合成）
      let unionX0 = Infinity, unionY0 = Infinity, unionX1 = -Infinity, unionY1 = -Infinity;
      const markUnion = (x0: number, y0: number, x1: number, y1: number): void => {
        if (x0 < unionX0) unionX0 = x0;
        if (y0 < unionY0) unionY0 = y0;
        if (x1 > unionX1) unionX1 = x1;
        if (y1 > unionY1) unionY1 = y1;
      };

      for (const s of specs) {
        const fillRgb = s.fill ? parseColor(s.fill.color) : null;
        const frame = s.fullFrameFill;
        if (frame) {
          const rgb = parseColor(frame.color);
          if (!rgb) continue;
          const alpha = Math.max(0, Math.min(1, frame.alpha));
          const x0 = devX(frame.minX), x1 = devX(frame.maxX);
          const y0 = devY(frame.maxY), y1 = devY(frame.minY);
          if (!scissorRect(x0, y0, x1, y1)) continue;
          gl.disable(gl.STENCIL_TEST);
          gl.colorMask(true, true, true, true);
          this.setColorUniforms(0);
          gl.uniform4f(this.locColor.uColor, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, alpha);
          this.uploadTransient(quad(frame.minX, frame.minY, frame.maxX, frame.maxY));
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          markUnion(x0, y0, x1, y1);
          continue;
        }
        if (!s.rings.length) continue;

        // 环几何（缓存；fill 含跨界尾巴，outline 不含 → 描边/阴影是开环时严禁闭合）
        const fills: RingGeo[] = [];
        const outs: RingGeo[] = [];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const r of s.rings) {
          const fp = ringGeo(r, s.smooth, 'fill');
          if (fp && fp.fan) fills.push(fp);
          const op = ringGeo(r, s.smooth, 'outline');
          if (op && op.strip) outs.push(op);
        }
        for (const fp of fills) {
          for (let i = 0; i < fp.fan!.length; i += 6) {
            // 扇形 = (ref, p_i, p_j)；包围盒只需环点（ref 在其外侧不影响外接）
            for (let k = 2; k < 6; k += 2) {
              const x = fp.fan![i + k];
              const y = fp.fan![i + k + 1];
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        for (const op of outs) {
          for (let i = 0; i < op.strip!.length; i += 4) {
            const x = op.strip![i];
            const y = op.strip![i + 1];
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
        if (minX === Infinity) continue;
        const copies = s.copies.length ? s.copies : [0];
        let copyMinX = Infinity, copyMaxX = -Infinity;
        for (const dx of copies) {
          if (minX + dx < copyMinX) copyMinX = minX + dx;
          if (maxX + dx > copyMaxX) copyMaxX = maxX + dx;
        }

        const bd = s.border && s.border.width > 0 ? s.border : null;
        const sh = s.shadow && s.shadow.width > 0 && s.shadow.alpha > 0 ? s.shadow : null;
        const halfUser = Math.max(bd ? bd.width / 2 : 0, sh ? sh.width : 0);
        const halfDev = halfUser * scale * dpr;
        const blurPx = sh ? (sh.width * scale) / 2 : 0;
        const sigmaDev = blurPx * dpr;
        // blur 抽头可达 4×spacing（spacing = max(1, σ/2.5)）
        const blurReach = Math.ceil(4 * Math.max(1, sigmaDev / 2.5)) + 2;
        const padDev = halfDev + 2;
        const bx0 = devX(copyMinX) - padDev, bx1 = devX(copyMaxX) + padDev;
        const by0 = devY(maxY) - padDev, by1 = devY(minY) + padDev;

        // 不可见件整体跳过（烘焙窗口外无像素贡献）
        if (bx1 < 0 || bx0 > devW || by1 < 0 || by0 > devH) continue;
        markUnion(bx0, by0, bx1, by1);

        // 1) stencil 奇偶（填充/阴影共用）——scissor 到条带盒
        if (!scissorRect(bx0, by0, bx1, by1)) continue;
        gl.enable(gl.STENCIL_TEST);
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 1, 0x01);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        for (const fp of fills) {
          this.uploadVerts(fp.fan!);
          for (const dx of copies) {
            this.setColorUniforms(dx);
            gl.drawArrays(gl.TRIANGLES, 0, fp.fan!.length / 2);
          }
        }

        // 2) 填充罩色（单次全覆盖，副本重叠不叠色）
        gl.colorMask(true, true, true, true);
        gl.stencilFunc(gl.NOTEQUAL, 0, 0x01);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        if (fillRgb && s.fill) {
          const alpha = Math.max(0, Math.min(1, s.fill.alpha));
          this.setColorUniforms(0);
          gl.uniform4f(this.locColor.uColor, fillRgb[0] / 255, fillRgb[1] / 255, fillRgb[2] / 255, alpha);
          this.uploadTransient(quad(copyMinX, minY, copyMaxX, maxY));
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        // 3) 内阴影：描边(2×宽)→离屏 blur→**按填充 stencil 合成**（= Canvas clip(fill)）
        if (sh && outs.length) {
          // clear/条带/两级 blur 全部 scissor 到「条带盒 + 2×blurReach」：
          // pass1 写出 bbox±blurReach（读条带区），pass2 写出 bbox（读 pass1 区），
          // 合成只读 bbox——级别外的垃圾像素永远不被读，无需精确分级。
          const clearOk = scissorRect(
            bx0 - 2 * blurReach, by0 - 2 * blurReach,
            bx1 + 2 * blurReach, by1 + 2 * blurReach,
          );
          if (clearOk) {
            this.renderBlurredOutline(outs, copies, sh.width, sigmaDev, vpX, vpY);
            const shRgb = parseColor(sh.color) ?? [0, 0, 0];
            // 合成裁到条带盒，并重新挂上填充 stencil（内阴影不得溢出元素外缘）
            scissorRect(bx0, by0, bx1, by1);
            gl.enable(gl.STENCIL_TEST);
            gl.stencilFunc(gl.NOTEQUAL, 0, 0x01);
            gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
            gl.useProgram(this.progTex);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.rtA!.tex);
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

        // 4) 描边（圆角端头盖住连接处）
        gl.disable(gl.STENCIL_TEST);
        if (bd) {
          const rgb = parseColor(bd.color);
          if (rgb && bd.color !== 'transparent') {
            scissorRect(bx0, by0, bx1, by1);
            for (const op of outs) {
              if (!op.strip || !op.strip.length) continue;
              this.uploadStrip(op.strip);
              for (const dx of copies) {
                this.setStripUniforms(dx, bd.width / 2);
                gl.uniform4f(this.locStrip.uColor, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1);
                gl.drawArrays(gl.TRIANGLES, 0, op.strip.length / 4);
              }
            }
          }
        }
        gl.disable(gl.SCISSOR_TEST);
        gl.clear(gl.STENCIL_BUFFER_BIT);
      }

      gl.disable(gl.SCISSOR_TEST);
      target.save();
      target.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (unionX0 < unionX1 && unionY0 < unionY1) {
        const x0 = Math.max(0, Math.floor(unionX0));
        const y0 = Math.max(0, Math.floor(unionY0));
        const x1 = Math.min(devW, Math.ceil(unionX1));
        const y1 = Math.min(devH, Math.ceil(unionY1));
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
        const g = window as unknown as { __gpuRan?: number; __gpuMs?: number };
        g.__gpuRan = (g.__gpuRan ?? 0) + 1;
        g.__gpuMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
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
   * 所有 pass scissor 到条带盒 + 2×blurReach（调用方已设）；viewport 恒为活动区。
   */
  private renderBlurredOutline(
    outs: RingGeo[],
    copies: number[],
    halfWidth: number,
    sigmaDev: number,
    vpX: number,
    vpY: number,
  ): void {
    const gl = this.gl;
    const rt = this.rtA!;
    const rt2 = this.rtB!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.STENCIL_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const op of outs) {
      if (!op.strip || !op.strip.length) continue;
      this.uploadStrip(op.strip);
      for (const dx of copies) {
        this.setStripUniforms(dx, halfWidth);
        gl.uniform4f(this.locStrip.uColor, 1, 1, 1, 1);
        gl.drawArrays(gl.TRIANGLES, 0, op.strip.length / 4);
      }
    }

    // 可分离高斯：σ 大时按 σ 放大抽样间距（9 抽头覆盖 ±(4/2.5)σ ≈ 3.2σ）
    const sigma = Math.max(0.5, sigmaDev);
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
      src: { tex: WebGLTexture },
      dst: { fb: WebGLFramebuffer },
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
      gl.uniform2f(this.locBlur.uDir, (dirX * spacing) / this.rtW, (dirY * spacing) / this.rtH);
      gl.uniform1fv(this.locBlur.uW, new Float32Array(wts));
      this.bindFsTriangle();
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    blurPass(rt, rt2, 1, 0);
    blurPass(rt2, rt, 0, 1);
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

  private setStripUniforms(dx: number, halfW: number): void {
    const gl = this.gl;
    gl.useProgram(this.progStrip);
    gl.uniform2f(this.locStrip.uCam, this.tCam[0], this.tCam[1]);
    gl.uniform1f(this.locStrip.uScale, this.tScale);
    gl.uniform1f(this.locStrip.uDpr, this.tDpr);
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

  private ensureRts(w: number, h: number): void {
    if (this.rtA && this.rtW === w && this.rtH === h) return;
    const gl = this.gl;
    const make = (): { fb: WebGLFramebuffer; tex: WebGLTexture } => {
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
      return { fb, tex };
    };
    if (this.rtA) {
      gl.deleteTexture(this.rtA.tex);
      gl.deleteFramebuffer(this.rtA.fb);
    }
    if (this.rtB) {
      gl.deleteTexture(this.rtB.tex);
      gl.deleteFramebuffer(this.rtB.fb);
    }
    this.rtA = make();
    this.rtB = make();
    this.rtW = w;
    this.rtH = h;
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
