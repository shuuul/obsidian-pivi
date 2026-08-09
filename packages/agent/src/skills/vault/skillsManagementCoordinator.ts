import { createHash } from 'node:crypto';

import * as fs from 'fs';
import * as path from 'path';

import { PluginLogger } from '../../foundation/pluginLogger';
import type {
  AgentSkillSummary,
  PiviSkillsInput,
  PiviSkillsListRemoteResult,
  PiviSkillsListResult,
} from '../../tools/piviManagement';
import { PiviManagementError } from '../../tools/piviManagement';
import type { SkillsPublicationMetadata } from './skillPublicationTransaction';
import { normalizeSkillSlug, type VaultSkillEntry, type VaultSkillsService } from './vaultSkillsService';

export type SkillsManagementMutation = Exclude<PiviSkillsInput, { action: 'list' | 'list_remote' }>;

export interface SkillsManagementPlan {
  revision: string;
  mutation: SkillsManagementMutation;
}

export interface SkillsManagementCommitResult {
  revision: string;
  skills: AgentSkillSummary[];
  refreshed: boolean;
  warnings?: string[];
  refreshFailures?: Array<{ target: string; message: string }>;
}

interface SkillsLockEntry {
  source?: string;
  skillPath?: string;
}

export interface SkillsManagementCoordinatorOptions {
  service: VaultSkillsService;
  vaultPath: string;
  published?(): Promise<void> | void;
  metadata?: SkillsManagementMetadataPort;
}

/**
 * Product-owned default-bundle bookkeeping.
 * Invoked inside the filesystem publication transaction (after live artifacts
 * land, before cleanup) so a throw rolls the skill tree back.
 */
export interface SkillsManagementMetadataPort {
  mutationPublished(
    mutation: SkillsManagementMutation,
    context?: SkillsManagementMetadataContext,
  ): Promise<void> | void;
}

export interface SkillsManagementMetadataContext {
  readonly defaultBundleCommitSha?: string | null;
  readonly defaultBundleUpdate?: boolean;
}

const GENERIC_REFRESH_FAILURE = 'Runtime refresh failed.';
const GENERIC_METADATA_FAILURE = 'Metadata refresh failed.';
const GENERIC_SNAPSHOT_FAILURE = 'Skills snapshot refresh failed.';
const logger = new PluginLogger('SkillsManagement');

function packageMetadata(vaultPath: string): Record<string, SkillsLockEntry> {
  const lockPath = path.join(vaultPath, '.pivi', 'skills-lock.json');
  if (!fs.existsSync(lockPath)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { skills?: unknown };
    if (
      !parsed
      || typeof parsed !== 'object'
      || !parsed.skills
      || typeof parsed.skills !== 'object'
      || Array.isArray(parsed.skills)
    ) {
      return {};
    }
    const valid: Record<string, SkillsLockEntry> = {};
    for (const [name, value] of Object.entries(parsed.skills)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        logger.warn(`Skipped invalid skills-lock entry "${name}".`);
        continue;
      }
      const candidate = value as { source?: unknown; skillPath?: unknown };
      if (
        (candidate.source !== undefined && typeof candidate.source !== 'string')
        || (candidate.skillPath !== undefined && typeof candidate.skillPath !== 'string')
      ) {
        logger.warn(`Skipped invalid skills-lock entry "${name}".`);
        continue;
      }
      valid[name] = {
        ...(typeof candidate.source === 'string' ? { source: candidate.source } : {}),
        ...(typeof candidate.skillPath === 'string' ? { skillPath: candidate.skillPath } : {}),
      };
    }
    return valid;
  } catch {
    return {};
  }
}

function fingerprintSkillsState(vaultPath: string): string {
  const hash = createHash('sha256');
  const roots = [
    path.join(vaultPath, '.pivi', 'skills'),
    path.join(vaultPath, '.pivi', 'skills-lock.json'),
    path.join(vaultPath, '.pivi', '.skills.json'),
  ];
  const visit = (target: string, relative: string): void => {
    if (!fs.existsSync(target)) {
      hash.update(`missing\0${relative}\0`);
      return;
    }
    const stat = fs.lstatSync(target);
    hash.update(`${stat.isDirectory() ? 'dir' : stat.isSymbolicLink() ? 'link' : 'file'}\0${relative}\0`);
    if (stat.isSymbolicLink()) {
      hash.update(fs.readlinkSync(target));
    } else if (stat.isDirectory()) {
      for (const name of fs.readdirSync(target).sort()) visit(path.join(target, name), `${relative}/${name}`);
    } else {
      hash.update(fs.readFileSync(target));
    }
    hash.update('\0');
  };
  for (const root of roots) visit(root, path.relative(vaultPath, root).replace(/\\/g, '/'));
  return hash.digest('hex');
}

function project(entries: readonly VaultSkillEntry[], metadata: Record<string, SkillsLockEntry>): AgentSkillSummary[] {
  return entries.map(entry => {
    const provenance = Object.entries(metadata).find(([name, value]) => (
      name === entry.name
      || name === entry.folderName
      || path.basename(path.dirname(value.skillPath ?? '')) === entry.folderName
    ))?.[1];
    return {
      name: entry.name,
      description: entry.description,
      folderName: entry.folderName,
      enabled: !entry.disabled,
      ...(provenance?.source ? { packageSource: provenance.source } : {}),
    };
  });
}

/** One serialized authority shared by Settings and future Agent transactions. */
export class SkillsManagementCoordinator {
  private tail: Promise<void> = Promise.resolve();

  constructor(private readonly options: SkillsManagementCoordinatorOptions) {}

  async prepareWorkspace(): Promise<void> {
    await this.options.service.prepareWorkspace((metadata) => {
      if (!this.options.metadata) return;
      const pending = metadata;
      return this.options.metadata.mutationPublished(
        pending.mutation as SkillsManagementMutation,
        pending.context as SkillsManagementMetadataContext | undefined,
      );
    });
  }

  snapshot(): PiviSkillsListResult & { revision: string } {
    const metadata = packageMetadata(this.options.vaultPath);
    const skills = project(this.options.service.list(), metadata);
    return { skills, revision: fingerprintSkillsState(this.options.vaultPath) };
  }

  listRemote(source: string, signal?: AbortSignal): Promise<PiviSkillsListRemoteResult> {
    return this.enqueue(async () => ({
      source: normalizeSkillSlug(source),
      skills: await this.options.service.listRemoteSkills(source, signal),
    }));
  }

  plan(mutation: SkillsManagementMutation): SkillsManagementPlan {
    return { revision: this.snapshot().revision, mutation: structuredClone(mutation) };
  }

  commit(
    plan: SkillsManagementPlan,
    expectedRevision = plan.revision,
    signal?: AbortSignal,
    metadataContext?: SkillsManagementMetadataContext,
  ): Promise<SkillsManagementCommitResult> {
    return this.enqueue(async () => {
      signal?.throwIfAborted();
      if (expectedRevision !== plan.revision || this.snapshot().revision !== expectedRevision) {
        throw new PiviManagementError('state_changed', 'Skills state changed after this operation was planned.');
      }
      const mutation = this.normalizeMutation(plan.mutation);
      const metadataMutation = mutation.action === 'remove'
        ? { ...mutation, name: this.requireSkill(mutation.name).folderName }
        : mutation;
      // Default-bundle metadata is part of publication compensation whenever a
      // mutation replaces or removes the managed tree.
      const transactionalMetadata = plan.mutation.action === 'install'
        || plan.mutation.action === 'update'
        || plan.mutation.action === 'update_all'
        || plan.mutation.action === 'remove';
      await this.apply(mutation, signal, {
        beforePublish: () => {
          signal?.throwIfAborted();
          if (this.snapshot().revision !== expectedRevision) {
            throw new PiviManagementError('state_changed', 'Skills state changed while this operation was running.');
          }
        },
        afterPublish: transactionalMetadata
          ? async () => {
            await this.options.metadata?.mutationPublished(metadataMutation, metadataContext);
          }
          : undefined,
        ...(transactionalMetadata && this.options.metadata ? {
          metadata: { mutation: metadataMutation, context: metadataContext },
        } : {}),
      });
      if (!transactionalMetadata) {
        // Non-publication mutations still need durable bookkeeping; failure here means
        // FS saved but metadata may be stale — report refreshed:false, do not reject.
        try {
          await this.options.metadata?.mutationPublished(metadataMutation, metadataContext);
        } catch {
          return this.commitResultAfterSave({
            refreshFailures: [{ target: 'skills:metadata', message: GENERIC_METADATA_FAILURE }],
          });
        }
      }
      return this.finishAfterDurableSave();
    });
  }

  execute(
    mutation: SkillsManagementMutation,
    signal?: AbortSignal,
    metadataContext?: SkillsManagementMetadataContext,
  ): Promise<SkillsManagementCommitResult> {
    return this.commit(this.plan(mutation), undefined, signal, metadataContext);
  }

  updateDefaultBundle(
    skipFolders: ReadonlySet<string>,
    metadataContext?: SkillsManagementMetadataContext,
  ): Promise<SkillsManagementCommitResult> {
    return this.enqueue(async () => {
      await this.options.service.upgradeDefaultBundle(skipFolders, {
        afterPublish: () => this.options.metadata?.mutationPublished(
          { action: 'update_all' },
          { ...metadataContext, defaultBundleUpdate: true },
        ),
        ...(this.options.metadata ? {
          metadata: {
            mutation: { action: 'update_all' },
            context: { ...metadataContext, defaultBundleUpdate: true },
          },
        } : {}),
      });
      return this.finishAfterDurableSave();
    });
  }

  private async finishAfterDurableSave(): Promise<SkillsManagementCommitResult> {
    const refreshFailures: Array<{ target: string; message: string }> = [];
    if (this.options.service.consumeCleanupFailure()) {
      refreshFailures.push({ target: 'skills:cleanup', message: 'Transaction cleanup failed.' });
    }
    try {
      await this.options.published?.();
    } catch {
      refreshFailures.push({ target: 'skills:runtime', message: GENERIC_REFRESH_FAILURE });
    }
    return this.commitResultAfterSave({ refreshFailures });
  }

  /**
   * Post-save snapshot/refresh failures must not reject: durable skill tree is already
   * committed. Return saved semantics via refreshed:false + sanitized failures.
   */
  private commitResultAfterSave(args: {
    refreshFailures: Array<{ target: string; message: string }>;
  }): SkillsManagementCommitResult {
    const refreshFailures = [...args.refreshFailures];
    let revision = '';
    let skills: AgentSkillSummary[] = [];
    try {
      const next = this.snapshot();
      revision = next.revision;
      skills = next.skills;
    } catch {
      refreshFailures.push({ target: 'skills:snapshot', message: GENERIC_SNAPSHOT_FAILURE });
    }
    const failed = refreshFailures.length > 0;
    return {
      revision,
      skills,
      refreshed: !failed,
      ...(failed ? {
        warnings: ['Skills were saved, but some post-save refresh work failed.'],
        refreshFailures,
      } : {}),
    };
  }

  private async apply(
    mutation: SkillsManagementMutation,
    signal: AbortSignal | undefined,
    hooks: {
      beforePublish?: () => void;
      afterPublish?: () => void | Promise<void>;
      metadata?: SkillsPublicationMetadata;
    },
  ): Promise<void> {
    switch (mutation.action) {
      case 'install':
        await this.options.service.installFromSource(mutation.source, {
          skillNames: mutation.skillNames,
          signal,
          beforePublish: hooks.beforePublish,
          afterPublish: hooks.afterPublish,
          metadata: hooks.metadata,
        });
        return;
      case 'set_enabled': {
        const skill = this.requireSkill(mutation.name);
        hooks.beforePublish?.();
        this.options.service.setSkillDisabled(skill.folderName, !mutation.enabled);
        return;
      }
      case 'update': {
        const skill = this.requireSkill(mutation.name);
        const metadata = packageMetadata(this.options.vaultPath);
        const updateIdentity = Object.entries(metadata).find(([name, value]) => (
          name === skill.name || name === skill.folderName
          || path.basename(path.dirname(value.skillPath ?? '')) === skill.folderName
        ))?.[0];
        if (!updateIdentity) throw new Error(`No package provenance is stored for Skill "${mutation.name}".`);
        await this.options.service.updateSkill(updateIdentity, skill.folderName, signal, {
          beforePublish: hooks.beforePublish,
          afterPublish: hooks.afterPublish,
          metadata: hooks.metadata,
        });
        return;
      }
      case 'update_all':
        await this.options.service.updateAll(signal, {
          beforePublish: hooks.beforePublish,
          afterPublish: hooks.afterPublish,
          metadata: hooks.metadata,
        });
        return;
      case 'remove':
        await this.options.service.removeTransactional(
          this.options.service.list().find(entry => (
            entry.name === mutation.name || entry.folderName === mutation.name
          ))?.folderName ?? mutation.name,
          hooks,
        );
        return;
    }
  }

  private normalizeMutation(mutation: SkillsManagementMutation): SkillsManagementMutation {
    if (mutation.action !== 'install') return structuredClone(mutation);
    return {
      ...structuredClone(mutation),
      source: normalizeSkillSlug(mutation.source),
    };
  }

  private requireSkill(identity: string): VaultSkillEntry {
    const skill = this.options.service.list().find(entry => (
      entry.name === identity || entry.folderName === identity
    ));
    if (!skill) throw new Error(`Skill not found: ${identity}`);
    return skill;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation, operation);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
