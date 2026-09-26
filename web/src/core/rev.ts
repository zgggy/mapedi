/**
 * 数据修订号：O(1) 失效，禁止 O(n) 扫 cell 做指纹。
 * - geom：cell.polygon / sharedEdges / neighbors
 * - height：cell.height / 大陆拓扑
 * - regions：region.cells / 归属 / 颜色
 */
let geom = 1;
let height = 1;
let regions = 1;

export function bumpGeomRev(): void {
  geom++;
}
export function bumpHeightRev(): void {
  height++;
}
export function bumpRegionsRev(): void {
  regions++;
}
export function bumpAllRev(): void {
  geom++;
  height++;
  regions++;
}
export function dataRev(): string {
  return `${geom}:${height}:${regions}`;
}
/** 纯几何域（cell.polygon / sharedEdges / neighbors）——几何缓存只订阅它 */
export function geomRev(): number {
  return geom;
}
export function resetDataRev(): void {
  geom = 1;
  height = 1;
  regions = 1;
}
