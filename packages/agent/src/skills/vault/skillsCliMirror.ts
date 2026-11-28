/**
 * Mirror the published vault skills into the CLI's installed tree and detect
 * which folders the CLI actually wrote. Without this, the CLI sees an empty
 * installation and re-downloads every skill, overwriting local edits.
 */

import { createHash } from 'node:crypto';

import * as fs from 'fs';
import * as path from 'path';

import { extractString, parseFrontmatter } from '../frontmatter';
import { SKILL_DISABLED_MARKER } from './loadVaultSkills';
import { SKILLS_STAGE_MAX_FILE_BYTES, SKILLS_STAGE_MAX_FILES } from './skillsCliConstants';
import { validateStagedSkillCollection } from './skillStagePublish';

export interface SkillsCliSnapshot {
  readonly digests: ReadonlyMap<string, string>;
  readonly disabled: ReadonlySet<string>;
  /** Every folder's frontmatter skill name, duplicates included. */
  readonly namesByFolder: ReadonlyMap<string, string>;
  /** Unique frontmatter skill name -> live folder, used to follow folder renames. */
  readonly foldersBySkillName: ReadonlyMap<string, string>;
  /** Lock identities present before the CLI runs. */
  readonly lockedNames: ReadonlySet<string>;
  /** Lock entries present before the CLI runs. */
  readonly lockedEntries: ReadonlyMap<string, LockedSkillEntry>;
  /** Nested folder digests keyed by `parent/child`. */
  readonly nestedDigests: ReadonlyMap<string, string>;
}

interface LockedSkillEntry {
  skillPath: string;
  source: string;
  ref: string;
  computedHash: string;
}

export interface SkillsCliOperationContext {
  readonly cliSnapshot: SkillsCliSnapshot;
}

export interface SkillsCliImportFilter {
  /** Top-level folders whose content differs after the CLI run. */
  readonly changedFolders: ReadonlySet<string>;
  /** Top-level folders absent before the run; only these may contribute new nested skills. */
  readonly addedFolders: ReadonlySet<string>;
  /** Folders disabled before the run; their nested skills must stay hidden. */
  readonly disabledBefore: ReadonlySet<string>;
  /** CLI folder name -> existing live folder when the user renamed the folder. */
  readonly folderAliases: ReadonlyMap<string, string>;
  /** Live folder -> lock-key migration or rollback, applied after import. */
  readonly lockRenames: ReadonlyMap<
    string,
    { oldName: string; newName: string; oldEntry?: unknown }
  >;
  /** Nested folders whose own contents changed upstream. */
  readonly changedNestedFolders: ReadonlySet<string>;
}

export function emptySkillsCliSnapshot(): SkillsCliSnapshot {
  return {
    digests: new Map(),
    disabled: new Set(),
    namesByFolder: new Map(),
    foldersBySkillName: new Map(),
    lockedNames: new Set(),
    lockedEntries: new Map(),
    nestedDigests: new Map(),
  };
}

interface SkillFrontmatter {
  name?: string;
  description?: string;
}

export function readSkillFrontmatter(skillDir: string): SkillFrontmatter {
  const skillMd = path.join(skillDir, 'SKILL.md');
  if (!fs.existsSync(skillMd)) return {};
  try {
    if (fs.statSync(skillMd).size > SKILLS_STAGE_MAX_FILE_BYTES) return {};
    const frontmatter = parseFrontmatter(fs.readFileSync(skillMd, 'utf8'))?.frontmatter ?? {};
    return {
      name: extractString(frontmatter, 'name')?.trim(),
      description: extractString(frontmatter, 'description')?.trim(),
    };
  } catch {
    return {};
  }
}

function isCliRecognizedSkill(skillDir: string): boolean {
  const { name, description } = readSkillFrontmatter(skillDir);
  return Boolean(name && description);
}

function digestTree(root: string): string {
  const hash = createHash('sha256');
  let fileCount = 0;
  const visit = (absolutePath: string, relativePath: string): void => {
    const entries = fs
      .readdirSync(absolutePath, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryPath = path.join(absolutePath, entry.name);
      const entryName = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      const stat = fs.lstatSync(entryPath);
      if (stat.isSymbolicLink()) {
        hash.update(`link\0${entryName}\0${fs.readlinkSync(entryPath)}\0`);
      } else if (stat.isDirectory()) {
        hash.update(`dir\0${entryName}\0${stat.mode & 0o777}\0`);
        visit(entryPath, entryName);
      } else if (stat.isFile()) {
        hash.update(`file\0${entryName}\0${stat.size}\0${stat.mode & 0o777}\0`);
        fileCount += 1;
        if (fileCount > SKILLS_STAGE_MAX_FILES) {
          hash.update('too-many-files');
        } else if (stat.size > SKILLS_STAGE_MAX_FILE_BYTES) {
          hash.update('oversized');
        } else {
          hash.update(fs.readFileSync(entryPath));
        }
      } else {
        hash.update(`other\0${entryName}\0${stat.mode & 0o777}\0`);
      }
    }
  };
  visit(root, '');
  return hash.digest('hex');
}

function snapshotSkillsTree(skillsDir: string): SkillsCliSnapshot {
  const digests = new Map<string, string>();
  const nestedDigests = new Map<string, string>();
  const disabled = new Set<string>();
  const namesByFolder = new Map<string, string>();
  const foldersBySkillName = new Map<string, string>();
  const duplicateNames = new Set<string>();
  if (!fs.existsSync(skillsDir)) {
    return {
      digests,
      disabled,
      namesByFolder,
      foldersBySkillName,
      lockedNames: new Set(),
      lockedEntries: new Map(),
      nestedDigests,
    };
  }
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsDir, entry.name);
    digests.set(entry.name, digestTree(skillDir));
    const nestedDir = path.join(skillDir, 'skills');
    if (fs.existsSync(nestedDir)) {
      for (const child of fs.readdirSync(nestedDir, { withFileTypes: true })) {
        if (child.isDirectory()) {
          nestedDigests.set(
            `${entry.name}/${child.name}`,
            digestTree(path.join(nestedDir, child.name)),
          );
        }
      }
    }
    const isDisabled = fs.existsSync(path.join(skillDir, SKILL_DISABLED_MARKER));
    if (isDisabled) disabled.add(entry.name);
    const skillName = readSkillFrontmatter(skillDir).name;
    if (!skillName) continue;
    if (isDisabled) disabled.add(skillName);
    namesByFolder.set(entry.name, skillName);
    if (foldersBySkillName.has(skillName)) {
      duplicateNames.add(skillName);
    } else {
      foldersBySkillName.set(skillName, entry.name);
    }
  }
  for (const skillName of duplicateNames) {
    foldersBySkillName.delete(skillName);
  }
  return {
    digests,
    disabled,
    namesByFolder,
    foldersBySkillName,
    lockedNames: new Set(),
    lockedEntries: new Map(),
    nestedDigests,
  };
}

function collectDisabledSkills(skillsDir: string): Set<string> {
  const disabled = new Set<string>();
  if (!fs.existsSync(skillsDir)) return disabled;
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = path.join(skillsDir, entry.name);
    if (!fs.existsSync(path.join(skillDir, SKILL_DISABLED_MARKER))) continue;
    disabled.add(entry.name);
    const skillName = readSkillFrontmatter(skillDir).name;
    if (skillName) disabled.add(skillName);
  }
  return disabled;
}

export function mirrorSkillsForCli(
  sourceSkillsDir: string,
  operationRoot: string,
): SkillsCliSnapshot {
  const cliSkillsDir = path.join(operationRoot, '.agents', 'skills');
  if (fs.existsSync(sourceSkillsDir)) {
    for (const entry of fs.readdirSync(sourceSkillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const skillDir = path.join(sourceSkillsDir, entry.name);
      // The CLI rejects a skill without a non-empty description. Staging it
      // would make the CLI reinstall over a local edit that removed it.
      if (!isCliRecognizedSkill(skillDir)) continue;
      fs.cpSync(skillDir, path.join(cliSkillsDir, entry.name), { recursive: true });
    }
    if (fs.existsSync(cliSkillsDir)) {
      // Validate the private copy rather than the live tree so a concurrent
      // vault sync cannot change what the CLI is about to read.
      validateStagedSkillCollection(cliSkillsDir);
    }
  }
  const lockEntries = readLockedSkillEntries(operationRoot);
  const snapshot = snapshotSkillsTree(cliSkillsDir);
  return {
    ...snapshot,
    disabled: new Set([...snapshot.disabled, ...collectDisabledSkills(sourceSkillsDir)]),
    lockedNames: new Set(lockEntries.keys()),
    lockedEntries: lockEntries,
  };
}

function lockedString(entry: unknown, key: string): string {
  if (!entry || typeof entry !== 'object' || !(key in entry)) return '';
  const value = (entry as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function beforeEntryMatches(left: LockedSkillEntry, right: LockedSkillEntry): boolean {
  return (
    left.source === right.source && left.ref === right.ref && left.skillPath === right.skillPath
  );
}

function readLockedSkillEntries(operationRoot: string): Map<string, LockedSkillEntry> {
  const entries = new Map<string, LockedSkillEntry>();
  for (const fileName of ['skills-lock.json', '.skills.json']) {
    try {
      const parsed: unknown = JSON.parse(
        fs.readFileSync(path.join(operationRoot, fileName), 'utf8'),
      );
      if (!parsed || typeof parsed !== 'object') continue;
      const skills = (parsed as { skills?: unknown }).skills;
      if (!skills || typeof skills !== 'object') continue;
      for (const [name, entry] of Object.entries(skills)) {
        entries.set(name, {
          skillPath: lockedString(entry, 'skillPath'),
          source: `${lockedString(entry, 'sourceUrl')}|${lockedString(entry, 'source')}`,
          ref: lockedString(entry, 'ref'),
          computedHash: lockedString(entry, 'computedHash'),
        });
      }
    } catch {
      continue;
    }
  }
  return entries;
}

function resolveDirectAlias(
  skillName: string,
  before: SkillsCliSnapshot,
  afterLockEntries: ReadonlyMap<string, LockedSkillEntry>,
  claimedFolders: ReadonlySet<string>,
): string | undefined {
  const liveFolder = before.foldersBySkillName.get(skillName);
  if (!liveFolder || claimedFolders.has(liveFolder)) return undefined;
  if (
    before.lockedNames.size > 0 &&
    !before.lockedEntries.has(skillName) &&
    !afterLockEntries.has(skillName)
  ) {
    // The live folder already has the CLI's identity but the lock still tracks
    // the old name. This is a stale reinstall after a rename, not a fresh
    // folder rename; leave local edits untouched.
    return undefined;
  }
  return liveFolder;
}

function resolveFallbackAlias(
  skillName: string,
  before: SkillsCliSnapshot,
  after: SkillsCliSnapshot,
  afterLockEntries: ReadonlyMap<string, LockedSkillEntry>,
  claimedFolders: ReadonlySet<string>,
): string | undefined {
  // An upstream rename either records the new name or keeps updating the old
  // lock key. Require matching source/ref/path evidence and, for the old-key
  // case, a changed hash so a retained removed entry cannot capture an
  // unrelated installed skill.
  const afterEntry = afterLockEntries.get(skillName);
  const renameCandidates = [...before.foldersBySkillName].filter(([name, folder]) => {
    if (claimedFolders.has(folder)) return false;
    const beforeEntry = before.lockedEntries.get(name);
    if (!beforeEntry) return false;
    const currentEntry = afterLockEntries.get(name);
    const beforeDigest = before.digests.get(folder);
    const afterDigest = after.digests.get(folder);
    // A live folder that changed in this run already has its own CLI output;
    // it cannot also be the destination of another folder.
    if (beforeDigest !== undefined && afterDigest !== undefined && beforeDigest !== afterDigest) {
      return false;
    }
    // A hash-only lock change can come from metadata outside the installed
    // files. Require the output itself to carry the matching identity; never
    // authorize an overwrite from a changed hash alone.
    if (!afterEntry || !beforeEntryMatches(afterEntry, beforeEntry)) return false;
    if (currentEntry && !beforeEntryMatches(currentEntry, beforeEntry)) return false;
    return true;
  });
  return renameCandidates.length === 1 ? renameCandidates[0]?.[1] : undefined;
}

/**
 * Keep the lock key aligned with the published skill identity after a rename.
 * The CLI retains the old key; leaving it would make the next update treat the
 * renamed identity as missing and reinstall over later local edits. Only
 * identities whose destination actually imported may move.
 */
export function alignLockedSkillNames(
  operationRoot: string,
  renames: ReadonlyMap<string, { oldName: string; newName: string; oldEntry?: unknown }>,
  publishedFolders: ReadonlySet<string>,
): void {
  if (renames.size === 0) return;
  const lockPath = path.join(operationRoot, 'skills-lock.json');
  if (!fs.existsSync(lockPath)) return;
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    if (!parsed || typeof parsed !== 'object') return;
    const skills = (parsed as { skills?: unknown }).skills;
    if (!skills || typeof skills !== 'object') return;
    const record = skills as Record<string, unknown>;
    let changed = false;
    for (const [liveFolder, { oldName, newName, oldEntry }] of renames) {
      if (oldName === newName) continue;
      if (publishedFolders.has(liveFolder)) {
        if (!Object.hasOwn(record, oldName) || Object.hasOwn(record, newName)) continue;
        record[newName] = record[oldName];
        delete record[oldName];
        changed = true;
        continue;
      }
      // The alias was skipped (install never overwrites an existing folder).
      // Restore the old lock entry instead of publishing the new identity
      // beside a live skill that was left untouched.
      if (Object.hasOwn(record, newName)) {
        delete record[newName];
        changed = true;
      }
      if (oldEntry !== undefined && !Object.hasOwn(record, oldName)) {
        record[oldName] = oldEntry;
        changed = true;
      }
    }
    if (changed) {
      fs.writeFileSync(lockPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
    }
  } catch {
    // Lock metadata is advisory; import still preserves the live tree.
  }
}

export function changedSkillsForCli(
  operationRoot: string,
  before: SkillsCliSnapshot,
  includeAdded: boolean,
): SkillsCliImportFilter {
  const after = snapshotSkillsTree(path.join(operationRoot, '.agents', 'skills'));
  const afterLockEntries = readLockedSkillEntries(operationRoot);
  const changedNestedFolders = new Set<string>();
  for (const [key, digest] of after.nestedDigests) {
    if (before.nestedDigests.get(key) !== digest) changedNestedFolders.add(key);
  }
  const changedFolders = new Set<string>();
  const addedFolders = new Set<string>();
  const folderAliases = new Map<string, string>();
  const lockRenames = new Map<string, { oldName: string; newName: string; oldEntry?: unknown }>();
  const claimedFolders = new Set<string>();
  const pendingFallbacks: Array<{ folderName: string; skillName: string }> = [];
  const registerAlias = (folderName: string, liveFolder: string): void => {
    claimedFolders.add(liveFolder);
    folderAliases.set(folderName, liveFolder);
    const oldName = before.namesByFolder.get(liveFolder);
    const newName = after.namesByFolder.get(folderName);
    if (oldName && newName && oldName !== newName) {
      lockRenames.set(liveFolder, {
        oldName,
        newName,
        oldEntry: before.lockedEntries.get(oldName),
      });
    }
  };
  for (const [folderName, digest] of after.digests) {
    const previous = before.digests.get(folderName);
    if (previous === undefined) {
      addedFolders.add(folderName);
      const skillName = after.namesByFolder.get(folderName);
      if (!skillName) continue;
      const direct = resolveDirectAlias(skillName, before, afterLockEntries, claimedFolders);
      if (direct) {
        registerAlias(folderName, direct);
      } else if (!before.foldersBySkillName.has(skillName)) {
        // A known live identity that was claimed or deliberately skipped must
        // not fall through to another destination.
        pendingFallbacks.push({ folderName, skillName });
      }
      continue;
    }
    if (previous === digest) continue;
    // A local name edit makes the folder look like a new install to the CLI.
    // Never replace a live skill when the CLI writes back an identity that is
    // still recorded in the lock file.
    const afterName = after.namesByFolder.get(folderName);
    if (
      before.namesByFolder.get(folderName) !== afterName &&
      (!afterName || before.lockedNames.has(afterName))
    ) {
      continue;
    }
    changedFolders.add(folderName);
  }
  // Resolve rename fallbacks after every direct identity has claimed its live
  // folder, so output order cannot steal a genuine update's destination. More
  // than one unmatched identity is ambiguous; importing them as new folders is
  // safer than guessing which live folder a rename belongs to.
  for (const { folderName, skillName } of pendingFallbacks.length === 1 ? pendingFallbacks : []) {
    const liveFolder = resolveFallbackAlias(
      skillName,
      before,
      after,
      afterLockEntries,
      claimedFolders,
    );
    if (liveFolder) registerAlias(folderName, liveFolder);
  }
  for (const folderName of addedFolders) {
    // Update commands can re-emit a lock entry whose folder was removed or
    // renamed; only install/default flows may introduce new top-level folders,
    // or a renamed folder matched to its existing live destination.
    if (!includeAdded && !folderAliases.has(folderName)) continue;
    changedFolders.add(folderName);
  }
  return {
    changedFolders,
    addedFolders,
    disabledBefore: before.disabled,
    folderAliases,
    lockRenames,
    changedNestedFolders,
  };
}
