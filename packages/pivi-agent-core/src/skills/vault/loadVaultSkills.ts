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
  const filePath = path.join(baseDir, 'SKILL.md');
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const raw = fs.readFileSync(filePath, 'utf8');
  const parsed = parseFrontmatter(raw);
  const frontmatter = parsed?.frontmatter ?? {};
  const name = extractString(frontmatter, 'name') ?? path.basename(baseDir);
  const description = extractString(frontmatter, 'description') ?? '';
  const disabled = fs.existsSync(path.join(baseDir, SKILL_DISABLED_MARKER));
  return { name, description, filePath, baseDir, content: raw, disabled };
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
  if (!fs.existsSync(skillsDir)) {
    return { skills: [], skillsXml: '' };
  }

  const skills = fs
    .readdirSync(skillsDir, { withFileTypes: true })
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
