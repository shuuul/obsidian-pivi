import * as fs from 'fs';
import * as path from 'path';

import { PluginLogger } from '../../logging/pluginLogger';
import { toVaultRelativePath } from '../../session/sessionPaths';
import { extractString, parseFrontmatter } from '../frontmatter';
import { PIVI_SKILLS_PATH } from './paths';

export interface Skill {
  name: string;
  description: string;
  /** Vault-relative SKILL.md path for UI/restore matching. */
  filePath: string;
  content: string;
  /** Vault-relative skill directory for UI/restore matching. */
  baseDir: string;
  /** Absolute SKILL.md path for on-disk reads. */
  absoluteFilePath: string;
  /** Absolute skill directory for on-disk reads of supporting files. */
  absoluteBaseDir: string;
  disabled?: boolean;
}

export const SKILL_DISABLED_MARKER = '.disabled';

const logger = new PluginLogger('VaultSkills');
const lastInventoryByVault = new Map<string, { skills: Skill[]; skillsXml: string }>();

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadSkillFromDir(vaultPath: string, baseDir: string): Skill | null {
  try {
    const absoluteFilePath = path.join(baseDir, 'SKILL.md');
    if (!fs.existsSync(absoluteFilePath)) {
      return null;
    }

    // Skills may be copied into the vault by another process (or by a user
    // dragging a folder) while a runtime refresh is reading them. On Windows
    // that can produce a transient ENOENT/EPERM, and one incomplete skill must
    // not tear down the chat/settings surface.
    const raw = fs.readFileSync(absoluteFilePath, 'utf8');
    const parsed = parseFrontmatter(raw);
    const frontmatter = parsed?.frontmatter ?? {};
    const name = extractString(frontmatter, 'name') ?? path.basename(baseDir);
    const description = extractString(frontmatter, 'description') ?? '';
    const disabled = fs.existsSync(path.join(baseDir, SKILL_DISABLED_MARKER));
    return {
      name,
      description,
      filePath: toVaultRelativePath(vaultPath, absoluteFilePath),
      baseDir: toVaultRelativePath(vaultPath, baseDir),
      absoluteFilePath,
      absoluteBaseDir: baseDir,
      content: raw,
      disabled,
    };
  } catch (error) {
    // The next refresh will pick up the skill once its files are complete and
    // readable. Keep the current runtime usable in the meantime.
    logger.warn(`Skipped unreadable vault skill at ${baseDir}`, error);
    return null;
  }
}

function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) {
    return '';
  }

  const entries = skills
    .map((skill) => {
      const description = skill.description ? ` description="${escapeXml(skill.description)}"` : '';
      return `  <skill name="${escapeXml(skill.name)}"${description} />`;
    })
    .join('\n');
  return `<available_skills>\n${entries}\n</available_skills>`;
}

function projectInventory(skills: Skill[]): { skills: Skill[]; skillsXml: string } {
  return { skills, skillsXml: formatSkillsForPrompt(skills) };
}

function filterInventory(
  inventory: { skills: Skill[]; skillsXml: string },
  includeDisabled: boolean,
): { skills: Skill[]; skillsXml: string } {
  if (includeDisabled) {
    return inventory;
  }
  const skills = inventory.skills.filter((skill) => !skill.disabled);
  return projectInventory(skills);
}

export function loadVaultSkills(
  vaultPath: string,
  options: { includeDisabled?: boolean } = { includeDisabled: true },
): { skills: Skill[]; skillsXml: string } {
  const includeDisabled = options.includeDisabled !== false;
  const skillsDir = path.join(vaultPath, PIVI_SKILLS_PATH);
  let entries: fs.Dirent[];
  try {
    if (!fs.existsSync(skillsDir)) {
      lastInventoryByVault.set(vaultPath, projectInventory([]));
      return filterInventory(lastInventoryByVault.get(vaultPath)!, includeDisabled);
    }
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch (error) {
    // A vault watcher can observe the directory between an atomic replace and
    // its final contents becoming visible. Keep the last successful inventory
    // so a transient lock cannot blank chat or settings.
    const previous = lastInventoryByVault.get(vaultPath);
    logger.warn(`Failed to read vault skills directory at ${skillsDir}`, error);
    return previous ? filterInventory(previous, includeDisabled) : { skills: [], skillsXml: '' };
  }

  const skills = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadSkillFromDir(vaultPath, path.join(skillsDir, entry.name)))
    .filter((skill): skill is Skill => skill !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
  lastInventoryByVault.set(vaultPath, projectInventory(skills));
  return filterInventory(lastInventoryByVault.get(vaultPath)!, includeDisabled);
}

export function loadRuntimeVaultSkills(vaultPath: string): { skills: Skill[]; skillsXml: string } {
  return loadVaultSkills(vaultPath, { includeDisabled: false });
}
