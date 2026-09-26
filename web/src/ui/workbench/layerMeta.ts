export interface LayerMeta {
  name: string;
  emoji: string;
  kind: string;
  /** cell 依赖：依赖地块 / 不依赖地块 / 自定义（图片、文字、控件） */
  category: 'cell' | 'free' | 'custom';
  pending?: boolean;
}

export const LAYER_META: Record<string, LayerMeta> = {
  // —— 依赖地块 ——
  cells: { name: '地块', emoji: '🔲', kind: 'custom', category: 'cell' },
  height: { name: '高度', emoji: '⛰️', kind: 'height', category: 'cell' },
  environment: { name: '环境', emoji: '🌍', kind: 'environment', category: 'cell' },
  vegetation: { name: '植物', emoji: '🌿', kind: 'vegetation', category: 'cell' },
  fauna: { name: '动物', emoji: '🐾', kind: 'fauna', category: 'cell' },
  race: { name: '种族', emoji: '🧬', kind: 'race', category: 'cell' },
  culture: { name: '文化', emoji: '🎭', kind: 'cultural', category: 'cell' },
  religion: { name: '宗教', emoji: '✨', kind: 'religious', category: 'cell' },
  country: { name: '国家', emoji: '👑', kind: 'political', category: 'cell' },
  province: { name: '行省', emoji: '🏛️', kind: 'political', category: 'cell' },
  military: { name: '军队', emoji: '⚔️', kind: 'military', category: 'cell', pending: true },
  // —— 不依赖地块 ——
  road: { name: '道路', emoji: '🛣️', kind: 'road', category: 'free' },
  route: { name: '航线', emoji: '⛵', kind: 'route', category: 'free' },
  river: { name: '河流', emoji: '🏞️', kind: 'river', category: 'free' },
  // —— 自定义 ——
  image: { name: '图片', emoji: '🖼️', kind: 'custom', category: 'custom', pending: true },
  text: { name: '文字', emoji: '📝', kind: 'custom', category: 'custom', pending: true },
  compass: { name: '指南针', emoji: '🧭', kind: 'custom', category: 'custom', pending: true },
  scalebar: { name: '比例尺', emoji: '📏', kind: 'custom', category: 'custom', pending: true },
};
