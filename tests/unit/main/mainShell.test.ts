import PiviPlugin from '@/main';
import { createMockApp } from '../../helpers/mockApp';

describe('PiviPlugin shell', () => {
  it('exposes only lifecycle methods beyond the Obsidian Plugin API', () => {
    const plugin = new PiviPlugin(createMockApp(), {
      id: 'pivi',
      name: 'Pivi',
      version: '0.0.0',
    } as never);

    expect(plugin.onload).toEqual(expect.any(Function));
    expect(plugin.onunload).toEqual(expect.any(Function));
    expect('ensureWorkspaceServices' in plugin).toBe(false);
    expect('getUiFacades' in plugin).toBe(false);
    expect('getSessionList' in plugin).toBe(false);
    expect('saveSettings' in plugin).toBe(false);
  });
});
