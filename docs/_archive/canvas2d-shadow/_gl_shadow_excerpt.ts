// ===== 归档自 render/gl/mapRenderer.ts：VERT_FADE（Φ 剖面渐隐条带顶点）
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



// ===== 归档自 render/gl/mapRenderer.ts：FRAG_FADE / FRAG_FILL_FIELD / FRAG_FADE_COMPOSITE / VERT_SCREEN（场图集合成）
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



// ===== 归档自 render/gl/mapRenderer.ts：mergeFade（渐隐条带合并）
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



// ===== 归档自 render/gl/mapRenderer.ts：ensureFadeRT（阴影场图集 RT）
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



// ===== 归档自 render/gl/mapRenderer.ts：fieldPass（阴影场相位 A）+ 旧 drawPiece 文档
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

