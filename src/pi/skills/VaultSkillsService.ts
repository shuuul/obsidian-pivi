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

const isWindows = process.platform === 'win32';

const SKILLS_INSTALL_TIMEOUT_MS = 120_000;

/** Candidate dirs where `npx skills add --copy` may place skills before Obsius sync. */
const SKILLS_CLI_SOURCE_ROOTS = ['.agents/skills', '.cursor/skills', 'skills'] as const;

export interface VaultSkillEntry {
  name: string;
  description: string;
  folderName: string;
}

export function normalizeSkillSlug(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Enter a skills.sh slug (owner/repo).');
  }

  const skillsShMatch = trimmed.match(/skills\.sh\/([^/\s]+)\/([^/\s#?]+)/i);
  if (skillsShMatch) {
    return `${skillsShMatch[1]}/${skillsShMatch[2]}`;
  }

  const githubMatch = trimmed.match(/github\.com\/([^/\s]+)\/([^/\s#?.]+)/i);
  if (githubMatch) {
    return `${githubMatch[1]}/${githubMatch[2].replace(/\.git$/i, '')}`;
  }

  if (!/^[\w.-]+\/[\w.-]+$/.test(trimmed)) {
    throw new Error('Slug must look like owner/repo (e.g. vercel-labs/agent-skills).');
  }

  return trimmed;
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
  constructor(private readonly vaultPath: string) {}

  list(): VaultSkillEntry[] {
    const { skills } = loadVaultSkills(this.vaultPath);
    return skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      folderName: skillFolderName(skill),
    }));
  }

  async installFromSlug(slugInput: string): Promise<string[]> {
    const slug = normalizeSkillSlug(slugInput);
    const obsiusSkillsDir = this.ensureObsiusSkillsDir();
    const before = new Set(this.listDirNames(obsiusSkillsDir));

    await this.runNpxSkillsAdd(slug);
    const synced = syncCliSkillsIntoObsius(this.vaultPath, before);

    if (synced.length === 0) {
      throw new Error(
        'Install finished but no new skill folders were found under .obsius/skills/. '
          + 'Check that npx skills completed and SKILL.md exists in the vault.',
      );
    }

    return synced;
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

  private runNpxSkillsAdd(slug: string): Promise<void> {
    const npxCommand = findNpxExecutable();
    if (!npxCommand) {
      return Promise.reject(new Error(formatNpxNotFoundError()));
    }

    const env = getSpawnEnvWithEnhancedPath();

    return new Promise((resolve, reject) => {
      const child = spawn(
        npxCommand,
        ['skills', 'add', slug, '--copy', '-y'],
        {
          cwd: this.vaultPath,
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
          reject(new Error(`npx skills add failed: ${detail}`));
          return;
        }
        resolve();
      });
    });
  }

}
