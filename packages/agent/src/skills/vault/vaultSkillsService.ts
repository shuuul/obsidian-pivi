import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ProcessRunner } from '../../ports';
import {
  DEFAULT_VAULT_SKILL_FOLDER_NAMES,
  DEFAULT_VAULT_SKILLS_SLUG,
} from './defaultVaultSkills';
import { getSpawnEnvWithEnhancedPath, type SkillsEnvironmentOptions } from './env';
import { loadVaultSkills, SKILL_DISABLED_MARKER } from './loadVaultSkills';
import { PIVI_SKILLS_PATH } from './paths';
import { resolvePinnedSkillsCli } from './resolvePinnedSkillsCli';
import {
  SkillPublicationTransaction,
  type SkillsPublicationMetadata,
  type SkillTransactionHooks as TransactionPublicationHooks,
} from './skillPublicationTransaction';
import {
  publishValidatedSkillTree,
  SkillStageValidationError,
  stageSkillTreeFromSource,
  validateStagedSkillCollection,
} from './skillStagePublish';

export interface VaultSkillsServiceOptions {
  processRunner?: ProcessRunner;
  processEnv?: NodeJS.ProcessEnv;
  environment?: SkillsEnvironmentOptions;
  /** Optional override for tests / composition (package root containing bin/cli.mjs). */
  skillsCliPackageRoot?: string;
  pluginDir?: string;
  /** Optional publication rename override for fault-injection tests. */
  publicationRenameSync?: typeof fs.renameSync;
}

export interface SyncCliSkillsOptions {
  /** Replace these folders under `.pivi/skills/` even when they already exist. */
  overwriteFolders?: ReadonlySet<string>;
}

export interface InstallSkillsOptions {
  /** Skill names to request from multi-skill repositories (`skills add --skill`). */
  skillNames?: string[];
  signal?: AbortSignal;
  beforePublish?: () => void;
  /**
   * Runs after live artifacts are published and before transaction cleanup.
   * Throwing rolls the publication back from retained backups.
   */
  afterPublish?: () => void | Promise<void>;
  metadata?: SkillsPublicationMetadata;
}

export interface SkillsPublicationHooks {
  beforePublish?: () => void;
  afterPublish?: () => void | Promise<void>;
  metadata?: SkillsPublicationMetadata;
}

export interface RemoteSkillEntry {
  name: string;
  description: string;
}


const SKILLS_INSTALL_TIMEOUT_MS = 120_000;

/** Candidate dirs where `skills add --copy` may place skills before Pivi sync. */
const SKILLS_CLI_SOURCE_ROOTS = [
  '.pivi/.agents/skills',
  '.pivi/.cursor/skills',
  '.pivi/skills',
  '.agents/skills',
  '.cursor/skills',
  'skills',
] as const;

const SKILLS_STAGING_ROOT = path.join('.pivi', 'skills-staging');

const SKILLS_CLI_METADATA_FILES = ['skills-lock.json', '.skills.json'] as const;

const ANSI_CSI_PATTERN = new RegExp(`${String.fromCharCode(27)}[[][0-?]*[ -/]*[@-~]`, 'g');

export interface VaultSkillEntry {
  name: string;
  description: string;
  folderName: string;
  disabled: boolean;
}

interface VaultSkillLike {
  name: string;
  description: string;
  filePath: string;
}

export function normalizeSkillSlug(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Enter a skills source.');
  }

  const skillsShMatch = trimmed.match(/skills\.sh\/([^/\s]+)\/([^/\s#?]+)/i);
  if (skillsShMatch) {
    return `${skillsShMatch[1]}/${skillsShMatch[2]}`;
  }

  return trimmed;
}

function normalizeRequestedSkillNames(skillNames?: string[]): string[] {
  return skillNames
    ?.map((name) => name.trim())
    .filter((name, index, names) => name.length > 0 && names.indexOf(name) === index) ?? [];
}

function stripAnsi(input: string): string {
  return input.replace(ANSI_CSI_PATTERN, '');
}

export function parseRemoteSkillsListOutput(output: string): RemoteSkillEntry[] {
  const skills: RemoteSkillEntry[] = [];
  let inAvailableSkills = false;

  for (const rawLine of stripAnsi(output).split(/\r?\n/)) {
    const line = rawLine.replace(/^[│┌└◇◒◐◓◑\s]+/, '').trim();
    if (!line) {
      continue;
    }
    if (line === 'Available Skills') {
      inAvailableSkills = true;
      continue;
    }
    if (!inAvailableSkills) {
      continue;
    }
    if (line.startsWith('Use --skill')) {
      break;
    }
    if (/^[\w.-]+$/.test(line)) {
      skills.push({ name: line, description: '' });
      continue;
    }

    const current = skills.at(-1);
    if (current) {
      current.description = current.description ? `${current.description} ${line}` : line;
    }
  }

  return skills;
}

function skillFolderName(skill: VaultSkillLike): string {
  return path.basename(path.dirname(skill.filePath));
}

function ensurePiviSkillsDir(vaultPath: string): string {
  const dir = path.join(vaultPath, PIVI_SKILLS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function copySkillTree(
  sourceDir: string,
  folderName: string,
  dest: string,
  existingBefore: Set<string>,
  installed: string[],
  vaultPath: string,
  overwriteFolders?: ReadonlySet<string>,
): boolean {
  const destDir = path.join(dest, folderName);
  if (path.resolve(sourceDir) === path.resolve(destDir)) {
    const overwrite = overwriteFolders?.has(folderName) ?? false;
    if (!overwrite && existingBefore.has(folderName)) {
      return false;
    }
    if (!installed.includes(folderName)) {
      installed.push(folderName);
    }
    return true;
  }

  const overwrite = overwriteFolders?.has(folderName) ?? false;
  if (!overwrite && (fs.existsSync(destDir) || existingBefore.has(folderName))) {
    return false;
  }

  const stagingRoot = path.join(vaultPath, SKILLS_STAGING_ROOT, `sync-${process.pid}-${Date.now()}`);
  try {
    const stagedDir = stageSkillTreeFromSource(sourceDir, stagingRoot, folderName);
    publishValidatedSkillTree({
      stagedDir,
      destinationDir: dest,
      folderName,
      preserveDisabledMarker: true,
    });
    if (!installed.includes(folderName)) {
      installed.push(folderName);
    }
    return true;
  } catch (error) {
    if (error instanceof SkillStageValidationError) {
      throw error;
    }
    throw error;
  } finally {
    if (fs.existsSync(stagingRoot)) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

/** Copy skill trees from CLI default locations into `.pivi/skills/`. */
export function syncCliSkillsIntoPivi(
  vaultPath: string,
  existingBefore: Set<string>,
  options?: SyncCliSkillsOptions,
): string[] {
  const dest = ensurePiviSkillsDir(vaultPath);
  const installed: string[] = [];
  const overwriteFolders = options?.overwriteFolders;

  for (const relativeRoot of SKILLS_CLI_SOURCE_ROOTS) {
    const sourceRoot = path.join(vaultPath, relativeRoot);
    if (!fs.existsSync(sourceRoot)) {
      continue;
    }

    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }

      const flatSkillDir = path.join(sourceRoot, entry.name);
      const skillMd = path.join(flatSkillDir, 'SKILL.md');
      if (fs.existsSync(skillMd)) {
        if (copySkillTree(flatSkillDir, entry.name, dest, existingBefore, installed, vaultPath, overwriteFolders)) {
          continue;
        }
      }

      const nestedSkillsRoot = path.join(flatSkillDir, 'skills');
      if (!fs.existsSync(nestedSkillsRoot)) {
        continue;
      }

      for (const nested of fs.readdirSync(nestedSkillsRoot, { withFileTypes: true })) {
        if (!nested.isDirectory()) {
          continue;
        }

        const nestedSkillDir = path.join(nestedSkillsRoot, nested.name);
        if (!fs.existsSync(path.join(nestedSkillDir, 'SKILL.md'))) {
          continue;
        }

        copySkillTree(nestedSkillDir, nested.name, dest, existingBefore, installed, vaultPath, overwriteFolders);
      }
    }
  }

  return installed;
}

export class VaultSkillsService {
  private static readonly publicationTails = new Map<string, Promise<void>>();
  private cleanupFailurePending = false;
  private metadataRecovery?: (metadata: SkillsPublicationMetadata) => void | Promise<void>;
  constructor(
    private readonly vaultPath: string,
    private readonly options: VaultSkillsServiceOptions = {},
  ) {}

  consumeCleanupFailure(): boolean {
    const pending = this.cleanupFailurePending;
    this.cleanupFailurePending = false;
    return pending;
  }

  /** Explicit startup-only preparation. Queries and construction are intentionally read-only. */
  async prepareWorkspace(
    onPublishedWithoutMetadata?: (metadata: SkillsPublicationMetadata) => void | Promise<void>,
  ): Promise<void> {
    if (onPublishedWithoutMetadata) this.metadataRecovery = onPublishedWithoutMetadata;
    await this.withPublicationLock(() => this.prepareWorkspaceWithoutLock());
  }

  private async prepareWorkspaceWithoutLock(): Promise<void> {
    const dir = path.join(this.vaultPath, '.pivi');
    fs.mkdirSync(dir, { recursive: true });
    this.migrateRootSkillsCliMetadata(dir);
    await new SkillPublicationTransaction({
      vaultPath: this.vaultPath,
      publicationRenameSync: this.options.publicationRenameSync,
      onCleanupFailure: () => { this.cleanupFailurePending = true; },
    }).recoverIncompleteTransactions({
      onPublishedWithoutMetadata: this.metadataRecovery,
    });
  }

  private get processEnv(): NodeJS.ProcessEnv {
    return this.options.processEnv ?? process.env;
  }

  private get environment(): SkillsEnvironmentOptions | undefined {
    return this.options.environment;
  }

  list(): VaultSkillEntry[] {
    const { skills } = loadVaultSkills(this.vaultPath, { includeDisabled: true });
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      folderName: skillFolderName(skill),
      disabled: !!skill.disabled,
    }));
  }

  setSkillDisabled(folderName: string, disabled: boolean): void {
    const trimmed = folderName.trim();
    const safeName = path.basename(trimmed);
    if (!safeName || safeName === '.' || safeName === '..' || safeName !== trimmed) {
      throw new Error('Invalid skill folder name.');
    }
    const skillDir = path.join(this.ensurePiviSkillsDir(), safeName);
    if (!fs.existsSync(skillDir)) {
      throw new Error(`Skill folder not found: ${safeName}`);
    }
    const markerPath = path.join(skillDir, SKILL_DISABLED_MARKER);
    if (disabled) {
      fs.writeFileSync(markerPath, 'disabled\n', 'utf8');
    } else if (fs.existsSync(markerPath)) {
      fs.rmSync(markerPath, { force: true });
    }
  }

  async installFromSlug(slugInput: string, options?: InstallSkillsOptions): Promise<string[]> {
    return this.installFromSource(slugInput, options);
  }

  async installFromSource(sourceInput: string, options?: InstallSkillsOptions): Promise<string[]> {
    const source = normalizeSkillSlug(sourceInput);
    const skillNames = normalizeRequestedSkillNames(options?.skillNames);
    const piviSkillsDir = path.join(this.vaultPath, PIVI_SKILLS_PATH);
    const before = new Set(this.listDirNames(piviSkillsDir));
    return this.runIsolatedPublication(
      'install',
      {
        beforePublish: options?.beforePublish,
        afterPublish: options?.afterPublish,
        metadata: options?.metadata,
      },
      async (operationRoot) => {
        await this.runSkillsAdd(source, skillNames, operationRoot, options?.signal);
        const synced = this.importOperationSkills(operationRoot, before, undefined, operationRoot);
        if (synced.length === 0) {
          throw new Error('Install finished but the isolated skills operation produced no new Skill folders.');
        }
        return synced;
      },
    );
  }

  async listRemoteSkills(sourceInput: string, signal?: AbortSignal): Promise<RemoteSkillEntry[]> {
    const source = normalizeSkillSlug(sourceInput);
    const operationRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pivi-skills-list-'));
    try {
      const output = await this.runSkillsCommand(
        ['add', source, '--list'], 'list', operationRoot, signal, operationRoot,
      );
      return parseRemoteSkillsListOutput(output);
    } finally {
      fs.rmSync(operationRoot, { recursive: true, force: true });
    }
  }

  /**
   * Re-fetch kepano/obsidian-skills via the pinned skills CLI and refresh bundle folders (overwrite).
   * Skips folder names in `skipFolders` (user-removed defaults).
   */
  async upgradeDefaultBundle(
    skipFolders: ReadonlySet<string>,
    hooks?: SkillsPublicationHooks,
  ): Promise<string[]> {
    const bundleFolders = DEFAULT_VAULT_SKILL_FOLDER_NAMES.filter(
      (name) => !skipFolders.has(name),
    );
    if (bundleFolders.length === 0) {
      await this.withOperationRoot('default-update', root => (
        this.runSkillsAdd(DEFAULT_VAULT_SKILLS_SLUG, [], root)
      ));
      hooks?.beforePublish?.();
      await hooks?.afterPublish?.();
      return [];
    }

    return this.runIsolatedPublication(
      'default-update',
      hooks,
      async operationRoot => {
        await this.runSkillsAdd(DEFAULT_VAULT_SKILLS_SLUG, [], operationRoot);
        return this.importOperationSkills(operationRoot, new Set(), new Set(bundleFolders), operationRoot);
      },
    );
  }

  remove(folderName: string): void {
    const safeName = path.basename(folderName.trim());
    if (!safeName || safeName === '.' || safeName === '..') {
      throw new Error('Invalid skill folder name.');
    }

    const target = path.join(this.ensurePiviSkillsDir(), safeName);
    if (!fs.existsSync(target)) {
      throw new Error(`Skill folder not found: ${safeName}`);
    }

    fs.rmSync(target, { recursive: true, force: true });
  }

  async removeTransactional(folderName: string, hooks?: SkillsPublicationHooks): Promise<void> {
    const safeName = path.basename(folderName.trim());
    if (!safeName || safeName === '.' || safeName === '..' || safeName !== folderName.trim()) {
      throw new Error('Invalid skill folder name.');
    }
    const liveTarget = path.join(this.vaultPath, PIVI_SKILLS_PATH, safeName);
    if (!fs.existsSync(liveTarget)) throw new Error(`Skill folder not found: ${safeName}`);
    await this.runIsolatedPublication('remove', hooks, async operationRoot => {
      const stagedTarget = path.join(operationRoot, PIVI_SKILLS_PATH, safeName);
      fs.rmSync(stagedTarget, { recursive: true, force: true });
    });
  }

  async updateAll(signal?: AbortSignal, hooks?: SkillsPublicationHooks | (() => void)): Promise<string[]> {
    const folders = new Set(this.listDirNames(path.join(this.vaultPath, PIVI_SKILLS_PATH)));
    const publicationHooks = typeof hooks === 'function' ? { beforePublish: hooks } : hooks;
    return this.runIsolatedPublication('update-all', publicationHooks, async operationRoot => {
      await this.runSkillsUpdate([], operationRoot, signal);
      return this.importOperationSkills(operationRoot, new Set(), folders, operationRoot);
    });
  }

  async updateSkill(
    skillName: string,
    folderName: string,
    signal?: AbortSignal,
    hooks?: SkillsPublicationHooks | (() => void),
  ): Promise<string[]> {
    const normalizedSkillName = skillName.trim();
    const safeFolderName = path.basename(folderName.trim());
    if (!normalizedSkillName || !safeFolderName || safeFolderName === '.' || safeFolderName === '..') {
      throw new Error('Invalid skill name.');
    }

    const publicationHooks = typeof hooks === 'function' ? { beforePublish: hooks } : hooks;
    return this.runIsolatedPublication(
      'update',
      publicationHooks,
      async operationRoot => {
        await this.runSkillsUpdate([normalizedSkillName], operationRoot, signal);
        return this.importOperationSkills(operationRoot, new Set(), new Set([safeFolderName]), operationRoot);
      },
    );
  }

  private ensurePiviSkillsDir(): string {
    return ensurePiviSkillsDir(this.vaultPath);
  }

  private listDirNames(skillsDir: string): string[] {
    if (!fs.existsSync(skillsDir)) {
      return [];
    }
    return fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  }

  private ensurePiviWorkDir(): string {
    const dir = path.join(this.vaultPath, '.pivi');
    fs.mkdirSync(dir, { recursive: true });
    this.migrateRootSkillsCliMetadata(dir);
    return dir;
  }

  private migrateRootSkillsCliMetadata(piviDir: string): void {
    for (const fileName of SKILLS_CLI_METADATA_FILES) {
      const source = path.join(this.vaultPath, fileName);
      const dest = path.join(piviDir, fileName);
      if (!fs.existsSync(source)) {
        continue;
      }
      if (fs.existsSync(dest)) {
        if (fs.readFileSync(source, 'utf-8') === fs.readFileSync(dest, 'utf-8')) {
          fs.rmSync(source, { force: true });
        }
        continue;
      }
      fs.renameSync(source, dest);
    }
  }

  private runSkillsAdd(source: string, skillNames: string[] = [], cwd?: string, signal?: AbortSignal): Promise<void> {
    const args = ['add', source, '--copy', '-y'];
    for (const skillName of skillNames) {
      args.push('--skill', skillName);
    }
    return this.runSkillsCommand(args, 'add', cwd, signal).then(() => undefined);
  }

  private runSkillsUpdate(skillNames: string[] = [], cwd?: string, signal?: AbortSignal): Promise<void> {
    return this.runSkillsCommand(['update', ...skillNames, '-p', '-y'], 'update', cwd, signal)
      .then(() => undefined);
  }

  private async runSkillsCommand(
    args: string[], commandName: string, cwd?: string, signal?: AbortSignal, approvedRoot?: string,
  ): Promise<string> {
    if (!this.options.processRunner) {
      throw new Error('A ProcessRunner is required to run skills CLI commands.');
    }

    const cli = resolvePinnedSkillsCli({
      processEnv: this.processEnv,
      environment: this.environment,
      vaultPath: this.vaultPath,
      pluginDir: this.options.pluginDir,
      overridePackageRoot: this.options.skillsCliPackageRoot,
    });

    try {
      const env = getSpawnEnvWithEnhancedPath(undefined, this.processEnv, this.environment);
      const result = await this.options.processRunner.run({
        executable: cli.executable,
        args: [cli.cliPath, ...args],
        cwdPolicy: approvedRoot
          ? { mode: 'approved-root', root: approvedRoot }
          : { mode: 'vault', vaultRoot: this.vaultPath },
        cwd: cwd ?? path.join(this.vaultPath, '.pivi'),
        env,
        timeoutMs: SKILLS_INSTALL_TIMEOUT_MS,
        stdoutByteLimit: 1024 * 1024,
        stderrByteLimit: 1024 * 1024,
        shell: { mode: 'forbidden' },
        signal,
      });
      if (result.termination !== 'exit' || result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim()
          || result.spawnError
          || (result.signal ? `signal ${result.signal}` : `termination ${result.termination}`);
        throw new Error(`skills ${commandName} failed: ${detail}`);
      }
      return result.stdout;
    } finally {
      cli.cleanup?.();
    }
  }

  private async withOperationRoot<T>(
    name: string,
    operation: (root: string) => Promise<T>,
    prepare = true,
  ): Promise<T> {
    if (prepare) await this.prepareWorkspace();
    const root = fs.mkdtempSync(path.join(this.vaultPath, '.pivi', `skills-${name}-`));
    try {
      for (const fileName of SKILLS_CLI_METADATA_FILES) {
        const source = path.join(this.vaultPath, '.pivi', fileName);
        if (fs.existsSync(source)) fs.copyFileSync(source, path.join(root, fileName));
      }
      return await operation(root);
    } finally {
      try {
        fs.rmSync(root, { recursive: true, force: true });
      } catch {
        this.cleanupFailurePending = true;
      }
    }
  }

  private async runIsolatedPublication<T>(
    name: string,
    hooks: SkillsPublicationHooks | (() => void) | undefined,
    operation: (root: string) => Promise<T>,
  ): Promise<T> {
    const publicationHooks: TransactionPublicationHooks = typeof hooks === 'function'
      ? { beforePublish: hooks }
      : (hooks ?? {});
    return this.withPublicationLock(async () => {
      await this.prepareWorkspaceWithoutLock();
      return this.withOperationRoot(name, async root => {
        const skillsDir = path.join(this.vaultPath, PIVI_SKILLS_PATH);
        const stagedSkills = path.join(root, PIVI_SKILLS_PATH);
        if (fs.existsSync(skillsDir)) {
          // Validate before copying because Windows may dereference directory
          // junctions during cpSync, which would hide a symlink from the
          // staged-tree validator.
          validateStagedSkillCollection(skillsDir);
          fs.cpSync(skillsDir, stagedSkills, { recursive: true });
        }
        const result = await operation(root);
        return new SkillPublicationTransaction({
          vaultPath: this.vaultPath,
          publicationRenameSync: this.options.publicationRenameSync,
          onCleanupFailure: () => { this.cleanupFailurePending = true; },
        }).publish(stagedSkills, skillsDir, root, result, publicationHooks);
      }, false);
    });
  }

  private async withPublicationLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = VaultSkillsService.publicationTails.get(this.vaultPath) ?? Promise.resolve();
    let release!: () => void;
    const current = previous.then(() => new Promise<void>(resolve => { release = resolve; }));
    VaultSkillsService.publicationTails.set(this.vaultPath, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (VaultSkillsService.publicationTails.get(this.vaultPath) === current) {
        VaultSkillsService.publicationTails.delete(this.vaultPath);
      }
    }
  }

  private importOperationSkills(
    operationRoot: string,
    existingBefore: Set<string>,
    overwriteFolders?: ReadonlySet<string>,
    destinationVaultPath = this.vaultPath,
  ): string[] {
    const dest = ensurePiviSkillsDir(destinationVaultPath);
    const installed: string[] = [];
    // Only roots beneath this unique cwd can be attributable to this invocation.
    for (const relativeRoot of ['.agents/skills', '.cursor/skills', 'skills']) {
      const sourceRoot = path.join(operationRoot, relativeRoot);
      if (!fs.existsSync(sourceRoot)) continue;
      for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const candidates = [path.join(sourceRoot, entry.name)];
        const nested = path.join(sourceRoot, entry.name, 'skills');
        if (fs.existsSync(nested)) {
          candidates.push(...fs.readdirSync(nested).map(name => path.join(nested, name)));
        }
        for (const candidate of candidates) {
          if (!fs.existsSync(path.join(candidate, 'SKILL.md'))) continue;
          const folderName = path.basename(candidate);
          copySkillTree(candidate, folderName, dest, existingBefore, installed, destinationVaultPath, overwriteFolders);
        }
      }
    }
    return installed;
  }

}
