import type { Skill } from '@earendil-works/pi-coding-agent/dist/core/skills.js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { findNpxExecutable, formatNpxNotFoundError, getSpawnEnvWithEnhancedPath } from '../../utils/env';
import { loadVaultSkills } from '../context/loadContextLayers';
import { OBSIUS_SKILLS_DIR } from '../session/obsiusSessionPaths';
import {
  DEFAULT_VAULT_SKILL_FOLDER_NAMES,
  DEFAULT_VAULT_SKILLS_SLUG,
} from './defaultVaultSkills';

export interface SyncCliSkillsOptions {
  /** Replace these folders under `.obsius/skills/` even when they already exist. */
  overwriteFolders?: ReadonlySet<string>;
}

export interface InstallSkillsOptions {
  /** Skill names to request from multi-skill repositories (`npx skills add --skill`). */
  skillNames?: string[];
}

export interface RemoteSkillEntry {
  name: string;
  description: string;
}

const isWindows = process.platform === 'win32';

const SKILLS_INSTALL_TIMEOUT_MS = 120_000;

/** Candidate dirs where `npx skills add --copy` may place skills before Obsius sync. */
const SKILLS_CLI_SOURCE_ROOTS = [
  '.obsius/.agents/skills',
  '.obsius/.cursor/skills',
  '.obsius/skills',
  '.agents/skills',
  '.cursor/skills',
  'skills',
] as const;

const SKILLS_CLI_METADATA_FILES = ['skills-lock.json', '.skills.json'] as const;

const ANSI_CSI_PATTERN = new RegExp(`${String.fromCharCode(27)}[[][0-?]*[ -/]*[@-~]`, 'g');

export interface VaultSkillEntry {
  name: string;
  description: string;
  folderName: string;
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

function skillFolderName(skill: Skill): string {
  return path.basename(path.dirname(skill.filePath));
}

function ensureObsiusSkillsDir(vaultPath: string): string {
  const dir = path.join(vaultPath, OBSIUS_SKILLS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function copySkillTree(
  sourceDir: string,
  folderName: string,
  dest: string,
  existingBefore: Set<string>,
  installed: string[],
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

  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true });
  }

  fs.cpSync(sourceDir, destDir, { recursive: true });
  if (!installed.includes(folderName)) {
    installed.push(folderName);
  }
  return true;
}

/** Copy skill trees from CLI default locations into `.obsius/skills/`. */
export function syncCliSkillsIntoObsius(
  vaultPath: string,
  existingBefore: Set<string>,
  options?: SyncCliSkillsOptions,
): string[] {
  const dest = ensureObsiusSkillsDir(vaultPath);
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
        if (copySkillTree(flatSkillDir, entry.name, dest, existingBefore, installed, overwriteFolders)) {
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

        copySkillTree(nestedSkillDir, nested.name, dest, existingBefore, installed, overwriteFolders);
      }
    }
  }

  return installed;
}

export class VaultSkillsService {
  constructor(private readonly vaultPath: string) {
    this.ensureObsiusWorkDir();
  }

  list(): VaultSkillEntry[] {
    const { skills } = loadVaultSkills(this.vaultPath);
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      folderName: skillFolderName(skill),
    }));
  }

  async installFromSlug(slugInput: string): Promise<string[]> {
    return this.installFromSource(slugInput);
  }

  async installFromSource(sourceInput: string, options?: InstallSkillsOptions): Promise<string[]> {
    const source = normalizeSkillSlug(sourceInput);
    const skillNames = normalizeRequestedSkillNames(options?.skillNames);
    const obsiusSkillsDir = this.ensureObsiusSkillsDir();
    const before = new Set(this.listDirNames(obsiusSkillsDir));

    await this.runNpxSkillsAdd(source, skillNames);
    const synced = syncCliSkillsIntoObsius(this.vaultPath, before);

    if (synced.length === 0) {
      throw new Error(
        'Install finished but no new skill folders were found under .obsius/skills/. '
          + 'Check that npx skills completed and SKILL.md exists in the vault.',
      );
    }

    return synced;
  }

  async listRemoteSkills(sourceInput: string): Promise<RemoteSkillEntry[]> {
    const source = normalizeSkillSlug(sourceInput);
    const output = await this.runNpxSkillsCommand(['skills', 'add', source, '--list'], 'list');
    return parseRemoteSkillsListOutput(output);
  }

  /**
   * Re-fetch kepano/obsidian-skills via npx and refresh bundle folders (overwrite).
   * Skips folder names in `skipFolders` (user-removed defaults).
   */
  async upgradeDefaultBundle(skipFolders: ReadonlySet<string>): Promise<string[]> {
    const bundleFolders = DEFAULT_VAULT_SKILL_FOLDER_NAMES.filter(
      (name) => !skipFolders.has(name),
    );
    if (bundleFolders.length === 0) {
      await this.runNpxSkillsAdd(DEFAULT_VAULT_SKILLS_SLUG);
      return [];
    }

    await this.runNpxSkillsAdd(DEFAULT_VAULT_SKILLS_SLUG);
    return syncCliSkillsIntoObsius(this.vaultPath, new Set(), {
      overwriteFolders: new Set(bundleFolders),
    });
  }

  remove(folderName: string): void {
    const safeName = path.basename(folderName.trim());
    if (!safeName || safeName === '.' || safeName === '..') {
      throw new Error('Invalid skill folder name.');
    }

    const target = path.join(this.ensureObsiusSkillsDir(), safeName);
    if (!fs.existsSync(target)) {
      throw new Error(`Skill folder not found: ${safeName}`);
    }

    fs.rmSync(target, { recursive: true, force: true });
  }

  async updateAll(): Promise<string[]> {
    const folders = new Set(this.listDirNames(this.ensureObsiusSkillsDir()));
    await this.runNpxSkillsUpdate();
    return syncCliSkillsIntoObsius(this.vaultPath, new Set(), { overwriteFolders: folders });
  }

  async updateSkill(skillName: string, folderName: string): Promise<string[]> {
    const normalizedSkillName = skillName.trim();
    const safeFolderName = path.basename(folderName.trim());
    if (!normalizedSkillName || !safeFolderName || safeFolderName === '.' || safeFolderName === '..') {
      throw new Error('Invalid skill name.');
    }

    await this.runNpxSkillsUpdate([normalizedSkillName]);
    return syncCliSkillsIntoObsius(this.vaultPath, new Set(), {
      overwriteFolders: new Set([safeFolderName]),
    });
  }

  private ensureObsiusSkillsDir(): string {
    return ensureObsiusSkillsDir(this.vaultPath);
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

  private ensureObsiusWorkDir(): string {
    const dir = path.join(this.vaultPath, '.obsius');
    fs.mkdirSync(dir, { recursive: true });
    this.migrateRootSkillsCliMetadata(dir);
    return dir;
  }

  private migrateRootSkillsCliMetadata(obsiusDir: string): void {
    for (const fileName of SKILLS_CLI_METADATA_FILES) {
      const source = path.join(this.vaultPath, fileName);
      const dest = path.join(obsiusDir, fileName);
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

  private runNpxSkillsAdd(source: string, skillNames: string[] = []): Promise<void> {
    const args = ['skills', 'add', source, '--copy', '-y'];
    for (const skillName of skillNames) {
      args.push('--skill', skillName);
    }
    return this.runNpxSkillsCommand(args, 'add').then(() => undefined);
  }

  private runNpxSkillsUpdate(skillNames: string[] = []): Promise<void> {
    return this.runNpxSkillsCommand(['skills', 'update', ...skillNames, '-p', '-y'], 'update')
      .then(() => undefined);
  }

  private runNpxSkillsCommand(args: string[], commandName: string): Promise<string> {
    const npxCommand = findNpxExecutable();
    if (!npxCommand) {
      return Promise.reject(new Error(formatNpxNotFoundError()));
    }

    const env = getSpawnEnvWithEnhancedPath();
    const cwd = this.ensureObsiusWorkDir();

    return new Promise((resolve, reject) => {
      const child = spawn(
        npxCommand,
        args,
        {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          env,
          // Windows npx.cmd needs shell; Unix uses absolute path without shell.
          shell: isWindows,
        },
      );

      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timeout = window.setTimeout(() => {
        child.kill();
        reject(new Error(`npx skills timed out after ${SKILLS_INSTALL_TIMEOUT_MS}ms`));
      }, SKILLS_INSTALL_TIMEOUT_MS);

      child.on('error', (error) => {
        window.clearTimeout(timeout);
        reject(
          new Error(`Failed to run npx skills (${npxCommand}): ${error.message}`),
        );
      });

      child.on('close', (code) => {
        window.clearTimeout(timeout);
        if (code !== 0) {
          const detail = stderr.trim() || stdout.trim() || `exit ${code}`;
          reject(new Error(`npx skills ${commandName} failed: ${detail}`));
          return;
        }
        resolve(stdout);
      });
    });
  }

}
