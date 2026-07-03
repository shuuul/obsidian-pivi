import { loadVaultSkills, type Skill } from '@pivi/pivi-agent-core/skills/vault/loadVaultSkills';
import * as fs from 'fs';
import * as path from 'path';

import { PIVI_STORAGE_PATH } from '../skills/vault/paths';

const PIVI_SYSTEM_PROMPT_PATH = `${PIVI_STORAGE_PATH}/SYSTEM.md`;

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

function isWithinVault(vaultPath: string, filePath: string): boolean {
  const relative = path.relative(vaultPath, filePath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
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
    if (parent !== dir && isWithinVault(vaultPath, dir)) {
      collect(parent);
    }
  };

  if (activeNotePath?.trim()) {
    const noteDir = path.dirname(path.join(vaultPath, activeNotePath));
    if (isWithinVault(vaultPath, noteDir)) {
      collect(noteDir);
    }
  }
  collect(vaultPath);

  return parts.join('\n\n---\n\n');
}


export function loadContextLayers(
  vaultPath: string,
  activeNotePath?: string | null,
): ContextLayers {
  const agentsMd = loadAgentsMdChain(vaultPath, activeNotePath);
  const systemMd = readFileIfExists(path.join(vaultPath, PIVI_SYSTEM_PROMPT_PATH)).trim();
  const { skills, skillsXml } = loadVaultSkills(vaultPath);
  return { agentsMd, systemMd, skillsXml, skills };
}
