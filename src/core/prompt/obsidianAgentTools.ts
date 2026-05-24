import {
  OBSIDIAN_AGENT_TOOLS,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '../tools/obsidianToolNames';
import { TOOL_MCP, TOOL_SKILL, TOOL_SUBAGENT } from '../tools/toolNames';

export interface RegisteredToolSummary {
  obsidianTools: readonly string[];
  includeMcp: boolean;
  includeSkill: boolean;
  includeSubagent: boolean;
  allowCommand: boolean;
  allowEval: boolean;
}

export function buildRegisteredToolsSection(summary: RegisteredToolSummary): string {
  const lines: string[] = ['## Available Tools', '', 'Use only the tools listed below. Do not invent tool names.'];

  lines.push('', '### Obsidian vault');
  for (const name of summary.obsidianTools) {
    lines.push(`- \`${name}\` — ${describeObsidianTool(name)}`);
  }

  if (summary.allowCommand) {
    lines.push(`- \`${TOOL_OBSIDIAN_COMMAND}\` — Execute an Obsidian palette command by id (requires approval)`);
  }
  if (summary.allowEval) {
    lines.push(`- \`${TOOL_OBSIDIAN_EVAL}\` — Run JavaScript in Obsidian (requires approval; use sparingly)`);
  }

  if (summary.includeMcp) {
    lines.push('', '### MCP', `- \`mcp\` — Vault MCP servers (.obsius/mcp.json); use @server mentions when required`);
  }

  if (summary.includeSkill) {
    lines.push('', '### Skills', `- \`${TOOL_SKILL}\` — Load a vault skill by name from .obsius/skills/`);
  }

  if (summary.includeSubagent) {
    lines.push('', '### Subagents', `- \`${TOOL_SUBAGENT}\` — Spawn a focused sub-agent for a subtask`);
  }

  lines.push(
    '',
    '**Obsidian CLI:** Search, links, tasks, and properties use the official Obsidian CLI (Obsidian must be running).',
    '**Paths:** Use vault-relative paths or wikilink file names unless a tool accepts `path=` explicitly.',
  );

  return lines.join('\n');
}

function describeObsidianTool(name: string): string {
  switch (name) {
    case TOOL_OBSIDIAN_READ:
      return 'Read note content';
    case TOOL_OBSIDIAN_WRITE:
      return 'Create, overwrite, append, or prepend note content';
    case TOOL_OBSIDIAN_SEARCH:
      return 'Full-text search (optionally with context lines)';
    case TOOL_OBSIDIAN_NOTE_INFO:
      return 'File metadata (path, size, dates)';
    case TOOL_OBSIDIAN_LINKS:
      return 'Outgoing links and backlinks';
    case TOOL_OBSIDIAN_PROPERTIES:
      return 'Read or set frontmatter properties';
    case TOOL_OBSIDIAN_TASKS:
      return 'List or update markdown tasks';
    default:
      return 'Vault operation';
  }
}

export function defaultObsidianToolList(): readonly string[] {
  return OBSIDIAN_AGENT_TOOLS;
}

/** Avoid exporting TOOL_MCP constant mismatch — runtime registers `mcp`. */
void TOOL_MCP;
