import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { checkElementReparent } from '../src/core/hierarchy/gate';
import { reparentElement } from '../src/core/hierarchy/ops';
import { generatePolitical } from '../src/core/political';

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
