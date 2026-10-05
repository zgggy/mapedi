import type { CellId, World } from './types';
import { coreCellOf } from './regionCenter';
import { isLand } from './types';
import { roadComponentCount } from './draw/roads';

export type IssueKind =
  | 'orphan_province'
  | 'center_missing'
  | 'center_outside'
  | 'disconnected_road'
  | 'empty_region'
  | 'zero_weight'
  | 'isolated_land';

export interface ValidateIssue {
  kind: IssueKind;
  severity: 'warn' | 'error';
  message: string;
  regionId?: string;
  cellId?: CellId;
}

export function validateWorld(world: World): ValidateIssue[] {
  const issues: ValidateIssue[] = [];
  const layerById = new Map(world.layers.map((l) => [l.id, l]));

  for (const r of world.regions) {
    const layer = layerById.get(r.layerId);

    if (r.cells.length === 0) {
      issues.push({
        kind: 'empty_region',
        severity: 'warn',
        message: `「${r.name}」没有地块`,
        regionId: r.id,
      });
    }

    if (layer?.requireCenter && r.cells.length > 0) {
      const core = coreCellOf(world, r);
      if (core === undefined) {
        issues.push({
          kind: 'center_missing',
          severity: 'warn',
          message: `「${r.name}」缺少${layer.centerLabel ?? '中心'}`,
          regionId: r.id,
        });
      } else if (r.coreRegionId && (world.regions.find((x) => x.id === r.coreRegionId)?.parentId ?? null) !== r.id) {
        // 核心第二形态（选项1）：指向的必须是**本元素的子元素**（悬空/跨层 → 视同缺核心）
        issues.push({
          kind: 'center_missing',
          severity: 'warn',
          message: `「${r.name}」的核心子元素无效`,
          regionId: r.id,
        });
      } else if (!r.coreRegionId && !r.cells.includes(core)) {
        issues.push({
          kind: 'center_outside',
          severity: 'error',
          message: `「${r.name}」中心不在其地块内`,
          regionId: r.id,
          cellId: r.centerCellId,
        });
      }
    }

    if (layer?.requireAdjacency && r.cells.length >= 2) {
      const comps = roadComponentCount(world, r);
      if (comps > 1) {
        issues.push({
          kind: 'disconnected_road',
          severity: 'error',
          message: `「${r.name}」不连通（${comps} 段）`,
          regionId: r.id,
        });
      }
    }

    if (r.layerId === 'province') {
      const parent = r.parentId
        ? world.regions.find((x) => x.id === r.parentId)
        : undefined;
      if (!r.parentId) {
        issues.push({
          kind: 'orphan_province',
          severity: 'warn',
          message: `行省「${r.name}」未挂到国家`,
          regionId: r.id,
        });
      } else if (!parent) {
        issues.push({
          kind: 'orphan_province',
          severity: 'error',
          message: `行省「${r.name}」父国家不存在`,
          regionId: r.id,
        });
      } else {
        const set = new Set(parent.cells);
        const outside = r.cells.filter((c) => !set.has(c));
        if (outside.length) {
          issues.push({
            kind: 'center_outside',
            severity: 'warn',
            message: `行省「${r.name}」有 ${outside.length} 地块越出国家`,
            regionId: r.id,
            cellId: outside[0],
          });
        }
      }
    }

    if (r.weights) {
      for (const [cid, w] of r.weights) {
        if (w <= 0 && r.cells.includes(cid)) {
          issues.push({
            kind: 'zero_weight',
            severity: 'warn',
            message: `「${r.name}」在 #${cid} 权重为 0 仍占用`,
            regionId: r.id,
            cellId: cid,
          });
        }
      }
    }
  }

  // 孤立陆地（无任何国家）
  const countryCells = new Set<number>();
  for (const r of world.regions) {
    if (r.layerId === 'country') for (const c of r.cells) countryCells.add(c);
  }
  let isolated = 0;
  let sample: CellId | undefined;
  for (const c of world.cells) {
    if (isLand(c) && !countryCells.has(c.id)) {
      isolated++;
      if (sample === undefined) sample = c.id;
    }
  }
  if (isolated > 0 && countryCells.size > 0) {
    issues.push({
      kind: 'isolated_land',
      severity: 'warn',
      message: `${isolated} 个陆地地块未归属任何国家`,
      cellId: sample,
    });
  }

  return issues;
}

export function fixIssue(world: World, issue: ValidateIssue): boolean {
  switch (issue.kind) {
    case 'orphan_province': {
      if (!issue.regionId) return false;
      const prov = world.regions.find((r) => r.id === issue.regionId);
      if (!prov) return false;
      // 挂到包含最多 cell 的国家
      let best: string | undefined;
      let bestN = 0;
      const set = new Set(prov.cells);
      for (const c of world.regions) {
        if (c.layerId !== 'country') continue;
        const n = c.cells.filter((id) => set.has(id)).length;
        if (n > bestN) {
          bestN = n;
          best = c.id;
        }
      }
      if (best) {
        prov.parentId = best;
        return true;
      }
      return false;
    }
    case 'center_missing': {
      if (!issue.regionId) return false;
      const r = world.regions.find((x) => x.id === issue.regionId);
      if (!r || !r.cells.length) return false;
      r.centerCellId = r.cells[0];
      return true;
    }
    case 'zero_weight': {
      if (!issue.regionId || issue.cellId === undefined) return false;
      const r = world.regions.find((x) => x.id === issue.regionId);
      if (!r) return false;
      r.cells = r.cells.filter((c) => c !== issue.cellId);
      r.weights?.delete(issue.cellId);
      return true;
    }
    case 'empty_region': {
      if (!issue.regionId) return false;
      world.regions = world.regions.filter((r) => r.id !== issue.regionId);
      return true;
    }
    default:
      return false;
  }
}
