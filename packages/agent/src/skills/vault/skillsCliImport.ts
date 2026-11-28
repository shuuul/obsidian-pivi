import * as fs from 'fs';
import * as path from 'path';

import { SKILL_DISABLED_MARKER } from './loadVaultSkills';
import { PIVI_SKILLS_PATH } from './paths';
import {
  alignLockedSkillNames,
  readSkillFrontmatter,
  type SkillsCliImportFilter,
} from './skillsCliMirror';
import { publishValidatedSkillTree, stageSkillTreeFromSource } from './skillStagePublish';

const SKILLS_STAGING_ROOT = path.join('.pivi', 'skills-staging');

function ensureSkillsDir(vaultPath: string): string {
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
): void {
  const destDir = path.join(dest, folderName);
  if (path.resolve(sourceDir) === path.resolve(destDir)) {
    const overwrite = overwriteFolders?.has(folderName) ?? false;
    if (!overwrite && existingBefore.has(folderName)) return;
    if (!installed.includes(folderName)) installed.push(folderName);
    return;
  }

  const overwrite = overwriteFolders?.has(folderName) ?? false;
  if (!overwrite && (fs.existsSync(destDir) || existingBefore.has(folderName))) return;

  const stagingRoot = path.join(
    vaultPath,
    SKILLS_STAGING_ROOT,
    `sync-${process.pid}-${Date.now()}`,
  );
  try {
    const stagedDir = stageSkillTreeFromSource(sourceDir, stagingRoot, folderName);
    publishValidatedSkillTree({
      stagedDir,
      destinationDir: dest,
      folderName,
      preserveDisabledMarker: true,
    });
    if (!installed.includes(folderName)) installed.push(folderName);
  } finally {
    if (fs.existsSync(stagingRoot)) {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }
}

interface SkillCandidate {
  source: string;
  folderName: string;
}

function nestedCandidates(
  entryName: string,
  sourceRoot: string,
  dest: string,
  filter?: SkillsCliImportFilter,
  allowAll = false,
): SkillCandidate[] {
  const nested = path.join(sourceRoot, entryName, 'skills');
  const aliasedFolder = filter?.folderAliases.get(entryName);
  const disabled =
    filter !== undefined &&
    (filter.disabledBefore.has(entryName) ||
      (aliasedFolder !== undefined && filter.disabledBefore.has(aliasedFolder)) ||
      fs.existsSync(path.join(sourceRoot, entryName, SKILL_DISABLED_MARKER)));
  if (disabled || !fs.existsSync(nested)) return [];
  const added = filter?.addedFolders.has(entryName) ?? false;
  const changed = filter?.changedFolders.has(entryName) ?? false;
  const allowAllNested = allowAll || filter === undefined || (added && !aliasedFolder && !disabled);
  return fs.readdirSync(nested).flatMap((name) => {
    const nestedFolder = filter?.folderAliases.get(name) ?? name;
    const sourceName = readSkillFrontmatter(path.join(nested, name)).name;
    const destName = readSkillFrontmatter(path.join(dest, nestedFolder)).name;
    // New children only arrive with a new top-level skill. Existing children
    // may refresh only when the destination is the same skill; an update must
    // not activate new ones or replace an unrelated live folder.
    const nestedChanged = filter?.changedNestedFolders.has(`${entryName}/${name}`) ?? true;
    const mayRefresh = changed && nestedChanged && Boolean(sourceName) && sourceName === destName;
    if (!allowAllNested && !mayRefresh) return [];
    return [{ source: path.join(nested, name), folderName: nestedFolder }];
  });
}

/**
 * Import CLI-written skill folders from an isolated operation root.
 *
 * Filters scope the import to folders the CLI rewrote and to nested children
 * that were already installed, so removed lock entries and updates cannot
 * activate new skills.
 */
export function importCliSkills(
  operationRoot: string,
  existingBefore: Set<string>,
  overwriteFolders: ReadonlySet<string> | undefined,
  destinationVaultPath: string,
  filter?: SkillsCliImportFilter,
  includeAlternateRoots = true,
  excludedFolders?: ReadonlySet<string>,
): string[] {
  const dest = ensureSkillsDir(destinationVaultPath);
  const installed: string[] = [];
  // Only roots beneath this unique cwd can be attributable to this invocation.
  for (const relativeRoot of ['.agents/skills', '.cursor/skills', 'skills']) {
    if (!includeAlternateRoots && relativeRoot !== '.agents/skills') continue;
    const sourceRoot = path.join(operationRoot, relativeRoot);
    if (!fs.existsSync(sourceRoot)) continue;
    const alternateRoot = relativeRoot !== '.agents/skills';
    const rootFilter = alternateRoot ? undefined : filter;
    for (const entry of fs.readdirSync(sourceRoot, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (excludedFolders?.has(entry.name)) continue;
      if (alternateRoot && filter?.disabledBefore.has(entry.name)) continue;
      if (rootFilter && !rootFilter.changedFolders.has(entry.name)) continue;
      const aliasedFolder = rootFilter?.folderAliases.get(entry.name);
      const candidates: SkillCandidate[] = [
        { source: path.join(sourceRoot, entry.name), folderName: aliasedFolder ?? entry.name },
        ...nestedCandidates(entry.name, sourceRoot, dest, filter, alternateRoot),
      ];
      for (const candidate of candidates) {
        if (!fs.existsSync(path.join(candidate.source, 'SKILL.md'))) continue;
        copySkillTree(
          candidate.source,
          candidate.folderName,
          dest,
          existingBefore,
          installed,
          destinationVaultPath,
          overwriteFolders,
        );
      }
    }
  }
  if (filter) {
    alignLockedSkillNames(operationRoot, filter.lockRenames, new Set(installed));
  }
  return installed;
}
