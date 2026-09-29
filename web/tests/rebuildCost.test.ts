/** 临时探针：一次投影切换（projKey 变更）的全量重建耗时——动画策略的数据依据 */
import { describe, it } from 'vitest';
import { createWorld, rebuildSharedEdgesFromCells } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { getProjCache } from '../src/render/projCache';
import { defaultProjParams, project } from '../src/core/project/projections';
import { cellSetBoundaryEdges, cellSetBoundaryRings, indexEdgesByPair, pseudoEdgeList } from '../src/core/ring/build';
import { frameYEnv, frameRect } from '../src/render/space';
import { prepareDisplayRings } from '../src/core/ring/normalize';
import type { World } from '../src/core/types';

const pp = defaultProjParams();

describe('rebuild cost', () => {
  it('measure', () => {
    const t0 = performance.now();
    const world: World = createWorld({ seed: 7, count: 25000 });
    generateDemoContinents(world, 7);
    const tGen = performance.now() - t0;
    if (!world.sharedEdges?.size) world.sharedEdges = rebuildSharedEdgesFromCells(world);

    // 集合构造（模拟真实件：陆地/海洋/极冠 + 若干区域）
    const land = world.cells.filter((c) => c.height > 0).map((c) => c.id);
    const sea = world.cells.filter((c) => c.height <= 0).map((c) => c.id);
    const polar = world.cells.filter((c) => Math.abs(c.center.lat) > 60).map((c) => c.id);
    const sets = [land, sea, polar].filter((s) => s.length > 8);
    // 小件（模拟语义层小 region）：切片 20 个
    for (let i = 0; i < 20 && i * 400 < world.cells.length; i++) {
      sets.push(world.cells.slice(i * 400, i * 400 + 200).map((c) => c.id));
    }

    for (const proj of ['mercator', 'robinson'] as const) {
      const projectFn = (ll: { lon: number; lat: number }) => project(ll, proj, pp);
      let t = performance.now();
      const cache = getProjCache(world, proj, pp);
      const projMs = performance.now() - t;

      t = performance.now();
      const pair = indexEdgesByPair(world);
      const pseudo = pseudoEdgeList(world, pair);
      const idxMs = performance.now() - t;

      t = performance.now();
      let ringCount = 0;
      for (const cells of sets) {
        const edges = cellSetBoundaryEdges(world, new Set(cells), pair, pseudo);
        const rings = cellSetBoundaryRings(world, new Set(cells), projectFn, edges, (y) => (proj === 'robinson' ? 0.8487 * 1 : 1) * 2 * Math.PI);
        ringCount += rings.length;
      }
      const ringMs = performance.now() - t;

      t = performance.now();
      const fy = frameYEnv(projectFn, proj);
      let disp = 0;
      for (const cells of sets.slice(0, 5)) {
        const edges = cellSetBoundaryEdges(world, new Set(cells), pair, pseudo);
        const rings = cellSetBoundaryRings(world, new Set(cells), projectFn, edges, fy.periodAt);
        for (const r of rings) disp += prepareDisplayRings(r, fy).length;
      }
      const prepMs = performance.now() - t;

      console.log(`${proj}: cells=${world.cells.length} sets=${sets.length} rings=${ringCount}`);
      console.log(`  gen=${tGen.toFixed(0)}ms projCache=${projMs.toFixed(0)}ms pairIdx=${idxMs.toFixed(0)}ms rings=${ringMs.toFixed(0)}ms prep=${prepMs.toFixed(0)}ms`);
      void cache; void disp; void frameRect;
    }
  });
});
