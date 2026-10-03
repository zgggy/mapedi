/**
 * 统一生成器：所有图层共用，配置驱动。
 *
 * method:     diffusion / randomConnected / fromLayer
 * scope:      oceanOnly / landOnly / noCrossLandSea / unlimited / fromLayer
 * pattern:    partitionLand / partitionOcean / partitionAll / scattered / longStrip / cluster
 * coreSelector: centermost / nearBoundary / highElevation / lowElevation / random
 *
 * 产物是 Region（= LayerElement），含 adjacentElementIds / overlaps。
 */
import type { CellId, LayerId, Region, World } from '../types';
import { childLayerIdOf } from '../hierarchy/derive';
import { isLand as isLandCell } from '../types';
import type { GenConfig } from '../layer/genTypes';
import { layerAllowsOverlap } from '../layer';
import { createRng, hashSeed } from '../rng';
import { projectMercator } from '../project/mercator';
import { generateDemoContinents } from '../height';
import { rebuildLandSeaRegions, landSeaLayerRegions } from '../layer/landSea';
import { genStrategyOf } from '../layer/flags';
import { rebuildHeightIntervalElements } from '../layer/heightElements';
import { computeRelationships } from '../layer/relationships';
import { materializeParentCells } from '../displayCompose';

export { computeRelationships };

// ── 作用域 ──

function heightAt(world: World, id: CellId): number {
  return world.cells[id]?.height ?? 0;
}

function isLand(world: World, id: CellId): boolean {
  return isLandCell(world.cells[id] ?? { height: 0 });
}

/**
 * 单元源 = childLayer(L)（HIERARCHY D1 单源统一，包3）：原配置的源层字段
 * 退役——组织手势即语义声明，源层从层树派生。
 */
function scopeCandidates(
  world: World,
  scope: GenConfig['scope'],
  unitsLayerId?: LayerId,
): CellId[] {
  const out: CellId[] = [];
  switch (scope) {
    case 'oceanOnly':
      for (let i = 0; i < world.cells.length; i++) if (!isLand(world, i)) out.push(i);
      break;
    case 'landOnly':
      for (let i = 0; i < world.cells.length; i++) if (isLand(world, i)) out.push(i);
      break;
    case 'noCrossLandSea':
      for (let i = 0; i < world.cells.length; i++) out.push(i);
      break;
    case 'fromLayer': {
      const fromCells = new Set<CellId>();
      for (const r of world.regions) {
        if (r.layerId === unitsLayerId) for (const c of r.cells) fromCells.add(c);
      }
      for (const id of fromCells) out.push(id);
      break;
    }
    case 'unlimited':
    default:
      for (let i = 0; i < world.cells.length; i++) out.push(i);
      break;
  }
  return out;
}

function canExpand(
  world: World,
  scope: GenConfig['scope'],
  seedLand: boolean,
  to: CellId,
): boolean {
  switch (scope) {
    case 'oceanOnly':
      return !isLand(world, to);
    case 'landOnly':
      return isLand(world, to);
    case 'noCrossLandSea':
      return isLand(world, to) === seedLand;
    case 'fromLayer':
    case 'unlimited':
    default:
      return true;
  }
}

// ── 核心 cell 选择 ──

function selectCoreCell(
  world: World,
  cells: CellId[],
  selector: GenConfig['coreSelector'],
  rng: () => number,
): CellId {
  if (!cells.length) return 0;
  switch (selector) {
    case 'centermost': {
      const pts = cells.map((id) => projectMercator(world.cells[id].center));
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      let best = cells[0], bestD = Infinity;
      for (let i = 0; i < cells.length; i++) {
        const d = (pts[i].x - cx) ** 2 + (pts[i].y - cy) ** 2;
        if (d < bestD) { bestD = d; best = cells[i]; }
      }
      return best;
    }
    case 'highElevation': {
      let best = cells[0], bestH = -Infinity;
      for (const id of cells) {
        const h = heightAt(world, id);
        if (h > bestH) { bestH = h; best = id; }
      }
      return best;
    }
    case 'lowElevation': {
      let best = cells[0], bestH = Infinity;
      for (const id of cells) {
        const h = heightAt(world, id);
        if (h < bestH) { bestH = h; best = id; }
      }
      return best;
    }
    case 'nearBoundary': {
      const set = new Set(cells);
      const border: CellId[] = [];
      for (const id of cells) {
        if (world.cells[id].neighbors.some((n) => !set.has(n))) border.push(id);
      }
      if (border.length) return border[Math.floor(rng() * border.length)];
      const pts = cells.map((id) => projectMercator(world.cells[id].center));
      const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
      const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
      let best = cells[0], bestD = -1;
      for (let i = 0; i < cells.length; i++) {
        const d = (pts[i].x - cx) ** 2 + (pts[i].y - cy) ** 2;
        if (d > bestD) { bestD = d; best = cells[i]; }
      }
      return best;
    }
    case 'random':
    default:
      return cells[Math.floor(rng() * cells.length)];
  }
}

// ── 形状生成 ──

function floodFill(
  world: World,
  startId: CellId,
  canGo: (to: CellId) => boolean,
  maxCells: number,
  rng: () => number,
  expandProb: number,
): CellId[] {
  const used = new Set<CellId>();
  const comp: CellId[] = [];
  const stack = [startId];
  used.add(startId);
  while (stack.length && comp.length < maxCells) {
    const id = stack.pop()!;
    comp.push(id);
    for (const n of world.cells[id].neighbors) {
      if (!used.has(n) && canGo(n) && rng() < expandProb) {
        used.add(n);
        stack.push(n);
      }
    }
  }
  return comp;
}

function longStrip(
  world: World,
  startId: CellId,
  canGo: (to: CellId) => boolean,
  maxCells: number,
  rng: () => number,
): CellId[] {
  const comp: CellId[] = [startId];
  const used = new Set([startId]);
  let cur = startId;
  while (comp.length < maxCells) {
    const neighbors = world.cells[cur].neighbors.filter((n) => canGo(n) && !used.has(n));
    if (!neighbors.length) break;
    const next = neighbors[Math.floor(rng() * neighbors.length)];
    used.add(next);
    comp.push(next);
    cur = next;
  }
  return comp;
}

function multiSourcePartition(
  world: World,
  seeds: CellId[],
  canGo: (id: CellId) => boolean,
): CellId[][] {
  const n = world.cells.length;
  const owner = new Int32Array(n).fill(-1);
  const q: number[] = [];
  seeds.forEach((id, i) => {
    if (canGo(id)) {
      owner[id] = i;
      q.push(id);
    }
  });
  let head = 0;
  while (head < q.length) {
    const id = q[head++];
    const o = owner[id];
    for (const nb of world.cells[id].neighbors) {
      if (owner[nb] === -1 && canGo(nb)) {
        owner[nb] = o;
        q.push(nb);
      }
    }
  }
  const parts: CellId[][] = seeds.map(() => []);
  for (let i = 0; i < n; i++) {
    const o = owner[i];
    if (o >= 0 && o < parts.length) parts[o].push(i);
  }
  return parts;
}

function scatteredPieces(
  world: World,
  startId: CellId,
  canGo: (to: CellId) => boolean,
  maxCells: number,
  rng: () => number,
): CellId[] {
  const pieces = 2 + Math.floor(rng() * 3);
  const perPiece = Math.max(3, Math.floor(maxCells / pieces));
  const used = new Set<CellId>();
  const comp: CellId[] = [];
  const first = floodFill(world, startId, canGo, perPiece, rng, 0.35);
  for (const c of first) { used.add(c); comp.push(c); }
  for (let p = 1; p < pieces && comp.length < maxCells; p++) {
    let seed = -1;
    for (let a = 0; a < 40; a++) {
      const id = Math.floor(rng() * world.cells.length);
      if (canGo(id) && !used.has(id)) { seed = id; break; }
    }
    if (seed < 0) break;
    const piece = floodFill(world, seed, canGo, perPiece, rng, 0.35);
    for (const c of piece) {
      if (!used.has(c)) { used.add(c); comp.push(c); }
    }
  }
  return comp;
}

function radialCluster(
  world: World,
  startId: CellId,
  canGo: (to: CellId) => boolean,
  maxCells: number,
  rng: () => number,
  falloff: number,
): CellId[] {
  const seedPt = projectMercator(world.cells[startId].center);
  const R = Math.sqrt(maxCells) * 0.04 + 0.08;
  const canGoRadial = (to: CellId): boolean => {
    if (!canGo(to)) return false;
    const p = projectMercator(world.cells[to].center);
    const d = Math.hypot(p.x - seedPt.x, p.y - seedPt.y) / R;
    return rng() < Math.exp(-falloff * d * d) + 0.15;
  };
  return floodFill(world, startId, canGoRadial, maxCells, rng, 0.7);
}

function pickSeeds(pool: CellId[], count: number, rng: () => number): CellId[] {
  if (pool.length <= count) return [...pool];
  const step = pool.length / count;
  const seeds: CellId[] = [];
  for (let i = 0; i < count; i++) {
    const idx = Math.min(pool.length - 1, Math.floor(i * step + rng() * step * 0.8));
    seeds.push(pool[idx]);
  }
  return seeds;
}

// ── fromLayer：聚合源图层元素 ──

function generateFromLayer(world: World, layerId: LayerId, config: GenConfig): Region[] {
  // 单元源从层树派生（D1）：无子层 → 无聚合源，返回空（与旧行为一致）
  const fromId = childLayerIdOf(world, layerId) ?? undefined;
  const groupSize = Math.max(2, config.fromLayerCount ?? 3);
  const sources = world.regions.filter((r) => r.layerId === fromId);
  if (!sources.length) return [];

  const rng = createRng(hashSeed(config.seed, layerId.length * 53));
  const names = config.names ?? [];
  const colors = config.colors ?? [];

  const srcById = new Map(sources.map((r) => [r.id, r]));
  const srcAdj = new Map<string, Set<string>>();
  for (const s of sources) srcAdj.set(s.id, new Set());
  const cellToSrc = new Map<CellId, string>();
  for (const s of sources) {
    for (const c of s.cells) {
      if (!cellToSrc.has(c)) cellToSrc.set(c, s.id);
    }
  }
  for (const s of sources) {
    for (const c of s.cells) {
      for (const nb of world.cells[c].neighbors) {
        const oid = cellToSrc.get(nb);
        if (oid && oid !== s.id) {
          srcAdj.get(s.id)!.add(oid);
          srcAdj.get(oid)!.add(s.id);
        }
      }
    }
  }

  const used = new Set<string>();
  const grouped = new Set<string>();
  const out: Region[] = [];
  let ci = 0;

  for (const seedSrc of sources) {
    if (used.has(seedSrc.id)) continue;
    const group: Region[] = [seedSrc];
    used.add(seedSrc.id);
    const frontier = [...(srcAdj.get(seedSrc.id) ?? [])];
    while (group.length < groupSize && frontier.length) {
      let pick = -1;
      for (let i = 0; i < frontier.length; i++) {
        if (!used.has(frontier[i])) { pick = i; break; }
      }
      if (pick < 0) break;
      const nid = frontier.splice(pick, 1)[0];
      used.add(nid);
      const nr = srcById.get(nid);
      if (nr) {
        group.push(nr);
        for (const n of srcAdj.get(nid) ?? []) {
          if (!used.has(n)) frontier.push(n);
        }
      }
    }

    const cellSet = new Set<CellId>();
    for (const g of group) for (const c of g.cells) cellSet.add(c);
    const cells = [...cellSet];
    if (cells.length < 4) continue;

    const filtered = cells.filter((id) => {
      if (!config.allowOcean && config.scope === 'landOnly') return isLand(world, id);
      if (config.scope === 'landOnly') return isLand(world, id);
      if (config.scope === 'oceanOnly') return !isLand(world, id);
      return true;
    });
    if (filtered.length < 4) continue;

    const coreCellId = selectCoreCell(world, filtered, config.coreSelector, rng);
    const name = names.length ? names[ci % names.length] : `${layerId}-${ci}`;
    const color = colors.length ? colors[ci % colors.length] : '#888888';
    const el: Region = {
      id: `${layerId}-${ci}`,
      layerId,
      name,
      cells: filtered,
      coreCellId,
      centerCellId: coreCellId,
      color,
      attributes: { kind: layerId },
      adjacentElementIds: new Set(),
      overlaps: [],
    };
    out.push(el);

    for (const g of group) {
      g.parentId = el.id;
      grouped.add(g.id);
    }

    ci++;
    if (ci >= config.count) break;
  }

  computeRelationships(world, out);
  // 级联契约（fromLayer：country←province 不留孤儿省）：分组失败/超数的源
  // 挂到共享邻接边最多的新元素；本次已挂的不动，旧档残留 parentId 在此覆盖
  if (out.length) {
    for (const s of sources) {
      if (grouped.has(s.id)) continue;
      let best = out[0].id;
      let bestScore = -1;
      for (const el of out) {
        const elCells = new Set(el.cells);
        let score = 0;
        for (const c of s.cells) {
          for (const nb of world.cells[c].neighbors) {
            if (elCells.has(nb)) score++;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          best = el.id;
        }
      }
      s.parentId = best;
    }
  }
  world.regions = world.regions.concat(out);
  materializeParentCells(world);
  return out;
}

// ── 主入口 ──

export function unifiedGenerate(world: World, layerId: LayerId, config: GenConfig): Region[] {
  world.regions = world.regions.filter((r) => r.layerId !== layerId);

  // height 策略层：连续场 + 海陆派生 + 12 嵌套区间元素（等高线）
  if (genStrategyOf(world, layerId) === 'heightmap') {
    generateDemoContinents(world, config.seed, undefined, config.worldShape);
    rebuildLandSeaRegions(world);
    const els = rebuildHeightIntervalElements(world);
    // 海陆关系单独算；区间关系已在 rebuild 内用 count 记录
    computeRelationships(world, landSeaLayerRegions(world));
    return els;
  }

  if (config.method === 'fromLayer') {
    return generateFromLayer(world, layerId, config);
  }

  const rng = createRng(hashSeed(config.seed, layerId.length * 31 + 7));
  const allowOverlap = layerAllowsOverlap(world, layerId);
  const names = config.names ?? [];
  const colors = config.colors ?? [];

  const effScope: GenConfig['scope'] =
    config.allowOcean && config.scope === 'landOnly' ? 'unlimited' : config.scope;
  const isPartition = config.pattern === 'partitionLand'
    || config.pattern === 'partitionOcean'
    || config.pattern === 'partitionAll';

  let pool: CellId[];
  if (config.pattern === 'partitionLand' && !config.allowOcean) {
    pool = scopeCandidates(world, 'landOnly', childLayerIdOf(world, layerId) ?? undefined);
  } else if (config.pattern === 'partitionOcean') {
    pool = scopeCandidates(world, 'oceanOnly', childLayerIdOf(world, layerId) ?? undefined);
  } else if (config.pattern === 'partitionAll') {
    pool = scopeCandidates(
      world,
      config.scope === 'noCrossLandSea' ? 'unlimited' : config.scope,
      childLayerIdOf(world, layerId) ?? undefined,
    );
  } else {
    pool = scopeCandidates(world, effScope, childLayerIdOf(world, layerId) ?? undefined);
  }
  if (!pool.length) return [];
  const poolSet = new Set(pool);

  const count = Math.max(1, config.count);

  if (isPartition) {
    const seeds: CellId[] = [];
    const step = Math.max(1, Math.floor(pool.length / count));
    for (let i = 0; i < count; i++) {
      const idx = Math.min(pool.length - 1, i * step + Math.floor(rng() * step * 0.8));
      seeds.push(pool[idx]);
    }
    const canGo = (id: CellId): boolean => {
      if (config.pattern === 'partitionLand') return isLand(world, id) || !!config.allowOcean;
      if (config.pattern === 'partitionOcean') return !isLand(world, id);
      return true;
    };
    let parts: CellId[][];
    if (config.pattern === 'partitionAll' && config.scope === 'noCrossLandSea') {
      const landPool = pool.filter((id) => isLand(world, id));
      const oceanPool = pool.filter((id) => !isLand(world, id));
      const landCount = Math.max(1, Math.round(count * (landPool.length / pool.length)));
      const oceanCount = Math.max(1, count - landCount);
      const landParts = landPool.length
        ? multiSourcePartition(world, pickSeeds(landPool, landCount, rng), (id) => isLand(world, id))
        : [];
      const oceanParts = oceanPool.length
        ? multiSourcePartition(world, pickSeeds(oceanPool, oceanCount, rng), (id) => !isLand(world, id))
        : [];
      parts = [...landParts, ...oceanParts].filter((p) => p.length >= 2);
    } else {
      parts = multiSourcePartition(world, seeds, canGo).filter((p) => p.length >= 2);
    }

    const els: Region[] = [];
    parts.forEach((cells, i) => {
      const coreCellId = selectCoreCell(world, cells, config.coreSelector, rng);
      els.push({
        id: `${layerId}-${i}`,
        layerId,
        name: names.length ? names[i % names.length] : `${layerId}-${i}`,
        cells,
        coreCellId,
        centerCellId: coreCellId,
        color: colors.length ? colors[i % colors.length] : '#888888',
        attributes: { kind: layerId },
        adjacentElementIds: new Set(),
        overlaps: [],
      });
    });
    computeRelationships(world, els);
    world.regions = world.regions.concat(els);
    return els;
  }

  const used = new Set<CellId>();
  const els: Region[] = [];

  const maxCellsPer = config.pattern === 'cluster' ? Math.max(20, Math.floor(pool.length / count / 2))
    : config.pattern === 'longStrip' ? Math.max(15, Math.floor(pool.length / count / 3))
    : config.pattern === 'scattered' ? Math.max(12, Math.floor(pool.length / count / 4))
    : Math.max(20, Math.floor(pool.length / count));

  for (let i = 0; i < count; i++) {
    let attempts = 0;
    let startId = -1;
    while (attempts < 120) {
      const id = pool[Math.floor(rng() * pool.length)];
      if (allowOverlap || !used.has(id)) { startId = id; break; }
      attempts++;
    }
    if (startId < 0) break;

    const seedLand = isLand(world, startId);
    const canGo = (to: CellId): boolean => {
      if (!allowOverlap && used.has(to)) return false;
      if (config.scope === 'fromLayer') return poolSet.has(to);
      return canExpand(world, config.allowOcean ? effScope : config.scope, seedLand, to);
    };

    let comp: CellId[];
    if (config.pattern === 'longStrip') {
      comp = longStrip(world, startId, canGo, maxCellsPer, rng);
    } else if (config.pattern === 'scattered') {
      comp = scatteredPieces(world, startId, canGo, maxCellsPer, rng);
    } else if (config.method === 'diffusion' && config.diffusion) {
      comp = radialCluster(world, startId, canGo, maxCellsPer, rng, config.diffusion.falloff);
    } else {
      const expandProb = config.pattern === 'cluster' ? 0.75 : 0.45;
      comp = floodFill(world, startId, canGo, maxCellsPer, rng, expandProb);
    }

    if (comp.length < 2) continue;
    for (const c of comp) used.add(c);

    const coreCellId = selectCoreCell(world, comp, config.coreSelector, rng);
    els.push({
      id: `${layerId}-${els.length}`,
      layerId,
      name: names.length ? names[i % names.length] : `${layerId}-${i}`,
      cells: comp,
      coreCellId,
      centerCellId: coreCellId,
      color: colors.length ? colors[i % colors.length] : '#888888',
      attributes: { kind: layerId },
      adjacentElementIds: new Set(),
      overlaps: [],
    });
  }

  computeRelationships(world, els);
  world.regions = world.regions.concat(els);
  return els;
}
