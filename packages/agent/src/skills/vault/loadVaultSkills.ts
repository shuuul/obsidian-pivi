import * as fs from 'fs';
import * as path from 'path';

import { extractString, parseFrontmatter } from '../frontmatter';
import { PIVI_SKILLS_PATH } from './paths';

export interface Skill {
  name: string;
  description: string;
  filePath: string;
  content: string;
  baseDir: string;
  disabled?: boolean;
}

export const SKILL_DISABLED_MARKER = '.disabled';

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function loadSkillFromDir(baseDir: string): Skill | null {
  try {
    const filePath = path.join(baseDir, 'SKILL.md');
    if (!fs.existsSync(filePath)) {
      return null;
    }

    // Skills may be copied into the vault by another process (or by a user
    // dragging a folder) while a runtime refresh is reading them. On Windows
    // that can produce a transient ENOENT/EPERM, and one incomplete skill must
    // not tear down the chat/settings surface.
    const raw = fs.readFileSync(filePath, 'utf8');
    const parsed = parseFrontmatter(raw);
    const frontmatter = parsed?.frontmatter ?? {};
    const name = extractString(frontmatter, 'name') ?? path.basename(baseDir);
    const description = extractString(frontmatter, 'description') ?? '';
    const disabled = fs.existsSync(path.join(baseDir, SKILL_DISABLED_MARKER));
    return { name, description, filePath, baseDir, content: raw, disabled };
  } catch {
    // The next refresh will pick up the skill once its files are complete and
    // readable. Keep the current runtime usable in the meantime.
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

export function loadVaultSkills(
  vaultPath: string,
  options: { includeDisabled?: boolean } = { includeDisabled: true },
): { skills: Skill[]; skillsXml: string } {
  const skillsDir = path.join(vaultPath, PIVI_SKILLS_PATH);
  let entries: fs.Dirent[];
  try {
    if (!fs.existsSync(skillsDir)) {
      return { skills: [], skillsXml: '' };
    }
    entries = fs.readdirSync(skillsDir, { withFileTypes: true });
  } catch {
    // A vault watcher can observe the directory between an atomic replace and
    // its final contents becoming visible. Treat that refresh as empty rather
    // than allowing a transient filesystem error to blank the surface.
    return { skills: [], skillsXml: '' };
  }

  const skills = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => loadSkillFromDir(path.join(skillsDir, entry.name)))
    .filter((skill): skill is Skill => skill !== null)
    .filter((skill) => options.includeDisabled || !skill.disabled)
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    skills,
    skillsXml: formatSkillsForPrompt(skills),
  };
}

export function loadRuntimeVaultSkills(vaultPath: string): { skills: Skill[]; skillsXml: string } {
  return loadVaultSkills(vaultPath, { includeDisabled: false });
}
