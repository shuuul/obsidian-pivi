import {
  formatSkillsForPrompt,
  loadSkillsFromDir,
  type Skill,
} from '@earendil-works/pi-coding-agent/dist/core/skills.js';
import * as fs from 'fs';
import * as path from 'path';

import { OBSIUS_SKILLS_DIR, OBSIUS_SYSTEM_MD } from '../session/obsiusSessionPaths';

export interface ContextLayers {
  agentsMd: string;
  systemMd: string;
  skillsXml: string;
  skills: Skill[];
}

function readFileIfExists(filePath: string): string {
  try {
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
  } catch {
    // ignore
  }
  return '';
}

/** Walk from note directory up to vault root collecting AGENTS.md (child overrides parent). */
export function loadAgentsMdChain(vaultPath: string, activeNotePath?: string | null): string {
  const parts: string[] = [];
  const seen = new Set<string>();

  const collect = (dir: string): void => {
    const agentsPath = path.join(dir, 'AGENTS.md');
    if (!seen.has(agentsPath)) {
      seen.add(agentsPath);
      const content = readFileIfExists(agentsPath).trim();
      if (content) {
        parts.unshift(content);
      }
    }
    const parent = path.dirname(dir);
    if (parent !== dir && dir.startsWith(vaultPath)) {
      collect(parent);
    }
  };

  if (activeNotePath?.trim()) {
    const noteDir = path.dirname(path.join(vaultPath, activeNotePath));
    if (noteDir.startsWith(vaultPath)) {
      collect(noteDir);
    }
  }
  collect(vaultPath);

  return parts.join('\n\n---\n\n');
}

export function loadVaultSkills(vaultPath: string): { skills: Skill[]; skillsXml: string } {
  const skillsDir = path.join(vaultPath, OBSIUS_SKILLS_DIR);
  if (!fs.existsSync(skillsDir)) {
    return { skills: [], skillsXml: '' };
  }
  const { skills } = loadSkillsFromDir({ dir: skillsDir, source: 'obsius-vault' });
  return {
    skills,
    skillsXml: formatSkillsForPrompt(skills),
  };
}

export function loadContextLayers(
  vaultPath: string,
  activeNotePath?: string | null,
): ContextLayers {
  const agentsMd = loadAgentsMdChain(vaultPath, activeNotePath);
  const systemMd = readFileIfExists(path.join(vaultPath, OBSIUS_SYSTEM_MD)).trim();
  const { skills, skillsXml } = loadVaultSkills(vaultPath);
  return { agentsMd, systemMd, skillsXml, skills };
}
