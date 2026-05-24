import type { Skill } from '@earendil-works/pi-coding-agent/dist/core/skills.js';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { loadVaultSkills } from '../context/loadContextLayers';
import { OBSIUS_SKILLS_DIR } from '../session/obsiusSessionPaths';

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
    const synced = this.syncCliSkillsIntoObsius(before);

    if (synced.length === 0) {
      throw new Error(
        'Install finished but no new skill folders were found under .obsius/skills/. '
          + 'Check that npx skills completed and SKILL.md exists in the vault.',
      );
    }

    return synced;
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
    const dir = path.join(this.vaultPath, OBSIUS_SKILLS_DIR);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
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
    return new Promise((resolve, reject) => {
      const child = spawn(
        'npx',
        ['skills', 'add', slug, '--copy', '-y'],
        {
          cwd: this.vaultPath,
          stdio: ['ignore', 'pipe', 'pipe'],
          env: process.env,
          shell: process.platform === 'win32',
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
          new Error(
            `Failed to run npx skills: ${error.message}. Ensure Node.js and npx are on PATH.`,
          ),
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

  /** Copy skill trees from CLI default locations into `.obsius/skills/`. */
  private syncCliSkillsIntoObsius(existingBefore: Set<string>): string[] {
    const dest = this.ensureObsiusSkillsDir();
    const installed: string[] = [];

    for (const relativeRoot of SKILLS_CLI_SOURCE_ROOTS) {
      const sourceRoot = path.join(this.vaultPath, relativeRoot);
      if (!fs.existsSync(sourceRoot)) {
        continue;
      }

      for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillMd = path.join(sourceRoot, entry.name, 'SKILL.md');
        if (!fs.existsSync(skillMd)) {
          continue;
        }

        const destDir = path.join(dest, entry.name);
        if (fs.existsSync(destDir) || existingBefore.has(entry.name)) {
          continue;
        }

        fs.cpSync(path.join(sourceRoot, entry.name), destDir, { recursive: true });
        installed.push(entry.name);
      }
    }

    return installed;
  }
}
