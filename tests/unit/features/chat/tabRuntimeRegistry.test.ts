import { TabRuntimeRegistry } from '@/ui/chat/tabs/TabRuntimeRegistry';
import type { TabData } from '@/ui/chat/tabs/types';

function runtime(id: string): TabData {
  return { id } as TabData;
}

describe('TabRuntimeRegistry', () => {
  it('owns runtime aggregates by tab id and releases them deterministically', () => {
    const registry = new TabRuntimeRegistry();
    const first = runtime('first');
    const second = runtime('second');

    registry.set(first.id, first).set(second.id, second);

    expect(registry.size).toBe(2);
    expect(registry.get('first')).toBe(first);
    expect(Array.from(registry.values())).toEqual([first, second]);

    expect(registry.delete('first')).toBe(true);
    expect(registry.has('first')).toBe(false);
    registry.clear();
    expect(registry.size).toBe(0);
  });
});
