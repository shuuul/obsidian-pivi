import {
  assertPiSessionManagerPrivateCapabilities,
  PI_SESSION_MANAGER_PRIVATE_CAPABILITIES,
  rewritePersistedSessionManager,
  truncatePersistedSessionManager,
} from '@pivi/pivi-agent-core/engine/pi/session/piSessionManagerPrivateAdapter';
import { VERSION } from '@pivi/pivi-agent-core/engine/pi/shims/piCodingAgentConfig';

function createCapableManager(overrides: Record<string, unknown> = {}) {
  return {
    fileEntries: [
      {
        type: 'session',
        version: 3,
        id: 'session-1',
        timestamp: '2026-01-01T00:00:00.000Z',
        cwd: '/vault',
      },
      {
        type: 'message',
        id: 'user-1',
        parentId: null,
        timestamp: '2026-01-01T00:00:01.000Z',
        message: { role: 'user', content: 'hi', timestamp: 1 },
      },
    ],
    flushed: false,
    _rewriteFile: jest.fn(),
    _buildIndex: jest.fn(),
    ...overrides,
  };
}

describe('piSessionManagerPrivateAdapter', () => {
  it.each(PI_SESSION_MANAGER_PRIVATE_CAPABILITIES)(
    'fails before mutation when %s is missing',
    (capability) => {
      const rewrite = jest.fn();
      const buildIndex = jest.fn();
      const manager = createCapableManager({
        _rewriteFile: rewrite,
        _buildIndex: buildIndex,
      });
      if (capability === 'fileEntries') {
        delete (manager as { fileEntries?: unknown }).fileEntries;
      } else if (capability === 'flushed') {
        delete (manager as { flushed?: unknown }).flushed;
      } else if (capability === '_rewriteFile') {
        (manager as { _rewriteFile?: unknown })._rewriteFile = undefined;
      } else {
        (manager as { _buildIndex?: unknown })._buildIndex = undefined;
      }

      expect(() => assertPiSessionManagerPrivateCapabilities(manager, 'unit test'))
        .toThrow(new RegExp(`${capability}`));
      expect(() => assertPiSessionManagerPrivateCapabilities(manager, 'unit test'))
        .toThrow(new RegExp(VERSION.replace(/\./g, '\\.')));
      expect(() => assertPiSessionManagerPrivateCapabilities(manager, 'unit test'))
        .toThrow(/test:pi-compat/);
      expect(rewrite).not.toHaveBeenCalled();
      expect(buildIndex).not.toHaveBeenCalled();
    },
  );

  it('rewrites and marks flushed only after capability assertion', () => {
    const manager = createCapableManager();
    rewritePersistedSessionManager(manager);
    expect(manager._rewriteFile).toHaveBeenCalledTimes(1);
    expect(manager.flushed).toBe(true);
  });

  it('truncates only after capability assertion and rebuilds the index', () => {
    const manager = createCapableManager();
    expect(truncatePersistedSessionManager(manager, 'user-1')).toBe(true);
    expect(manager.fileEntries).toHaveLength(2);
    expect(manager._buildIndex).toHaveBeenCalledTimes(1);

    expect(truncatePersistedSessionManager(manager, null)).toBe(true);
    expect(manager.fileEntries).toHaveLength(1);
    expect(manager.fileEntries[0]?.type).toBe('session');
  });

  it('does not call rewrite when truncate capability assertion fails', () => {
    const manager = createCapableManager({ _buildIndex: undefined });
    expect(() => rewritePersistedSessionManager(manager)).toThrow(/_buildIndex/);
    expect(manager._rewriteFile).not.toHaveBeenCalled();
  });
});
