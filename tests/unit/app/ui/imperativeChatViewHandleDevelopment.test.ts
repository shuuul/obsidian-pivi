import { createImperativeChatViewHandle } from '@/app/ui/imperativeChatViewHandle';

describe('createImperativeChatViewHandle development gate', () => {
  const baseDeps = {
    getTabManager: () => null,
    getMountedPorts: () => null,
    plugin: {} as never,
    persistTabStateImmediate: async () => undefined,
    publishTabSnapshot: () => undefined,
    runWithoutTabPersistence: async <T,>(action: () => Promise<T>) => action(),
    syncInputTabBarPortal: () => undefined,
  };

  it('omits development commands by default', () => {
    const handle = createImperativeChatViewHandle(baseDeps);
    expect(handle.development).toBeUndefined();
  });

  it('attaches development commands when composition enables them', () => {
    const handle = createImperativeChatViewHandle({
      ...baseDeps,
      enableDevelopmentCommands: true,
    });
    expect(handle.development).toBeDefined();
    expect(typeof handle.development?.run20SubagentsWorkload).toBe('function');
    expect(typeof handle.development?.run100KbMarkdownStream).toBe('function');
  });
});
