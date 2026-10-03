/**
 * 数值容差集中（还债步骤 7 转包①，2026-10-01）：评审「三套量化精度并存」的收口——
 * 同语义字面量单源命名；**迁移一律原值**（不改任何数值，行为零变化）。
 * 历史分歧 WRAP_EPS(1e-3) vs PROJ_WRAP_EPS(1e-2) 已由用户拍板
 * **统一为千分之一**（2026-10-04「精度统一千分之一」）——环键与投影
 * 顶点/180 钳制自此同格（缝两侧此前一个在1e-3吸附、一个在1e-2吸附）。
 * 未纳入：一次性孤值（1e-8/1e-10/1e-15）与整数比较、GLSL 内字面量
 * （DEDUP_EPS/GEOM_EPS 属几何判等族，与坐标量化异角色，维持原值）。
 */

/** lon/lat 键量化：千分之一度（lonlatKey / lonlatNumKey 共用——键域单一真相） */
export const KEY_QUANT = 1000;

/** ±180 / 窗口边界钳制裕度（与 KEY_QUANT 同族：量化前先把边界吸附到 180） */
export const WRAP_EPS = 1e-3;

/** 投影缓存 180 钳制裕度——已统一 = WRAP_EPS 同值千分之一（2026-10-04 拍板） */
export const PROJ_WRAP_EPS = 1e-3;

/** 几何判等 / 共线 / 平面距 / 重复点 / 近零保护（球面构造与三角剖分的零测度判定与分母护栏） */
export const GEOM_EPS = 1e-12;

/** 浮点近零判定（迭代收敛、视锥剔除、面积比值分母下限） */
export const EPS_FP = 1e-9;

/** 屏幕除法下限：Math.max(cam.scale, SCALE_FLOOR)——防除零不参与几何 */
export const SCALE_FLOOR = 1e-6;

/** 比值钳制下限（高程图分段归一等） */
export const MIN_RATIO = 1e-6;

/** Hermite 段长下限（切线权重的零长保护） */
export const MIN_SEG = 1e-6;

/** 点列重复点判定（球面构造去重） */
export const DEDUP_EPS = 1e-6;

/** 球面半径/胞尺寸下限 */
export const SPHERE_MIN = 1e-4;
