/**
 * Validate a staged skill tree and publish it atomically into `.pivi/skills/`.
 */

import * as fs from 'fs';
import * as path from 'path';

import { SKILL_DISABLED_MARKER } from './loadVaultSkills';
import {
  SKILLS_STAGE_MAX_FILE_BYTES,
  SKILLS_STAGE_MAX_FILES,
  SKILLS_STAGE_MAX_SKILL_MD_BYTES,
  SKILLS_STAGE_MAX_TOTAL_BYTES,
} from './skillsCliConstants';

export interface SkillStageLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxSkillMdBytes: number;
}

export const DEFAULT_SKILL_STAGE_LIMITS: Readonly<SkillStageLimits> = Object.freeze({
  maxFiles: SKILLS_STAGE_MAX_FILES,
  maxFileBytes: SKILLS_STAGE_MAX_FILE_BYTES,
  maxTotalBytes: SKILLS_STAGE_MAX_TOTAL_BYTES,
  maxSkillMdBytes: SKILLS_STAGE_MAX_SKILL_MD_BYTES,
});

export class SkillStageValidationError extends Error {
  readonly code = 'skill-stage-invalid' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SkillStageValidationError';
  }
}

interface WalkEntry {
  absolutePath: string;
  relativePath: string;
  size: number;
}

function assertInsideRoot(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedCandidate = path.resolve(candidate);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolvedCandidate !== resolvedRoot && !resolvedCandidate.startsWith(prefix)) {
    throw new SkillStageValidationError(`Skill path escapes staging root: ${candidate}`);
  }
}

function walkFiles(root: string): WalkEntry[] {
  const entries: WalkEntry[] = [];

  const visit = (absolutePath: string, relativePath: string): void => {
    assertInsideRoot(root, absolutePath);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(absolutePath);
    } catch (error) {
      throw new SkillStageValidationError(
        `Unable to stat staged skill path ${relativePath}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (stat.isSymbolicLink()) {
      throw new SkillStageValidationError(`Symlinks are forbidden in staged skills: ${relativePath || '.'}`);
    }
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolutePath)) {
        if (name === '.' || name === '..') continue;
        visit(path.join(absolutePath, name), relativePath ? path.join(relativePath, name) : name);
      }
      return;
    }
    if (!stat.isFile()) {
      throw new SkillStageValidationError(`Unsupported staged skill entry type: ${relativePath}`);
    }
    entries.push({
      absolutePath,
      relativePath: relativePath.replace(/\\/g, '/'),
      size: stat.size,
    });
  };

  visit(root, '');
  return entries;
}

export function validateStagedSkillTree(
  stagedDir: string,
  limits: SkillStageLimits = DEFAULT_SKILL_STAGE_LIMITS,
): { fileCount: number; totalBytes: number } {
  const resolved = path.resolve(stagedDir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new SkillStageValidationError('Staged skill directory is missing');
  }

  const files = walkFiles(resolved);
  if (files.length === 0) {
    throw new SkillStageValidationError('Staged skill directory is empty');
  }
  if (files.length > limits.maxFiles) {
    throw new SkillStageValidationError(
      `Staged skill exceeds file count limit (${limits.maxFiles})`,
    );
  }

  let totalBytes = 0;
  let skillMd: WalkEntry | undefined;
  for (const file of files) {
    if (file.size > limits.maxFileBytes) {
      throw new SkillStageValidationError(
        `Staged skill file exceeds per-file size limit: ${file.relativePath}`,
      );
    }
    totalBytes += file.size;
    if (totalBytes > limits.maxTotalBytes) {
      throw new SkillStageValidationError(
        `Staged skill exceeds total size limit (${limits.maxTotalBytes})`,
      );
    }
    if (file.relativePath === 'SKILL.md') {
      skillMd = file;
    }
  }

  if (!skillMd) {
    throw new SkillStageValidationError('Staged skill is missing SKILL.md');
  }
  if (skillMd.size > limits.maxSkillMdBytes) {
    throw new SkillStageValidationError(
      `SKILL.md exceeds size limit (${limits.maxSkillMdBytes})`,
    );
  }

  let skillMdText: string;
  try {
    skillMdText = fs.readFileSync(skillMd.absolutePath, 'utf8');
  } catch (error) {
    throw new SkillStageValidationError(
      `Unable to read SKILL.md: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!skillMdText.trim()) {
    throw new SkillStageValidationError('SKILL.md is empty');
  }
  // Reject NULs / obvious binary.
  if (skillMdText.includes('\u0000')) {
    throw new SkillStageValidationError('SKILL.md contains invalid encoding');
  }

  return { fileCount: files.length, totalBytes };
}

export function publishValidatedSkillTree(options: {
  stagedDir: string;
  destinationDir: string;
  folderName: string;
  preserveDisabledMarker?: boolean;
  limits?: SkillStageLimits;
}): void {
  const {
    stagedDir,
    destinationDir,
    folderName,
    preserveDisabledMarker = true,
    limits = DEFAULT_SKILL_STAGE_LIMITS,
  } = options;

  const safeName = path.basename(folderName.trim());
  if (!safeName || safeName === '.' || safeName === '..' || safeName !== folderName.trim()) {
    throw new SkillStageValidationError('Invalid skill folder name');
  }

  validateStagedSkillTree(stagedDir, limits);

  fs.mkdirSync(destinationDir, { recursive: true });
  const finalDir = path.join(destinationDir, safeName);
  const previousDisabled = preserveDisabledMarker
    && fs.existsSync(path.join(finalDir, SKILL_DISABLED_MARKER));

  const tempPublish = path.join(
    destinationDir,
    `.publish-${safeName}-${process.pid}-${Date.now()}`,
  );
  const backupDir = path.join(
    destinationDir,
    `.backup-${safeName}-${process.pid}-${Date.now()}`,
  );

  try {
    fs.cpSync(stagedDir, tempPublish, { recursive: true });
    validateStagedSkillTree(tempPublish, limits);

    if (fs.existsSync(finalDir)) {
      fs.renameSync(finalDir, backupDir);
    }
    fs.renameSync(tempPublish, finalDir);

    if (previousDisabled) {
      fs.writeFileSync(path.join(finalDir, SKILL_DISABLED_MARKER), 'disabled\n', 'utf8');
    }

    if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (fs.existsSync(tempPublish)) {
      fs.rmSync(tempPublish, { recursive: true, force: true });
    }
    if (fs.existsSync(backupDir) && !fs.existsSync(finalDir)) {
      fs.renameSync(backupDir, finalDir);
    } else if (fs.existsSync(backupDir)) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
    throw error;
  }
}

export function stageSkillTreeFromSource(sourceDir: string, stagingRoot: string, folderName: string): string {
  const safeName = path.basename(folderName.trim());
  if (!safeName || safeName === '.' || safeName === '..') {
    throw new SkillStageValidationError('Invalid skill folder name');
  }
  const stagedDir = path.join(stagingRoot, safeName);
  if (fs.existsSync(stagedDir)) {
    fs.rmSync(stagedDir, { recursive: true, force: true });
  }
  fs.mkdirSync(stagingRoot, { recursive: true });
  fs.cpSync(sourceDir, stagedDir, { recursive: true });
  return stagedDir;
}
