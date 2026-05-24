import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Skill } from '@earendil-works/pi-coding-agent/dist/core/skills.js';
import * as fs from 'fs';

import { textResult } from './toolResult';

function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) {
    return content;
  }
  const end = content.indexOf('---', 3);
  if (end === -1) {
    return content;
  }
  return content.slice(end + 3).replace(/^\s+/, '');
}

export function createSkillTool(skills: Skill[]): AgentTool {
  return {
    name: 'skill',
    label: 'Skill',
    description:
      'Load full instructions for a vault skill from .obsius/skills/. Use when a task matches a skill description.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Skill name from available_skills' },
        args: { type: 'string', description: 'Optional user context appended after skill body' },
      },
      required: ['name'],
      additionalProperties: false,
    },
    async execute(_id, params) {
      const { name, args } = params as { name: string; args?: string };
      const skill = skills.find((s) => s.name === name);
      if (!skill) {
        const available = skills.map((s) => s.name).join(', ') || '(none installed)';
        throw new Error(`Unknown skill "${name}". Available: ${available}`);
      }
      const raw = fs.readFileSync(skill.filePath, 'utf-8');
      const body = stripFrontmatter(raw);
      const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">
References are relative to ${skill.baseDir}.

${body}
</skill>`;
      const text = args?.trim() ? `${skillBlock}\n\n${args.trim()}` : skillBlock;
      return textResult(text, { baseDir: skill.baseDir, filePath: skill.filePath });
    },
  };
}
