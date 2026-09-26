import { describe, expect, it } from 'vitest';
import type { Region, World } from '../src/core/types';
import {
  setSuzerain,
  toggleEnemy,
  toggleAlly,
  vassalsOf,
  suzerainOf,
  enemiesOf,
  alliesOf,
  wouldCreateVassalCycle,
  scrubRegionDiplomacy,
  diplomacyBadge,
} from '../src/core/diplomacy';

function fakeWorld(ids: string[], layerId = 'country'): World {
  const regions: Region[] = ids.map((id) => ({
    id,
    layerId,
    name: id.toUpperCase(),
    cells: [],
    color: '#888',
    attributes: {},
  }));
  return {
    meta: { seed: 1, cellCount: 0, formatVersion: 1, createdAt: 0 },
    cells: [],
    rivers: new Map(),
    layers: [],
    regions,
  } as World;
}

describe('diplomacy vassal / enemy', () => {
  it('sets and clears suzerain; lists vassals', () => {
    const w = fakeWorld(['a', 'b', 'c']);
    expect(setSuzerain(w, 'b', 'a')).toBe(true);
    expect(suzerainOf(w.regions.find((r) => r.id === 'b')!)).toBe('a');
    expect(vassalsOf(w, 'a').map((r) => r.id)).toEqual(['b']);
    expect(diplomacyBadge(w, w.regions.find((r) => r.id === 'b')!)).toContain('附庸');
    expect(setSuzerain(w, 'b', null)).toBe(true);
    expect(suzerainOf(w.regions.find((r) => r.id === 'b')!)).toBeNull();
  });

  it('rejects self and cycles; cross-layer refused', () => {
    const w = fakeWorld(['a', 'b', 'c']);
    expect(setSuzerain(w, 'a', 'a')).toBe(false);
    expect(setSuzerain(w, 'b', 'a')).toBe(true);
    expect(setSuzerain(w, 'c', 'b')).toBe(true);
    // a 附庸于 c → c→b→a 成环
    expect(wouldCreateVassalCycle(w, 'a', 'c')).toBe(true);
    expect(setSuzerain(w, 'a', 'c')).toBe(false);

    const w2 = fakeWorld(['x'], 'country');
    w2.regions.push({
      id: 'y',
      layerId: 'province',
      name: 'Y',
      cells: [],
      color: '#000',
      attributes: {},
    });
    expect(setSuzerain(w2, 'x', 'y')).toBe(false);
  });

  it('toggle enemy is mutual; ally excludes enemy', () => {
    const w = fakeWorld(['a', 'b']);
    expect(toggleEnemy(w, 'a', 'b')).toBe(true);
    expect(enemiesOf(w.regions[0])).toContain('b');
    expect(enemiesOf(w.regions[1])).toContain('a');
    expect(toggleAlly(w, 'a', 'b')).toBe(true);
    expect(alliesOf(w.regions[0])).toContain('b');
    expect(enemiesOf(w.regions[0])).not.toContain('b');
  });

  it('scrub removes dangling refs on delete', () => {
    const w = fakeWorld(['a', 'b', 'c']);
    setSuzerain(w, 'b', 'a');
    toggleEnemy(w, 'c', 'a');
    scrubRegionDiplomacy(w, 'a');
    w.regions = w.regions.filter((r) => r.id !== 'a');
    expect(suzerainOf(w.regions.find((r) => r.id === 'b')!)).toBeNull();
    expect(enemiesOf(w.regions.find((r) => r.id === 'c')!)).toEqual([]);
  });
});
