import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ExternalFileApi } from '@pivi/obsidian-host/externalFileApi';
import type { CapabilityApprovalPort } from '@pivi/agent/ports';
import type { CapabilityApprovalResult } from '@pivi/agent/ports';
import {
  createCapabilityApprovalPort,
  CapabilityPersistentGrantCache,
} from '@pivi/agent/runtime/capabilitySessionGrants';
import type { PersistentBashPermission } from '@pivi/agent/tools';
import {
  ensureBashCommandAllowed,
  ensureExternalDirectoryAccess,
  resolveExternalDirectoryRoot,
} from '@pivi/obsidian-tools';
import type { ObsidianToolDeps } from '@pivi/obsidian-tools';

function createPort(
  outcome: CapabilityApprovalResult,
): CapabilityApprovalPort {
  return createCapabilityApprovalPort({
    cache: new CapabilityPersistentGrantCache(),
    present: async () => outcome,
  });
}

function createDeps(
  port: CapabilityApprovalPort | null,
  allowedRoots: string[] = [],
  options: { vaultPath?: string | null; allowExternalRead?: boolean } = {},
): ObsidianToolDeps {
  return {
    externalFiles: new ExternalFileApi(allowedRoots),
    capabilityApproval: port,
    vaultPath: options.vaultPath ?? null,
    settings: { allowExternalRead: options.allowExternalRead ?? true },
  } as unknown as ObsidianToolDeps;
}

describe('resolveExternalDirectoryRoot', () => {
  let rootDir: string;
  let nestedFile: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-external-root-'));
    nestedFile = path.join(rootDir, 'notes', 'readme.md');
    fs.mkdirSync(path.dirname(nestedFile), { recursive: true });
    fs.writeFileSync(nestedFile, 'hello');
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('uses the directory itself for directory paths', () => {
    expect(resolveExternalDirectoryRoot(rootDir, true)).toBe(path.resolve(rootDir));
  });

  it('uses the parent directory for file paths', () => {
    expect(resolveExternalDirectoryRoot(nestedFile, false)).toBe(path.resolve(path.dirname(nestedFile)));
  });
});

describe('ensureExternalDirectoryAccess', () => {
  let rootDir: string;
  let nestedFile: string;

  beforeEach(() => {
    rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-external-access-'));
    nestedFile = path.join(rootDir, 'readme.md');
    fs.writeFileSync(nestedFile, 'hello');
  });

  afterEach(() => {
    fs.rmSync(rootDir, { recursive: true, force: true });
  });

  it('returns the base api when the path is already allowed', async () => {
    const deps = createDeps(null, [rootDir]);
    const api = await ensureExternalDirectoryAccess(
      deps,
      nestedFile,
      false,
      'read',
    );
    expect(api).toBe(deps.externalFiles);
  });

  it('denies when the port is missing', async () => {
    const deps = createDeps(null);
    await expect(
      ensureExternalDirectoryAccess(deps, nestedFile, false, 'read'),
    ).rejects.toThrow(/denied by user/i);
  });

  it('allows once without remembering a persistent grant', async () => {
    const port = createPort({ decision: 'allow-once' });
    const deps = createDeps(port);
    await ensureExternalDirectoryAccess(deps, nestedFile, false, 'read');
    expect(port.hasPersistentGrant({
      kind: 'external-directory',
      toolName: 'read',
      blockedPath: nestedFile,
      directoryRoot: rootDir,
      reason: '',
      description: '',
    })).toBe(false);
  });

  it('reuses persistent grants without prompting again', async () => {
    const present = jest.fn().mockResolvedValue({ decision: 'allow-always' });
    const cache = new CapabilityPersistentGrantCache();
    cache.rememberExternal(rootDir);
    const port = createCapabilityApprovalPort({ cache, present });
    const deps = createDeps(port);

    await ensureExternalDirectoryAccess(deps, nestedFile, false, 'read');
    await ensureExternalDirectoryAccess(deps, nestedFile, false, 'read');
    expect(present).not.toHaveBeenCalled();
  });

  it('rejects user denial', async () => {
    const deps = createDeps(createPort({ decision: 'deny' }));
    await expect(
      ensureExternalDirectoryAccess(deps, nestedFile, false, 'read'),
    ).rejects.toThrow(/denied by user/i);
  });

  it('allows vault paths without approval even when external read is off', async () => {
    const deps = createDeps(null, [], { vaultPath: rootDir, allowExternalRead: false });
    const api = await ensureExternalDirectoryAccess(
      deps,
      nestedFile,
      false,
      'read',
    );
    expect(api.isPathAllowed?.(nestedFile)).toBe(true);
  });

  it('rejects outside-vault paths without prompting when external read is off', async () => {
    const present = jest.fn().mockResolvedValue({ decision: 'allow-once' });
    const port = createCapabilityApprovalPort({
      cache: new CapabilityPersistentGrantCache(),
      present,
    });
    const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-outside-vault-'));
    try {
      const outsideFile = path.join(outsideDir, 'secret.txt');
      fs.writeFileSync(outsideFile, 'nope');
      const deps = createDeps(port, [], { vaultPath: rootDir, allowExternalRead: false });
      await expect(
        ensureExternalDirectoryAccess(deps, outsideFile, false, 'read'),
      ).rejects.toThrow(/outside the vault/i);
      expect(present).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(outsideDir, { recursive: true, force: true });
    }
  });
});

describe('ensureBashCommandAllowed', () => {
  it('skips approval when already allowlisted', async () => {
    const present = jest.fn();
    const port = createCapabilityApprovalPort({
      cache: new CapabilityPersistentGrantCache(),
      present,
    });
    await ensureBashCommandAllowed(createDeps(port), 'git status', true);
    expect(present).not.toHaveBeenCalled();
  });

  it('throws when no port is configured', async () => {
    await expect(
      ensureBashCommandAllowed(createDeps(null), 'git status', false),
    ).rejects.toThrow(/not in allowlist/i);
  });

  it('allows once without remembering a persistent grant', async () => {
    const port = createPort({ decision: 'allow-once' });
    await ensureBashCommandAllowed(createDeps(port), 'git status', false);
    expect(port.hasPersistentGrant({
      kind: 'bash',
      toolName: 'bash',
      command: 'git status',
      blockedPath: 'git status',
      reason: '',
      description: '',
    })).toBe(false);
  });

  it('rejects user denial', async () => {
    await expect(
      ensureBashCommandAllowed(createDeps(createPort({ decision: 'deny' })), 'git status', false),
    ).rejects.toThrow(/denied by user/i);
  });

  it('skips later same-family commands after Always and still asks for a different family', async () => {
    const stored: PersistentBashPermission[] = [];
    const present = jest.fn()
      .mockResolvedValueOnce({
        decision: 'allow-always',
        bashPermissions: [{
          kind: 'subcommand',
          executable: { kind: 'name', value: 'uv' },
          subcommand: 'python',
          enabled: true,
        }],
      })
      .mockResolvedValue({ decision: 'deny' });
    const port = createCapabilityApprovalPort({
      cache: new CapabilityPersistentGrantCache(),
      persistence: {
        persistBashPermissions: async (permissions) => {
          stored.push(...permissions);
        },
        getBashPermissions: () => stored,
      },
      present,
    });
    const deps = createDeps(port);

    await ensureBashCommandAllowed(deps, 'uv python list', false);
    await ensureBashCommandAllowed(deps, 'uv python install 3.12', false);
    expect(present).toHaveBeenCalledTimes(1);

    await expect(ensureBashCommandAllowed(deps, 'uv run script.py', false))
      .rejects.toThrow(/denied by user/i);
    expect(present).toHaveBeenCalledTimes(2);
  });

  it('still asks after Allow once for the same command', async () => {
    const present = jest.fn().mockResolvedValue({ decision: 'allow-once' });
    const port = createCapabilityApprovalPort({
      cache: new CapabilityPersistentGrantCache(),
      present,
    });
    const deps = createDeps(port);

    await ensureBashCommandAllowed(deps, 'git status --short', false);
    await ensureBashCommandAllowed(deps, 'git status --short', false);
    expect(present).toHaveBeenCalledTimes(2);
  });
});
