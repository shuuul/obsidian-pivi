import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  SkillsManagementCoordinator,
  type SkillsManagementMetadataPort,
} from '@pivi/agent/skills/vault/skillsManagementCoordinator';
import {
  VaultSkillsService,
  type InstallSkillsOptions,
} from '@pivi/agent/skills/vault/vaultSkillsService';

function mockService(skills: Array<{
  name: string;
  description: string;
  folderName: string;
  disabled: boolean;
}>): VaultSkillsService {
  return {
    prepareWorkspace: jest.fn(),
    list: jest.fn(() => skills),
    installFromSource: jest.fn(async (_source: string, options?: InstallSkillsOptions) => {
      await options?.afterPublish?.();
    }),
    listRemoteSkills: jest.fn(),
    setSkillDisabled: jest.fn(),
    updateSkill: jest.fn(),
    updateAll: jest.fn(),
    removeTransactional: jest.fn(),
    consumeCleanupFailure: jest.fn(() => false),
  } as unknown as VaultSkillsService;
}

describe('SkillsManagementCoordinator', () => {
  let vaultPath: string;

  beforeEach(() => {
    vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-skills-coordinator-'));
    fs.mkdirSync(path.join(vaultPath, '.pivi', 'skills'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });

  it('skips malformed skills-lock entries while projecting valid provenance', () => {
    fs.writeFileSync(path.join(vaultPath, '.pivi', 'skills-lock.json'), JSON.stringify({
      skills: {
        valid: { source: 'owner/repo', skillPath: 'skills/demo/SKILL.md' },
        nullEntry: null,
        invalidPath: { skillPath: 42 },
      },
    }));
    const coordinator = new SkillsManagementCoordinator({
      service: mockService([{
        name: 'demo',
        description: 'Demo',
        folderName: 'demo',
        disabled: false,
      }]),
      vaultPath,
    });

    expect(coordinator.snapshot().skills).toEqual([{
      name: 'demo',
      description: 'Demo',
      folderName: 'demo',
      enabled: true,
      packageSource: 'owner/repo',
    }]);
  });

  it('normalizes an install source before service and metadata callbacks', async () => {
    const metadata: SkillsManagementMetadataPort = {
      mutationPublished: jest.fn(),
    };
    const service = mockService([]);
    const coordinator = new SkillsManagementCoordinator({
      service,
      vaultPath,
      metadata,
    });

    await coordinator.execute({ action: 'install', source: 'https://skills.sh/owner/repo' });

    expect(service.installFromSource).toHaveBeenCalledWith(
      'owner/repo',
      expect.objectContaining({
        metadata: {
          mutation: { action: 'install', source: 'owner/repo' },
          context: undefined,
        },
      }),
    );
    expect(metadata.mutationPublished).toHaveBeenCalledWith(
      { action: 'install', source: 'owner/repo' },
      undefined,
    );
  });

  it('retries metadata for a published filesystem transaction during recovery', async () => {
    const transaction = path.join(vaultPath, '.pivi', '.skills-transaction-crash');
    const previous = path.join(transaction, 'previous', 'skills');
    const live = path.join(vaultPath, '.pivi', 'skills');
    fs.mkdirSync(previous, { recursive: true });
    fs.writeFileSync(path.join(previous, 'SKILL.md'), 'old');
    fs.writeFileSync(path.join(live, 'SKILL.md'), 'new');
    fs.writeFileSync(path.join(transaction, 'transaction.json'), JSON.stringify({
      phase: 'published',
      originalArtifacts: ['skills'],
      backedUpArtifacts: ['skills'],
      publishedArtifacts: ['skills'],
      metadata: {
        mutation: { action: 'install', source: 'owner/repo' },
        context: { defaultBundleCommitSha: 'sha' },
      },
      metadataCommitted: false,
    }));
    const metadata: SkillsManagementMetadataPort = {
      mutationPublished: jest.fn(),
    };
    const coordinator = new SkillsManagementCoordinator({
      service: new VaultSkillsService(vaultPath),
      vaultPath,
      metadata,
    });

    await coordinator.prepareWorkspace();

    expect(metadata.mutationPublished).toHaveBeenCalledWith(
      { action: 'install', source: 'owner/repo' },
      { defaultBundleCommitSha: 'sha' },
    );
    expect(fs.readFileSync(path.join(live, 'SKILL.md'), 'utf8')).toBe('new');
    expect(fs.existsSync(transaction)).toBe(false);
  });

  it('waits for recovered metadata before completing workspace preparation', async () => {
    const transaction = path.join(vaultPath, '.pivi', '.skills-transaction-crash');
    const live = path.join(vaultPath, '.pivi', 'skills');
    fs.mkdirSync(path.join(transaction, 'previous', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(live, 'SKILL.md'), 'new');
    fs.writeFileSync(path.join(transaction, 'transaction.json'), JSON.stringify({
      phase: 'published',
      originalArtifacts: ['skills'],
      backedUpArtifacts: ['skills'],
      publishedArtifacts: ['skills'],
      metadata: { mutation: { action: 'install', source: 'owner/repo' } },
      metadataCommitted: false,
    }));
    let releaseMetadata!: () => void;
    const metadataPending = new Promise<void>(resolve => { releaseMetadata = resolve; });
    const coordinator = new SkillsManagementCoordinator({
      service: new VaultSkillsService(vaultPath),
      vaultPath,
      metadata: { mutationPublished: jest.fn(() => metadataPending) },
    });

    let prepared = false;
    const preparation = coordinator.prepareWorkspace().then(() => { prepared = true; });
    await Promise.resolve();
    expect(prepared).toBe(false);
    expect(fs.existsSync(transaction)).toBe(true);

    releaseMetadata();
    await preparation;
    expect(prepared).toBe(true);
    expect(fs.existsSync(transaction)).toBe(false);
  });

  it('blocks newer work when recovered metadata cannot be persisted', async () => {
    const transaction = path.join(vaultPath, '.pivi', '.skills-transaction-crash');
    const live = path.join(vaultPath, '.pivi', 'skills');
    fs.mkdirSync(path.join(transaction, 'previous', 'skills'), { recursive: true });
    fs.writeFileSync(path.join(live, 'SKILL.md'), 'new');
    fs.writeFileSync(path.join(transaction, 'transaction.json'), JSON.stringify({
      phase: 'published',
      originalArtifacts: ['skills'],
      backedUpArtifacts: ['skills'],
      publishedArtifacts: ['skills'],
      metadata: { mutation: { action: 'install', source: 'owner/repo' } },
      metadataCommitted: false,
    }));
    const coordinator = new SkillsManagementCoordinator({
      service: new VaultSkillsService(vaultPath),
      vaultPath,
      metadata: { mutationPublished: jest.fn(async () => { throw new Error('settings unavailable'); }) },
    });

    await expect(coordinator.prepareWorkspace()).rejects.toThrow('settings unavailable');
    expect(fs.existsSync(transaction)).toBe(true);
  });
});
