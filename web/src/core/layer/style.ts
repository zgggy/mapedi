/**
 * 元素样式：仅三通道（边界 / 内阴影 / 填充），全是参数。
 * 地块层默认关 shadow/fill——是配置，不是硬编码分支。
 */
export interface BorderStyle {
  enabled: boolean;
  width: number;
  color: string;
  /** 边界平滑（高度层 = 高度区域边界平滑） */
  smooth: number;
}

export interface ShadowStyle {
  enabled: boolean;
  width: number;
  alpha: number;
  color: string;
}

export interface FillStyle {
  enabled: boolean;
  alpha: number;
  color: string;
}

export interface ElementStyle {
  border: BorderStyle;
  shadow: ShadowStyle;
  fill: FillStyle;
}

export type ElementStylePatch = {
  border?: Partial<BorderStyle>;
  shadow?: Partial<ShadowStyle>;
  fill?: Partial<FillStyle>;
};

export function defaultBorderStyle(): BorderStyle {
  return { enabled: true, width: 1.6, color: '#ffffff', smooth: 1 };
}

export function defaultShadowStyle(): ShadowStyle {
  return { enabled: true, width: 18.5, alpha: 0.45, color: '#ffffff' };
}

export function defaultFillStyle(): FillStyle {
  return { enabled: true, alpha: 0.85, color: '#888888' };
}

export function defaultElementStyle(): ElementStyle {
  return {
    border: defaultBorderStyle(),
    shadow: defaultShadowStyle(),
    fill: defaultFillStyle(),
  };
}

export function cloneElementStyle(s: ElementStyle): ElementStyle {
  return {
    border: { ...s.border },
    shadow: { ...s.shadow },
    fill: { ...s.fill },
  };
}

export function patchElementStyle(base: ElementStyle, patch: ElementStylePatch): ElementStyle {
  return {
    border: { ...base.border, ...(patch.border ?? {}) },
    shadow: { ...base.shadow, ...(patch.shadow ?? {}) },
    fill: { ...base.fill, ...(patch.fill ?? {}) },
  };
}

/** 钳制滑杆范围 */
export function clampElementStyle(s: ElementStyle): ElementStyle {
  const n = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  return {
    border: {
      ...s.border,
      width: n(s.border.width, 0, 12),
      smooth: n(s.border.smooth, 0, 1),
    },
    shadow: {
      ...s.shadow,
      width: n(s.shadow.width, 0, 48),
      alpha: n(s.shadow.alpha, 0, 1),
    },
    fill: {
      ...s.fill,
      alpha: n(s.fill.alpha, 0, 1),
    },
  };
}

/**
 * 旧扁平 LayerStyle → ElementStyle（序列化迁移）。
 * coastBorder 退休为海陆层 border；cell* 退休为地块 border / 高度 fill。
 */
export function migrateFlatStyle(raw: Record<string, unknown>): ElementStyle {
  const s = defaultElementStyle();
  const num = (v: unknown, d: number) => (typeof v === 'number' ? v : d);
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);

  if ('elementBorder' in raw || 'borderWidth' in raw || 'innerShadowWidth' in raw || 'fillEnabled' in raw) {
    s.border.enabled = bool(raw.elementBorder, s.border.enabled);
    s.border.width = num(raw.elementBorderWidth ?? raw.borderWidth, s.border.width);
    s.border.color = str(raw.elementBorderColor, s.border.color);
    s.border.smooth = num(raw.elementSmooth ?? raw.borderSmooth, s.border.smooth);
    s.shadow.width = num(raw.innerShadowWidth, s.shadow.width);
    s.shadow.alpha = num(raw.innerShadowAlpha, s.shadow.alpha);
    s.shadow.color = str(raw.innerShadowColor, s.shadow.color);
    s.shadow.enabled = s.shadow.width > 0 && s.shadow.alpha > 0;
    s.fill.enabled = bool(raw.fillEnabled, s.fill.enabled);
    s.fill.alpha = num(raw.fillAlpha, s.fill.alpha);
    s.fill.color = str(raw.fillColor, s.fill.color);
  }
  if ('cellBorderWidth' in raw && !('elementBorderWidth' in raw)) {
    s.border.width = num(raw.cellBorderWidth, s.border.width);
  }
  return s;
}

/** 已是嵌套 ElementStyle？ */
export function isElementStyle(v: unknown): v is ElementStyle {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return !!(o.border && o.shadow && o.fill && typeof o.border === 'object');
}

export function normalizeStyle(raw: unknown): ElementStyle {
  if (isElementStyle(raw)) return clampElementStyle(cloneElementStyle(raw));
  if (raw && typeof raw === 'object') return migrateFlatStyle(raw as Record<string, unknown>);
  return defaultElementStyle();
}

/** 基本色提亮，作默认内阴影/专属色 */
export function defaultExclusiveColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return 'rgba(255,255,255,0.28)';
  const v = parseInt(m[1], 16);
  const r = Math.min(255, Math.floor(((v >> 16) & 255) * 1.35) + 30);
  const g = Math.min(255, Math.floor(((v >> 8) & 255) * 1.35) + 30);
  const b = Math.min(255, Math.floor((v & 255) * 1.35) + 30);
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}
