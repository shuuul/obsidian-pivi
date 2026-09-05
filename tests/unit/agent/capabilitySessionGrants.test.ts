import type {
  CapabilityApprovalRequest,
  CapabilityApprovalResult,
} from '@pivi/agent/ports';
import {
  CapabilityPersistentGrantCache,
  createCapabilityApprovalPort,
} from '@pivi/agent/runtime/capabilitySessionGrants';
import type { PersistentBashPermission } from '@pivi/agent/tools';

const bashRequest: CapabilityApprovalRequest = {
  kind: 'bash',
  toolName: 'obsidian_bash',
  command: 'git status',
  shellPath: '/bin/sh',
  blockedPath: 'git status',
  reason: 'Command is not on the persistent permission list.',
  description: 'Run command: git status',
};

const externalRequest: CapabilityApprovalRequest = {
  kind: 'external-directory',
  toolName: 'obsidian_read_external',
  directoryRoot: '/tmp/notes',
  blockedPath: '/tmp/notes/a.md',
  reason: 'Path is outside allowed external directories.',
  description: 'Access external path',
};

function gitStatus(): PersistentBashPermission {
  return {
    kind: 'subcommand',
    executable: { kind: 'name', value: 'git' },
    subcommand: 'status',
    enabled: true,
  };
}

describe('CapabilityPersistentGrantCache', () => {
  it('matches committed bash and external grants immediately', () => {
    const cache = new CapabilityPersistentGrantCache();
    expect(cache.hasPersistentGrant(bashRequest)).toBe(false);
    cache.rememberBash([gitStatus()]);
    expect(cache.hasPersistentGrant(bashRequest)).toBe(true);
    expect(cache.hasPersistentGrant({ ...bashRequest, command: 'git status --short' })).toBe(true);
    expect(cache.hasPersistentGrant({ ...bashRequest, command: 'git log' })).toBe(false);
    cache.rememberExternal('/tmp/notes');
    expect(cache.hasPersistentGrant(externalRequest)).toBe(true);
    cache.clear();
    expect(cache.hasPersistentGrant(bashRequest)).toBe(false);
  });
});

describe('createCapabilityApprovalPort', () => {
  it('persists Always bash scopes before remembering them', async () => {
    const cache = new CapabilityPersistentGrantCache();
    const persistBashPermissions = jest.fn(async () => undefined);
    const port = createCapabilityApprovalPort({
      cache,
      persistence: { persistBashPermissions },
      present: async () => ({ decision: 'allow-always', bashPermissions: [gitStatus()] }),
    });
    await expect(port.requestApproval(bashRequest)).resolves.toEqual({
      decision: 'allow-always',
      bashPermissions: [gitStatus()],
    });
    expect(persistBashPermissions).toHaveBeenCalledWith([gitStatus()]);
    expect(cache.hasPersistentGrant(bashRequest)).toBe(true);
    expect(port.hasPersistentGrant(bashRequest)).toBe(true);
  });

  it('does not persist Allow once', async () => {
    const cache = new CapabilityPersistentGrantCache();
    const persistBashPermissions = jest.fn(async () => undefined);
    const port = createCapabilityApprovalPort({
      cache,
      persistence: { persistBashPermissions },
      present: async (): Promise<CapabilityApprovalResult> => ({ decision: 'allow-once' }),
    });
    await expect(port.requestApproval(bashRequest)).resolves.toEqual({ decision: 'allow-once' });
    expect(persistBashPermissions).not.toHaveBeenCalled();
    expect(cache.hasPersistentGrant(bashRequest)).toBe(false);
  });

  it('cancels Always when persistence is requested without scopes', async () => {
    const port = createCapabilityApprovalPort({
      cache: new CapabilityPersistentGrantCache(),
      present: async () => ({ decision: 'allow-always' }),
    });
    await expect(port.requestApproval(bashRequest)).resolves.toEqual({ decision: 'cancel' });
  });
});
