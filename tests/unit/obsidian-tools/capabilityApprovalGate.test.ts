import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { ExternalFileApi } from '@pivi/obsidian-host/externalFileApi';
import type { CapabilityApprovalPort } from '@pivi/pivi-agent-core/ports';
import type { CapabilityApprovalResult } from '@pivi/pivi-agent-core/ports';
import {
  createCapabilityApprovalPort,
  CapabilitySessionGrants,
} from '@pivi/pivi-agent-core/runtime/capabilitySessionGrants';
import {
  ensureBashCommandAllowed,
  ensureExternalDirectoryAccess,
  resolveExternalDirectoryRoot,
} from '@pivi/obsidian-tools';
import type { ObsidianToolDeps } from '@pivi/obsidian-tools';

function createPort(
  outcome: CapabilityApprovalResult,
): CapabilityApprovalPort {
  const grants = new CapabilitySessionGrants();
  return createCapabilityApprovalPort({
    grants,
    present: async () => outcome,
  });
}

function createDeps(port: CapabilityApprovalPort | null, allowedRoots: string[] = []): ObsidianToolDeps {
  return {
    externalFiles: new ExternalFileApi(allowedRoots),
    capabilityApproval: port,
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
      'obsidian_read_external',
    );
    expect(api).toBe(deps.externalFiles);
  });

  it('denies when the port is missing', async () => {
    const deps = createDeps(null);
    await expect(
      ensureExternalDirectoryAccess(deps, nestedFile, false, 'obsidian_read_external'),
    ).rejects.toThrow(/denied by user/i);
  });

  it('allows once without remembering a session grant', async () => {
    const port = createPort({ decision: 'allow' });
    const deps = createDeps(port);
    await ensureExternalDirectoryAccess(deps, nestedFile, false, 'obsidian_read_external');
    expect(port.hasSessionGrant({
      kind: 'external-directory',
      toolName: 'obsidian_read_external',
      blockedPath: nestedFile,
      directoryRoot: rootDir,
      reason: '',
      description: '',
    })).toBe(false);
  });

  it('reuses session grants without prompting again', async () => {
    const present = jest.fn().mockResolvedValue({ decision: 'allow-session' });
    const grants = new CapabilitySessionGrants();
    const port = createCapabilityApprovalPort({ grants, present });
    const deps = createDeps(port);

    await ensureExternalDirectoryAccess(deps, nestedFile, false, 'obsidian_read_external');
    await ensureExternalDirectoryAccess(deps, nestedFile, false, 'obsidian_read_external');
    expect(present).toHaveBeenCalledTimes(1);
  });

  it('rejects user denial', async () => {
    const deps = createDeps(createPort({ decision: 'deny' }));
    await expect(
      ensureExternalDirectoryAccess(deps, nestedFile, false, 'obsidian_read_external'),
    ).rejects.toThrow(/denied by user/i);
  });
});

describe('ensureBashCommandAllowed', () => {
  it('skips approval when already allowlisted', async () => {
    const present = jest.fn();
    const port = createCapabilityApprovalPort({
      grants: new CapabilitySessionGrants(),
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

  it('allows once without remembering a session grant', async () => {
    const port = createPort({ decision: 'allow' });
    await ensureBashCommandAllowed(createDeps(port), 'git status', false);
    expect(port.hasSessionGrant({
      kind: 'bash',
      toolName: 'obsidian_bash',
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
});
