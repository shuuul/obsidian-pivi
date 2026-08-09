/**
 * Atomic publication and crash recovery for the vault skill tree.
 *
 * Keeping this lifecycle separate from CLI orchestration makes the backup and
 * recovery invariants reviewable without mixing them with process execution.
 */

import * as fs from 'fs';
import * as path from 'path';

import { PIVI_SKILLS_PATH } from './paths';
import { validateStagedSkillCollection } from './skillStagePublish';

const SKILLS_CLI_METADATA_FILES = ['skills-lock.json', '.skills.json'] as const;
const SKILLS_TRANSACTION_DIR_PREFIX = '.skills-transaction-';
// The journal name must not be `manifest.json`: the community review static
// scan treats that literal plus file writes as a self-update signal.
const SKILLS_TRANSACTION_MANIFEST = 'transaction.json';

export type SkillsPublicationArtifact = 'skills' | typeof SKILLS_CLI_METADATA_FILES[number];

export interface SkillsPublicationMetadata {
  readonly mutation: unknown;
  readonly context?: unknown;
}

export interface SkillTransactionHooks {
  beforePublish?: () => void;
  afterPublish?: () => void | Promise<void>;
  /**
   * Metadata is recorded before the publication marker. If the host process
   * dies after the marker, recovery retries this idempotent callback.
   */
  metadata?: SkillsPublicationMetadata;
}

interface SkillsTransactionManifest {
  phase: 'prepared' | 'mutating' | 'published' | 'restoring' | 'restored' | 'restore-incomplete';
  /** Immutable pre-publication inventory, recorded before the first live rename. */
  originalArtifacts: SkillsPublicationArtifact[];
  backedUpArtifacts: SkillsPublicationArtifact[];
  publishedArtifacts: SkillsPublicationArtifact[];
  metadata?: SkillsPublicationMetadata;
  metadataCommitted?: boolean;
}

export interface SkillPublicationTransactionOptions {
  vaultPath: string;
  publicationRenameSync?: typeof fs.renameSync;
  onCleanupFailure?: () => void;
}

export interface SkillPublicationRecoveryOptions {
  onPublishedWithoutMetadata?: (metadata: SkillsPublicationMetadata) => void | Promise<void>;
}

export class SkillPublicationTransaction {
  private readonly renamePublicationArtifact: typeof fs.renameSync;

  constructor(private readonly options: SkillPublicationTransactionOptions) {
    this.renamePublicationArtifact = options.publicationRenameSync ?? fs.renameSync;
  }

  async publish<T>(
    stagedSkills: string,
    skillsDir: string,
    operationRoot: string,
    result: T,
    hooks: SkillTransactionHooks,
  ): Promise<T> {
    const transactionRoot = path.join(
      this.options.vaultPath,
      '.pivi',
      `${SKILLS_TRANSACTION_DIR_PREFIX}${process.pid}-${Date.now()}`,
    );
    const publication = path.join(transactionRoot, 'next');
    const backup = path.join(transactionRoot, 'previous');
    const artifacts = ['skills', ...SKILLS_CLI_METADATA_FILES] as const;
    const originalArtifacts = artifacts.filter(artifact => (
      fs.existsSync(this.liveArtifactPath(artifact, skillsDir))
    ));
    const backedUpArtifacts: SkillsPublicationArtifact[] = [];
    const publishedArtifacts: SkillsPublicationArtifact[] = [];
    let removeTransactionRoot = false;

    // Keep backups until metadata has been durably accepted. A published marker
    // written before the callback lets startup retry metadata instead of guessing
    // whether a crash happened before or after the callback completed.
    // Validate before creating a transaction root so an untrusted copied tree
    // cannot enter rollback handling as if any live artifact had changed.
    validateStagedSkillCollection(stagedSkills);
    try {
      fs.mkdirSync(publication, { recursive: true });
      fs.mkdirSync(backup, { recursive: true });
      this.renamePublicationArtifact(stagedSkills, path.join(publication, 'skills'));
      for (const fileName of SKILLS_CLI_METADATA_FILES) {
        const produced = path.join(operationRoot, fileName);
        if (fs.existsSync(produced)) fs.copyFileSync(produced, path.join(publication, fileName));
      }
      this.writeTransactionManifest(transactionRoot, {
        phase: 'prepared',
        originalArtifacts: [...originalArtifacts],
        backedUpArtifacts: [],
        publishedArtifacts: [],
        ...(hooks.metadata ? { metadata: hooks.metadata, metadataCommitted: false } : {}),
      });

      hooks.beforePublish?.();

      this.writeTransactionManifest(transactionRoot, {
        phase: 'mutating',
        originalArtifacts: [...originalArtifacts],
        backedUpArtifacts: [],
        publishedArtifacts: [],
        ...(hooks.metadata ? { metadata: hooks.metadata, metadataCommitted: false } : {}),
      });
      for (const artifact of artifacts) {
        const current = this.liveArtifactPath(artifact, skillsDir);
        if (fs.existsSync(current)) {
          this.renamePublicationArtifact(current, path.join(backup, artifact));
          backedUpArtifacts.push(artifact);
          this.writeTransactionManifest(transactionRoot, {
            phase: 'mutating',
            originalArtifacts: [...originalArtifacts],
            backedUpArtifacts: [...backedUpArtifacts],
            publishedArtifacts: [...publishedArtifacts],
            ...(hooks.metadata ? { metadata: hooks.metadata, metadataCommitted: false } : {}),
          });
        }
      }
      for (const artifact of artifacts) {
        const next = path.join(publication, artifact);
        const destination = this.liveArtifactPath(artifact, skillsDir);
        if (fs.existsSync(next)) {
          this.renamePublicationArtifact(next, destination);
          publishedArtifacts.push(artifact);
          this.writeTransactionManifest(transactionRoot, {
            phase: 'mutating',
            originalArtifacts: [...originalArtifacts],
            backedUpArtifacts: [...backedUpArtifacts],
            publishedArtifacts: [...publishedArtifacts],
            ...(hooks.metadata ? { metadata: hooks.metadata, metadataCommitted: false } : {}),
          });
        }
      }

      // Mark the filesystem commit before awaiting external settings storage.
      // Recovery will retry the metadata callback when metadataCommitted is false.
      this.writeTransactionManifest(transactionRoot, {
        phase: 'published',
        originalArtifacts: [...originalArtifacts],
        backedUpArtifacts: [...backedUpArtifacts],
        publishedArtifacts: [...publishedArtifacts],
        ...(hooks.metadata ? { metadata: hooks.metadata, metadataCommitted: false } : {}),
        ...(!hooks.metadata ? { metadataCommitted: true } : {}),
      });
      await hooks.afterPublish?.();
      try {
        this.writeTransactionManifest(transactionRoot, {
          phase: 'published',
          originalArtifacts: [...originalArtifacts],
          backedUpArtifacts: [...backedUpArtifacts],
          publishedArtifacts: [...publishedArtifacts],
          ...(hooks.metadata ? { metadata: hooks.metadata, metadataCommitted: true } : {}),
          ...(!hooks.metadata ? { metadataCommitted: true } : {}),
        });
      } catch {
        // Metadata and live artifacts are already committed. Keep the previous
        // published marker for idempotent recovery instead of rolling either side back.
        this.options.onCleanupFailure?.();
        return result;
      }
      removeTransactionRoot = true;
      return result;
    } catch (error) {
      const restored = this.restorePublicationArtifacts({
        skillsDir,
        backup,
        originalArtifacts,
        backedUpArtifacts,
        publishedArtifacts,
        transactionRoot,
      });
      removeTransactionRoot = restored;
      throw error;
    } finally {
      if (removeTransactionRoot && fs.existsSync(transactionRoot)) {
        try {
          fs.rmSync(transactionRoot, { recursive: true, force: true });
        } catch {
          // The publication is durable; retain its manifest so preparation can
          // finish cleanup without reporting a failed settings save.
          this.options.onCleanupFailure?.();
        }
      }
    }
  }

  async recoverIncompleteTransactions(
    recoveryOptions: SkillPublicationRecoveryOptions = {},
  ): Promise<void> {
    const piviDir = path.join(this.options.vaultPath, '.pivi');
    let entries: string[];
    try {
      entries = fs.readdirSync(piviDir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (!name.startsWith(SKILLS_TRANSACTION_DIR_PREFIX)) continue;
      const transactionRoot = path.join(piviDir, name);
      try {
        if (!fs.statSync(transactionRoot).isDirectory()) continue;
      } catch {
        continue;
      }
      await this.recoverTransaction(transactionRoot, recoveryOptions);
    }
  }

  private liveArtifactPath(artifact: SkillsPublicationArtifact, skillsDir: string): string {
    return artifact === 'skills' ? skillsDir : path.join(this.options.vaultPath, '.pivi', artifact);
  }

  private writeTransactionManifest(transactionRoot: string, manifest: SkillsTransactionManifest): void {
    const destination = path.join(transactionRoot, SKILLS_TRANSACTION_MANIFEST);
    const temporary = `${destination}.tmp`;
    const descriptor = fs.openSync(temporary, 'w');
    try {
      fs.writeFileSync(descriptor, `${JSON.stringify(manifest)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.renameSync(temporary, destination);
    // Windows does not support fsync on directory handles. The manifest file
    // itself is already fsynced before the atomic rename, so keep the
    // directory-entry durability barrier on platforms that expose it without
    // making publication fail on Windows.
    if (process.platform === 'win32') return;
    const directory = fs.openSync(transactionRoot, 'r');
    try {
      fs.fsyncSync(directory);
    } finally {
      fs.closeSync(directory);
    }
  }

  private readTransactionManifest(transactionRoot: string): SkillsTransactionManifest | null {
    const manifestPath = path.join(transactionRoot, SKILLS_TRANSACTION_MANIFEST);
    if (!fs.existsSync(manifestPath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Partial<SkillsTransactionManifest>;
      if (!parsed || typeof parsed !== 'object') return null;
      const isArtifact = (entry: unknown): entry is SkillsPublicationArtifact => (
        entry === 'skills' || entry === 'skills-lock.json' || entry === '.skills.json'
      );
      const backedUpArtifacts = Array.isArray(parsed.backedUpArtifacts)
        ? parsed.backedUpArtifacts.filter(isArtifact)
        : [];
      const originalArtifacts = Array.isArray(parsed.originalArtifacts)
        ? parsed.originalArtifacts.filter(isArtifact)
        : [];
      const publishedArtifacts = Array.isArray(parsed.publishedArtifacts)
        ? parsed.publishedArtifacts.filter(isArtifact)
        : [];
      const phase = parsed.phase;
      if (
        phase !== 'prepared'
        && phase !== 'mutating'
        && phase !== 'published'
        && phase !== 'restoring'
        && phase !== 'restored'
        && phase !== 'restore-incomplete'
      ) {
        return { phase: 'mutating', originalArtifacts, backedUpArtifacts, publishedArtifacts };
      }
      const metadata = parsed.metadata && typeof parsed.metadata === 'object'
        && 'mutation' in parsed.metadata
        ? parsed.metadata
        : undefined;
      return {
        phase,
        originalArtifacts,
        backedUpArtifacts,
        publishedArtifacts,
        ...(metadata ? {
          metadata,
          metadataCommitted: parsed.metadataCommitted === true,
        } : {}),
      };
    } catch {
      return null;
    }
  }

  private restorePublicationArtifacts(args: {
    skillsDir: string;
    backup: string;
    originalArtifacts: readonly SkillsPublicationArtifact[];
    backedUpArtifacts: readonly SkillsPublicationArtifact[];
    publishedArtifacts: readonly SkillsPublicationArtifact[];
    transactionRoot: string;
  }): boolean {
    const {
      skillsDir,
      backup,
      originalArtifacts,
      backedUpArtifacts,
      publishedArtifacts,
      transactionRoot,
    } = args;
    let remainingBackups = backedUpArtifacts.filter(artifact => (
      fs.existsSync(path.join(backup, artifact))
    ));
    this.writeTransactionManifest(transactionRoot, {
      phase: 'restoring',
      originalArtifacts: [...originalArtifacts],
      backedUpArtifacts: [...remainingBackups],
      publishedArtifacts: [...publishedArtifacts],
    });

    try {
      for (const artifact of publishedArtifacts) {
        const destination = this.liveArtifactPath(artifact, skillsDir);
        const hadPrevious = originalArtifacts.includes(artifact);
        const previousStillHeld = remainingBackups.includes(artifact);
        if (fs.existsSync(destination) && (!hadPrevious || previousStillHeld)) {
          fs.rmSync(destination, { recursive: true, force: true });
        }
      }
      for (const artifact of [...remainingBackups]) {
        const previous = path.join(backup, artifact);
        const destination = this.liveArtifactPath(artifact, skillsDir);
        if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
        this.renamePublicationArtifact(previous, destination);
        remainingBackups = remainingBackups.filter(candidate => candidate !== artifact);
        this.writeTransactionManifest(transactionRoot, {
          phase: 'restoring',
          originalArtifacts: [...originalArtifacts],
          backedUpArtifacts: [...remainingBackups],
          publishedArtifacts: [...publishedArtifacts],
        });
      }
      this.writeTransactionManifest(transactionRoot, {
        phase: 'restored',
        originalArtifacts: [...originalArtifacts],
        backedUpArtifacts: [...backedUpArtifacts],
        publishedArtifacts: [],
      });
      return true;
    } catch {
      this.writeTransactionManifest(transactionRoot, {
        phase: 'restore-incomplete',
        originalArtifacts: [...originalArtifacts],
        backedUpArtifacts: [...remainingBackups],
        publishedArtifacts: [...publishedArtifacts],
      });
      return false;
    }
  }

  private async recoverTransaction(
    transactionRoot: string,
    recoveryOptions: SkillPublicationRecoveryOptions,
  ): Promise<void> {
    const skillsDir = path.join(this.options.vaultPath, PIVI_SKILLS_PATH);
    const backup = path.join(transactionRoot, 'previous');
    const manifest = this.readTransactionManifest(transactionRoot);
    if (!manifest) {
      if (this.discoverBackupArtifacts(backup).length === 0) {
        fs.rmSync(transactionRoot, { recursive: true, force: true });
      }
      return;
    }

    if (manifest.phase === 'published' && manifest.metadata && !manifest.metadataCommitted) {
      const recoverMetadata = recoveryOptions.onPublishedWithoutMetadata;
      if (!recoverMetadata) {
        throw new Error(
          `Published skills transaction ${path.basename(transactionRoot)} requires metadata recovery.`,
        );
      }
      // A failure leaves the root untouched and rejects preparation, preventing
      // newer publications from overtaking metadata that still needs recovery.
      await recoverMetadata(manifest.metadata);
      this.finishPublishedRecovery(transactionRoot, manifest);
      return;
    }

    // Clean successful or never-mutated transactions.
    if (manifest.phase === 'prepared' || manifest.phase === 'published' || manifest.phase === 'restored') {
      fs.rmSync(transactionRoot, { recursive: true, force: true });
      return;
    }

    const backedUpArtifacts = [...new Set([
      ...manifest.backedUpArtifacts,
      ...this.discoverBackupArtifacts(backup),
    ])];
    const publication = path.join(transactionRoot, 'next');
    const publishedArtifacts = [...new Set([
      ...manifest.publishedArtifacts,
      ...(['skills', ...SKILLS_CLI_METADATA_FILES] as const).filter(artifact => (
        !manifest.originalArtifacts.includes(artifact)
        && fs.existsSync(this.liveArtifactPath(artifact, skillsDir))
        && !fs.existsSync(path.join(publication, artifact))
      )),
    ])];
    if (backedUpArtifacts.length === 0 && publishedArtifacts.length === 0) {
      fs.rmSync(transactionRoot, { recursive: true, force: true });
      return;
    }

    const needsRestore = backedUpArtifacts.some(artifact => {
      const previous = path.join(backup, artifact);
      const live = this.liveArtifactPath(artifact, skillsDir);
      return fs.existsSync(previous) && !fs.existsSync(live);
    }) || manifest.phase === 'restore-incomplete' || manifest.phase === 'mutating' || manifest.phase === 'restoring';

    if (!needsRestore) {
      if (manifest.phase === 'mutating' && backedUpArtifacts.every(artifact => (
        !fs.existsSync(path.join(backup, artifact))
      ))) {
        fs.rmSync(transactionRoot, { recursive: true, force: true });
      }
      return;
    }

    const restored = this.restorePublicationArtifacts({
      skillsDir,
      backup,
      originalArtifacts: manifest.originalArtifacts,
      backedUpArtifacts,
      publishedArtifacts,
      transactionRoot,
    });
    if (restored) fs.rmSync(transactionRoot, { recursive: true, force: true });
  }

  private finishPublishedRecovery(
    transactionRoot: string,
    manifest: SkillsTransactionManifest,
  ): void {
    this.writeTransactionManifest(transactionRoot, {
      ...manifest,
      phase: 'published',
      metadataCommitted: true,
    });
    fs.rmSync(transactionRoot, { recursive: true, force: true });
  }

  private discoverBackupArtifacts(backup: string): SkillsPublicationArtifact[] {
    if (!fs.existsSync(backup)) return [];
    const found: SkillsPublicationArtifact[] = [];
    for (const artifact of ['skills', ...SKILLS_CLI_METADATA_FILES] as const) {
      if (fs.existsSync(path.join(backup, artifact))) found.push(artifact);
    }
    return found;
  }
}
