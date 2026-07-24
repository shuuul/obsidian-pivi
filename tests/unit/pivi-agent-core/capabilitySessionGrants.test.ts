import type { CapabilityApprovalRequest, CapabilityApprovalResult } from '@pivi/pivi-agent-core/ports';
import {
  bashAllowlistPersistScopesDiffer,
  CapabilitySessionGrants,
  createCapabilityApprovalPort,
  resolveBashAllowlistPersistEntry,
} from '@pivi/pivi-agent-core/runtime/capabilitySessionGrants';

const bashRequest: CapabilityApprovalRequest = {
  kind: 'bash',
  toolName: 'obsidian_bash',
  command: 'git status',
  blockedPath: 'git status',
  reason: 'Command is not on the Bash allowlist.',
  description: 'Run command: git status',
};

const externalRequest: CapabilityApprovalRequest = {
  kind: 'external-directory',
  toolName: 'obsidian_read_external',
  blockedPath: '/tmp/project/readme.md',
  directoryRoot: '/tmp/project',
  reason: 'Path is outside allowed external directories.',
  description: 'Access external path: /tmp/project/readme.md',
};

describe('resolveBashAllowlistPersistEntry', () => {
  it('uses the full command or first-token prefix', () => {
    expect(resolveBashAllowlistPersistEntry('ast-grep --version', 'full')).toBe('ast-grep --version');
    expect(resolveBashAllowlistPersistEntry('ast-grep --version', 'prefix')).toBe('ast-grep');
    expect(bashAllowlistPersistScopesDiffer('ast-grep --version')).toBe(true);
    expect(bashAllowlistPersistScopesDiffer('ast-grep')).toBe(false);
  });
});

describe('CapabilitySessionGrants', () => {
  it('remembers and checks bash and external keys independently', () => {
    const grants = new CapabilitySessionGrants();
    expect(grants.hasSessionGrant(bashRequest)).toBe(false);

    grants.rememberSessionGrant(bashRequest);
    expect(grants.hasSessionGrant(bashRequest)).toBe(true);
    expect(grants.hasSessionGrant(externalRequest)).toBe(false);

    grants.clear();
    expect(grants.hasSessionGrant(bashRequest)).toBe(false);
  });
});

function result(decision: CapabilityApprovalResult['decision'], bashAllowlistScope?: CapabilityApprovalResult['bashAllowlistScope']): CapabilityApprovalResult {
  return bashAllowlistScope ? { decision, bashAllowlistScope } : { decision };
}

describe('createCapabilityApprovalPort', () => {
  it('returns presenter decisions without mutating grants for deny or allow-once', async () => {
    const grants = new CapabilitySessionGrants();
    const persistBash = jest.fn();
    const port = createCapabilityApprovalPort({
      grants,
      present: async () => result('allow'),
      persistence: { persistBashAllowlistEntry: persistBash },
    });

    await expect(port.requestApproval(bashRequest)).resolves.toEqual(result('allow'));
    expect(grants.hasSessionGrant(bashRequest)).toBe(false);
    expect(persistBash).not.toHaveBeenCalled();
  });

  it('remembers session grants for allow-session without persistence', async () => {
    const grants = new CapabilitySessionGrants();
    const persistBash = jest.fn();
    const port = createCapabilityApprovalPort({
      grants,
      present: async () => result('allow-session'),
      persistence: { persistBashAllowlistEntry: persistBash },
    });

    await expect(port.requestApproval(bashRequest)).resolves.toEqual(result('allow-session'));
    expect(grants.hasSessionGrant(bashRequest)).toBe(true);
    expect(persistBash).not.toHaveBeenCalled();
  });

  it('persists full or prefix entries for allow-always bash', async () => {
    const grants = new CapabilitySessionGrants();
    const persistBash = jest.fn().mockResolvedValue(undefined);
    const port = createCapabilityApprovalPort({
      grants,
      present: async () => result('allow-always', 'prefix'),
      persistence: { persistBashAllowlistEntry: persistBash },
    });

    const versionRequest = {
      ...bashRequest,
      command: 'ast-grep --version',
      blockedPath: 'ast-grep --version',
    };
    await expect(port.requestApproval(versionRequest)).resolves.toEqual(result('allow-always', 'prefix'));
    expect(persistBash).toHaveBeenCalledWith('ast-grep');
    expect(grants.hasSessionGrant(versionRequest)).toBe(true);

    persistBash.mockClear();
    const fullPort = createCapabilityApprovalPort({
      grants: new CapabilitySessionGrants(),
      present: async () => result('allow-always', 'full'),
      persistence: { persistBashAllowlistEntry: persistBash },
    });
    await fullPort.requestApproval(versionRequest);
    expect(persistBash).toHaveBeenCalledWith('ast-grep --version');
  });

  it('persists external directories for allow-always', async () => {
    const grants = new CapabilitySessionGrants();
    const persistExternal = jest.fn().mockResolvedValue(undefined);
    const onExternalDirectoryAllowed = jest.fn().mockResolvedValue(undefined);
    const port = createCapabilityApprovalPort({
      grants,
      present: async () => result('allow-always'),
      persistence: {
        persistBashAllowlistEntry: jest.fn(),
        persistExternalDirectory: persistExternal,
        onExternalDirectoryAllowed,
      },
    });

    await expect(port.requestApproval(externalRequest)).resolves.toEqual(result('allow-always'));
    expect(persistExternal).toHaveBeenCalledWith('/tmp/project');
    expect(onExternalDirectoryAllowed).toHaveBeenCalledWith('/tmp/project');
    expect(grants.hasSessionGrant(externalRequest)).toBe(true);
  });

  it('clears session grants through the port', () => {
    const grants = new CapabilitySessionGrants();
    const port = createCapabilityApprovalPort({
      grants,
      present: async () => result('allow-session'),
    });

    grants.rememberSessionGrant(bashRequest);
    port.clearSessionGrants();
    expect(grants.hasSessionGrant(bashRequest)).toBe(false);
  });
});
