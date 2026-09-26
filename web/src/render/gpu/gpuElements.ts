/**
 * WebGL2 元素层渲染器（RegionMesh 后端第一版）。
 *
 * 与 Canvas2D 路径逐像素同义（RENDER_LOGIC 契约）：
 * - 填充：Hermite 环（`sampleMidRing` 同源曲线）→ 外部参考点三角扇 + stencil 奇偶
 *   = evenodd 语义（含世界副本间的重叠：奇偶天然不叠色，与 Canvas 单 Path2D 一致）
 * - 内阴影：环折线以 2×宽细长四边形渲到离屏纹理 → 高斯 blur → 按填充 stencil 合成
 *   = Canvas 的 clip(fill) + blur 描边
 * - 描边：折线细长四边形（端头外延盖住连接处，≈ round join/round cap）
 * - z 序：按传入顺序逐件绘制；填充在下、内阴影中、描边上（fill→shadow→stroke）
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
  drawImage(img: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
}

interface GlUniformLoc { [k: string]: WebGLUniformLocation | null }

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

const VERT_TEX = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
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

/** 折线 → 细长四边形（端头外延 halfWidth 盖住连接处 ≈ round cap/join） */
function quadStrip(pts: { x: number; y: number }[], halfWidth: number, closed: boolean): Float32Array {
  const n = pts.length;
  const segs = closed ? n : n - 1;
  if (segs < 1 || halfWidth <= 0) return new Float32Array(0);
  const out = new Float32Array(segs * 12);
  let o = 0;
  for (let i = 0; i < segs; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = uy * halfWidth;
    const ny = -ux * halfWidth;
    const ax = a.x - ux * halfWidth;
    const ay = a.y - uy * halfWidth;
    const bx = b.x + ux * halfWidth;
    const by = b.y + uy * halfWidth;
    out[o++] = ax - nx; out[o++] = ay - ny;
    out[o++] = ax + nx; out[o++] = ay + ny;
    out[o++] = bx + nx; out[o++] = by + ny;
    out[o++] = ax - nx; out[o++] = ay - ny;
    out[o++] = bx + nx; out[o++] = by + ny;
    out[o++] = bx - nx; out[o++] = by - ny;
  }
  return out;
}

/** 环折线（闭合去重尾点） */
function ringPoints(ring: DisplayRing, smooth: number, mode: 'fill' | 'outline'): { x: number; y: number }[] {
  const pts = sampleMidRing(ring, smooth, mode);
  if (pts.length > 1) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < 1e-12 && Math.abs(a.y - b.y) < 1e-12) pts.pop();
  }
  return pts;
}

export class GpuElementsRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private progColor: WebGLProgram;
  private progTex: WebGLProgram;
  private progBlur: WebGLProgram;
  private locColor: GlUniformLoc = {};
  private locTex: GlUniformLoc = {};
  private locBlur: GlUniformLoc = {};
  private vbo: WebGLBuffer;
  private fsVbo: WebGLBuffer;
  private rtA: { fb: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private rtB: { fb: WebGLFramebuffer; tex: WebGLTexture } | null = null;
  private rtW = 0;
  private rtH = 0;

  private constructor() {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      stencil: true,
      depth: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) throw new Error('webgl2 不可用');
    this.canvas = canvas;
    this.gl = gl;
    this.progColor = link(gl, VERT, FRAG_COLOR);
    this.progTex = link(gl, VERT_TEX, FRAG_TEX);
    this.progBlur = link(gl, VERT_TEX, FRAG_BLUR);
    for (const n of ['uCam', 'uScale', 'uDpr', 'uHalf', 'uDx', 'uColor']) {
      this.locColor[n] = gl.getUniformLocation(this.progColor, n);
    }
    for (const n of ['uTex', 'uColor']) {
      this.locTex[n] = gl.getUniformLocation(this.progTex, n);
    }
    for (const n of ['uTex', 'uDir', 'uW']) {
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
    try {
      const dpr = env.dpr || 1;
      const devW = Math.max(1, Math.round(env.w * dpr));
      const devH = Math.max(1, Math.round(env.h * dpr));
      if (this.canvas.width !== devW || this.canvas.height !== devH) {
        this.canvas.width = devW;
        this.canvas.height = devH;
      }
      this.ensureRts(devW, devH);
      gl.viewport(0, 0, devW, devH);
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.clearColor(0, 0, 0, 0);
      gl.clearStencil(0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);

      const uCam = [env.cam.x, env.cam.y] as const;
      const setTransformUniforms = (dx: number): void => {
        gl.useProgram(this.progColor);
        gl.uniform2f(this.locColor.uCam, uCam[0], uCam[1]);
        gl.uniform1f(this.locColor.uScale, env.cam.scale);
        gl.uniform1f(this.locColor.uDpr, dpr);
        gl.uniform2f(this.locColor.uHalf, env.w / 2, env.h / 2);
        gl.uniform1f(this.locColor.uDx, dx);
      };

      for (const s of specs) {
        const fillRgb = s.fill ? parseColor(s.fill.color) : null;
        const frame = s.fullFrameFill;
        if (frame) {
          const rgb = parseColor(frame.color);
          if (!rgb) continue;
          const alpha = Math.max(0, Math.min(1, frame.alpha));
          gl.useProgram(this.progColor);
          gl.disable(gl.STENCIL_TEST);
          gl.colorMask(true, true, true, true);
          gl.uniform4f(this.locColor.uColor, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, alpha);
          gl.uniform2f(this.locColor.uCam, uCam[0], uCam[1]);
          gl.uniform1f(this.locColor.uScale, env.cam.scale);
          gl.uniform1f(this.locColor.uDpr, dpr);
          gl.uniform2f(this.locColor.uHalf, env.w / 2, env.h / 2);
          gl.uniform1f(this.locColor.uDx, 0);
          this.uploadVerts(new Float32Array([
            frame.minX, frame.minY,
            frame.maxX, frame.minY,
            frame.maxX, frame.maxY,
            frame.minX, frame.minY,
            frame.maxX, frame.maxY,
            frame.minX, frame.maxY,
          ]));
          gl.drawArrays(gl.TRIANGLES, 0, 6);
          continue;
        }
        if (!s.rings.length) continue;

        // 环折线（fill 模式含闭合段；副本共用同一几何）
        const fills: { x: number; y: number }[][] = [];
        const outs: { x: number; y: number }[][] = [];
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const r of s.rings) {
          const fp = ringPoints(r, s.smooth, 'fill');
          if (fp.length >= 3) fills.push(fp);
          const op = ringPoints(r, s.smooth, 'outline');
          if (op.length >= 2) outs.push(op);
          for (const p of fp) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
        }
        if (minX === Infinity) continue;
        // 外部参考点（所有副本环之外）→ 扇形奇偶 = evenodd
        const span = Math.max(maxX - minX, maxY - minY, 1);
        const refX = minX - span - 10 - Math.abs(s.copies[0] ?? 0) - 2 * Math.PI;
        const refY = minY - span - 10;

        // 1) stencil 奇偶（填充/阴影共用）
        gl.enable(gl.STENCIL_TEST);
        gl.colorMask(false, false, false, false);
        gl.stencilFunc(gl.ALWAYS, 1, 0x01);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.INVERT);
        setTransformUniforms(0);
        for (const dx of s.copies) {
          gl.uniform1f(this.locColor.uDx, dx);
          for (const fp of fills) {
            const fan = fanFrom(refX, refY, fp);
            this.uploadVerts(fan);
            gl.drawArrays(gl.TRIANGLES, 0, fan.length / 2);
          }
        }

        // 2) 填充罩色（单次全覆盖，副本重叠不叠色）
        gl.colorMask(true, true, true, true);
        gl.stencilFunc(gl.NOTEQUAL, 0, 0x01);
        gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
        if (fillRgb && s.fill) {
          const alpha = Math.max(0, Math.min(1, s.fill.alpha));
          gl.uniform1f(this.locColor.uDx, 0);
          gl.uniform4f(this.locColor.uColor, fillRgb[0] / 255, fillRgb[1] / 255, fillRgb[2] / 255, alpha);
          this.uploadVerts(quad(minX - span, minY - span, maxX + span, maxY + span));
          gl.drawArrays(gl.TRIANGLES, 0, 6);
        }

        // 3) 内阴影：描边(2×宽)→离屏 blur→按填充 stencil 合成
        const sh = s.shadow;
        if (sh && sh.width > 0 && sh.alpha > 0) {
          const blurPx = (sh.width * env.cam.scale) / 2;
          const outline = this.buildStrip(outs, sh.width, s.copies);
          if (outline.length) {
            this.renderBlurredOutline(outline, blurPx * dpr, uCam, env, dpr);
            const shRgb = parseColor(sh.color) ?? [0, 0, 0];
            gl.useProgram(this.progTex);
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, this.rtA!.tex);
            gl.uniform1i(this.locTex.uTex, 0);
            gl.uniform4f(
              this.locTex.uColor,
              shRgb[0] / 255,
              shRgb[1] / 255,
              shRgb[2] / 255,
              Math.max(0, Math.min(1, sh.alpha)),
            );
            gl.bindBuffer(gl.ARRAY_BUFFER, this.fsVbo);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
          }
        }

        // 4) 描边（圆角端头盖住连接处）
        gl.disable(gl.STENCIL_TEST);
        const bd = s.border;
        if (bd && bd.width > 0) {
          const rgb = parseColor(bd.color);
          if (rgb && bd.color !== 'transparent') {
            gl.useProgram(this.progColor);
            setTransformUniforms(0);
            gl.uniform4f(this.locColor.uColor, rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1);
            const strip = this.buildStrip(outs, bd.width / 2, s.copies);
            this.uploadVerts(strip);
            gl.drawArrays(gl.TRIANGLES, 0, strip.length / 2);
          }
        }
        gl.clear(gl.STENCIL_BUFFER_BIT);
      }

      target.save();
      target.setTransform(dpr, 0, 0, dpr, 0, 0);
      target.drawImage(this.canvas, 0, 0, env.w, env.h);
      target.restore();
      // 运行计数：外部可验证 GPU 通道确实在跑（避免比对到 Canvas 兜底而不自知）
      if (typeof window !== 'undefined') {
        const g = window as unknown as { __gpuRan?: number };
        g.__gpuRan = (g.__gpuRan ?? 0) + 1;
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

  private buildStrip(
    outs: { x: number; y: number }[][],
    halfWidth: number,
    copies: number[],
  ): Float32Array {
    const parts: Float32Array[] = [];
    let total = 0;
    for (const dx of copies) {
      for (const op of outs) {
        const shifted = op.map((p) => ({ x: p.x + dx, y: p.y }));
        const q = quadStrip(shifted, halfWidth, true);
        if (q.length) {
          parts.push(q);
          total += q.length;
        }
      }
    }
    const out = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }

  /** 把描边条渲到离屏并做可分离高斯 blur（纹理 blur 内阴影） */
  private renderBlurredOutline(
    strip: Float32Array,
    sigmaDevice: number,
    uCam: readonly [number, number],
    env: { cam: { x: number; y: number; scale: number }; w: number; h: number },
    dpr: number,
  ): void {
    const gl = this.gl;
    const rt = this.rtA!;
    const rt2 = this.rtB!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, rt.fb);
    gl.viewport(0, 0, this.rtW, this.rtH);
    gl.colorMask(true, true, true, true);
    gl.disable(gl.STENCIL_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.progColor);
    gl.uniform2f(this.locColor.uCam, uCam[0], uCam[1]);
    gl.uniform1f(this.locColor.uScale, env.cam.scale);
    gl.uniform1f(this.locColor.uDpr, dpr);
    gl.uniform2f(this.locColor.uHalf, env.w / 2, env.h / 2);
    gl.uniform1f(this.locColor.uDx, 0);
    gl.uniform4f(this.locColor.uColor, 1, 1, 1, 1);
    this.uploadVerts(strip);
    gl.drawArrays(gl.TRIANGLES, 0, strip.length / 2);

    // 可分离高斯：σ 大时按 σ 放大抽样间距（9 抽头覆盖 ±(4/2.5)σ ≈ 3.2σ）
    const sigma = Math.max(0.5, sigmaDevice);
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
    const blurPass = (src: { tex: WebGLTexture }, dst: { fb: WebGLFramebuffer }, dirX: number, dirY: number): void => {
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fb);
      gl.viewport(0, 0, this.rtW, this.rtH);
      gl.disable(gl.BLEND); // blur 是覆盖写，混合会让结果被旧底调制
      gl.useProgram(this.progBlur);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.tex);
      gl.uniform1i(this.locBlur.uTex, 0);
      gl.uniform2f(this.locBlur.uDir, (dirX * spacing) / this.rtW, (dirY * spacing) / this.rtH);
      gl.uniform1fv(this.locBlur.uW, new Float32Array(wts));
      gl.bindBuffer(gl.ARRAY_BUFFER, this.fsVbo);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };
    blurPass(rt, rt2, 1, 0);
    blurPass(rt2, rt, 0, 1);
    gl.enable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.rtW, this.rtH);
  }

  private uploadVerts(data: Float32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
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
    this.rtA = make();
    this.rtB = make();
    this.rtW = w;
    this.rtH = h;
  }
}

/** 环 → 外部参考点三角扇（stencil INVERT 用；扇形奇偶 = evenodd） */
function fanFrom(
  refX: number,
  refY: number,
  pts: { x: number; y: number }[],
): Float32Array {
  const n = pts.length;
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
