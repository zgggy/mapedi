import { describe, expect, it } from 'vitest';
import { createWorld } from '../src/core/world';
import { generateDemoContinents } from '../src/core/height';
import { generatePolitical } from '../src/core/political';
import { siblingRegions } from '../src/core/hierarchy/derive';
import { moveAmongSiblings } from '../src/core/hierarchy/ops';

function makeCountries() {
  const w = createWorld({ seed: 99, count: 600 });
  generateDemoContinents(w, 99);
  generatePolitical(w, 99, 5);
  return w;
}

describe('sibling order (insert, not end)', () => {
  it('moveAmongSiblings inserts after target, not at list end', () => {
    const w = makeCountries();
    const list = siblingRegions(w, 'country', null);
    expect(list.length).toBeGreaterThanOrEqual(3);
    const [a, b, c] = list;
    const ok = moveAmongSiblings(w, a.id, c.id, 'after');
    expect(ok).toBe(true);
    const ids = siblingRegions(w, 'country', null).map((r) => r.id);
    // a 紧跟在 c 后，且不是列表末尾（除非 c 本来就是最后一个且 a 是唯一后继）
    expect(ids.indexOf(a.id)).toBe(ids.indexOf(c.id) + 1);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(c.id));
  });

  it('moveAmongSiblings before target', () => {
    const w = makeCountries();
    const list = siblingRegions(w, 'country', null);
    const [a, b, c] = list;
    moveAmongSiblings(w, c.id, a.id, 'before');
    const ids = siblingRegions(w, 'country', null).map((r) => r.id);
    expect(ids.indexOf(c.id)).toBe(ids.indexOf(a.id) - 1);
    expect(ids.indexOf(a.id)).toBeLessThan(ids.indexOf(b.id));
  });

  it('gap drop between two countries inserts in place', () => {
    const w = makeCountries();
    const list = siblingRegions(w, 'country', null);
    const [a] = list;
    const b = list[1];
    const c = list[2];
    const r = moveAmongSiblings(w, c.id, a.id, 'after');
    expect(r).toBe(true);
    const ord = siblingRegions(w, 'country', null).map((x) => x.id);
    expect(ord.indexOf(c.id)).toBe(ord.indexOf(a.id) + 1);
    expect(ord.indexOf(a.id)).toBe(0);
    void b;
  });

  it('gap drop before first uses afterId=null', () => {
    const w = makeCountries();
    const list = siblingRegions(w, 'country', null);
    const last = list[list.length - 1];
    moveAmongSiblings(w, last.id, null, 'before');
    expect(siblingRegions(w, 'country', null)[0].id).toBe(last.id);
  });
});
