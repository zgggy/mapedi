export type PanelForm = 'panel' | 'icon' | 'hidden';
export type PanelCorner = 'tr' | 'tl' | 'bl';

export interface PanelState {
  id: string;
  title: string;
  emoji: string;
  form: PanelForm;
  x: number;
  y: number;
  w: number;
  h: number;
  /** 收起图标停靠角 */
  corner?: PanelCorner;
  stripOrder: number;
  pinned: boolean;
}

const STORAGE_KEY = 'mapedi.panel-layout.v3';

const ICON_W = 48;
const ICON_H = 40;
const GAP = 6;
const MARGIN = 12;

export function defaultPanels(): PanelState[] {
  return [
    {
      id: 'layers',
      title: '图层',
      emoji: '📚',
      form: 'panel',
      x: 16,
      y: 16,
      w: 260,
      h: 420,
      corner: 'tl',
      stripOrder: 1,
      pinned: true,
    },
    {
      id: 'workbench',
      title: '工作台',
      emoji: '🛠️',
      form: 'panel',
      x: 16,
      y: 460,
      w: 320,
      h: 360,
      corner: 'bl',
      stripOrder: 2,
      pinned: true,
    },
    {
      id: 'generate',
      title: '生成',
      emoji: '⚙️',
      form: 'panel',
      x: 300,
      y: 16,
      w: 380,
      h: 400,
      corner: 'tr',
      stripOrder: 0,
      pinned: true,
    },
    {
      id: 'view',
      title: '视图',
      emoji: '🗺️',
      form: 'panel',
      x: 700,
      y: 16,
      w: 300,
      h: 300,
      corner: 'tr',
      stripOrder: 3,
      pinned: true,
    },
    {
      id: 'status',
      title: '状态',
      emoji: '📊',
      form: 'panel',
      x: 320,
      y: 700,
      w: 480,
      h: 100,
      corner: 'bl',
      stripOrder: 0,
      pinned: true,
    },
    {
      id: 'project',
      title: '项目',
      emoji: '💾',
      form: 'icon',
      x: 0,
      y: 0,
      w: ICON_W,
      h: ICON_H,
      corner: 'tr',
      stripOrder: 4,
      pinned: false,
    },
  ];
}

export function loadPanels(): PanelState[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultPanels();
    const parsed = JSON.parse(raw) as PanelState[];
    if (!Array.isArray(parsed) || !parsed.length) return defaultPanels();
    return parsed.map((p) => ({
      ...p,
      form: (p.form as string) === 'strip' ? 'icon' : p.form,
      corner: p.corner ?? 'tr',
    }));
  } catch {
    return defaultPanels();
  }
}

export function savePanels(panels: PanelState[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(panels));
}

/** 根据面板中心选最近角：右上 / 左上 / 左下 */
export function nearestCorner(p: PanelState, vw: number, vh: number): PanelCorner {
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  const dTr = Math.hypot(vw - cx, cy);
  const dTl = Math.hypot(cx, cy);
  const dBl = Math.hypot(cx, vh - cy);
  if (dTr <= dTl && dTr <= dBl) return 'tr';
  if (dTl <= dBl) return 'tl';
  return 'bl';
}

/** 所有 icon 按角顺序排列：右上←左、左上↓、左下→右 */
export function reflowIcons(panels: PanelState[], vw: number, vh: number): PanelState[] {
  const next = panels.map((p) => ({ ...p }));
  const byCorner: Record<PanelCorner, PanelState[]> = { tr: [], tl: [], bl: [] };
  for (const p of next) {
    if (p.form !== 'icon') continue;
    byCorner[p.corner ?? 'tr'].push(p);
  }
  const sort = (a: PanelState, b: PanelState) =>
    a.stripOrder - b.stripOrder || a.id.localeCompare(b.id);

  byCorner.tr.sort(sort);
  byCorner.tl.sort(sort);
  byCorner.bl.sort(sort);

  byCorner.tr.forEach((p, i) => {
    p.w = ICON_W;
    p.h = ICON_H;
    p.x = vw - MARGIN - ICON_W - i * (ICON_W + GAP);
    p.y = MARGIN;
  });
  byCorner.tl.forEach((p, i) => {
    p.w = ICON_W;
    p.h = ICON_H;
    p.x = MARGIN;
    p.y = MARGIN + i * (ICON_H + GAP);
  });
  byCorner.bl.forEach((p, i) => {
    p.w = ICON_W;
    p.h = ICON_H;
    p.x = MARGIN + i * (ICON_W + GAP);
    p.y = vh - MARGIN - ICON_H;
  });
  return next;
}
