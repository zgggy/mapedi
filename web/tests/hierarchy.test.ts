import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import {
  absorbLandCell,
  rebuildHeightRegions,
  heightKindOf,
} from '../src/core/heightRegions';
import { checkElementReparent } from '../src/core/hierarchy/gate';
import { reparentElement } from '../src/core/hierarchy/ops';
import { generatePolitical } from '../src/core/political';

describe('height absorb + identity', () => {
  it('land cell joins neighbor continent id', () => {
    const w = createWorld({ seed: 3, count: 400 });
    generateDemoContinents(w, 3);
    rebuildHeightRegions(w);
    const cont = w.regions.filter((r) => r.layerId === 'landsea' && heightKindOf(r) === 'continent');
    expect(cont.length).toBeGreaterThan(0);
    // 取一个大陆边缘的海洋格，抬升后应 absorb 到邻接 continentId
    const land = new Set(cont.flatMap((r) => r.cells));
    let target = -1;
    for (const c of w.cells) {
      if (c.height > 0) continue;
      if (c.neighbors.some((n) => land.has(n))) {
        target = c.id;
        break;
      }
    }
    expect(target).toBeGreaterThanOrEqual(0);
    w.cells[target].height = 0.5;
    w.cells[target].isOcean = false;
    absorbLandCell(w, target);
    expect(w.cells[target].continentId).toBeGreaterThanOrEqual(0);
  });

  it('rebuild keeps overlapping continent identity', () => {
    const w = createWorld({ seed: 11, count: 600 });
    generateDemoContinents(w, 11);
    rebuildHeightRegions(w);
    const a = w.regions.find((r) => r.layerId === 'landsea' && heightKindOf(r) === 'continent')!;
    const id = a.id;
    rebuildHeightRegions(w);
    const still = w.regions.find((r) => r.id === id);
    expect(still).toBeTruthy();
  });
});

// demote/promote 死路径已随拖动退役删除（HIERARCHY §7 清账，2026-10-03 包1）；
// 其业务规则（跨层挂靠方向、升级清父）迁至闸/ops 规则面，规则不变。
describe('桥不变量 I-bridge（跨层挂靠规则）', () => {
  function makePolitical() {
    const w = createWorld({ seed: 21, count: 800 });
    generateDemoContinents(w, 21);
    generatePolitical(w, 21, 4);
    return w;
  }

  it('province 可换父到另一 country（父层恰为本层的父层）', () => {
    const w = makePolitical();
    const countries = w.regions.filter((r) => r.layerId === 'country');
    expect(countries.length).toBeGreaterThanOrEqual(2);
    const prov = w.regions.find((r) => r.layerId === 'province')!;
    // 原「降级」的挂靠方向规则：元素父边恰好跨到层的父层
    const err = reparentElement(w, prov.id, countries[1].id);
    expect(err).toBeNull();
    expect(w.regions.find((r) => r.id === prov.id)!.parentId).toBe(countries[1].id);
  });

  it('同层互挂被拒（国家挂到国家下 = 桥违例）', () => {
    const w = makePolitical();
    const countries = w.regions.filter((r) => r.layerId === 'country');
    expect(countries.length).toBeGreaterThanOrEqual(2);
    const err = reparentElement(w, countries[1].id, countries[0].id);
    expect(err).toContain('桥');
    expect(w.regions.find((r) => r.id === countries[1].id)!.parentId).toBeUndefined();
  });

  it('悬空父被拒；清父（原「升级」结果规则 = parentId 置空）', () => {
    const w = makePolitical();
    const prov = w.regions.find((r) => r.layerId === 'province')!;
    expect(reparentElement(w, prov.id, 'ghost-region')).toContain('不存在');
    expect(reparentElement(w, prov.id, null)).toBeNull();
    expect(w.regions.find((r) => r.id === prov.id)!.parentId).toBeUndefined();
  });

  it('闸检查可独立调用（写入侧不变量的单测面）', () => {
    const w = makePolitical();
    const countries = w.regions.filter((r) => r.layerId === 'country');
    expect(checkElementReparent(w, countries[0].id, countries[1].id)).toContain('桥');
    expect(checkElementReparent(w, countries[0].id, 'ghost')).toContain('不存在');
    expect(checkElementReparent(w, countries[0].id, null)).toBeNull();
  });
});
