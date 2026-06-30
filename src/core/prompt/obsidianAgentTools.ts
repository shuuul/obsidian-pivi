import {
  OBSIDIAN_AGENT_TOOLS,
  TOOL_OBSIDIAN_ATTACHMENT,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_OPEN,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '../tools/obsidianToolNames';
import { TOOL_SKILL, TOOL_SUBAGENT } from '../tools/toolNames';

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

  lines.push(
    '',
    '### Obsidian vault',
    '',
    '**Mutating notes:** Prefer **`obsidian_edit`** for any partial change to an existing file. Use **`obsidian_write`** only for `append`/`prepend`, new files (`create`), or a deliberate full-body `overwrite`. Never use `overwrite` when `obsidian_edit` or `append`/`prepend` can do the job.',
    '**Vault paths:** Use `obsidian_list` for folders/files/attachments, `obsidian_mkdir` for folders, `obsidian_move` for renames/moves, and `obsidian_delete` to move items to trash.',
  );
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
    lines.push('', '### MCP', `- \`mcp\` — Vault MCP servers (.pivi/mcp.json); use /server/tool tokens when required`);
  }

  if (summary.includeSkill) {
    lines.push('', '### Skills', `- \`${TOOL_SKILL}\` — Load a vault skill by name from .pivi/skills/`);
  }

  if (summary.includeSubagent) {
    lines.push('', '### Subagents', `- \`${TOOL_SUBAGENT}\` — Spawn a focused sub-agent for a subtask`);
  }

  lines.push(
    '',
    '### Reading attached paths',
    '',
    'When `<context_files>` is present, each entry is a vault-relative path (e.g. `notes/foo.md`).',
    '',
    '- The list is **exhaustive for this turn**: for `@folder/` mentions it already includes every file under that folder. Counting or listing folder contents does not require extra search tools—use the paths given.',
    '- **Always prefer** `obsidian_read` with `path: "<exact path from context_files>"`.',
    '- Do **not** use a leading `/` or the vault absolute path for vault files.',
    '- Use `file:` (wikilink name) only when you have a note title and no path in `<context_files>`.',
    '- If `obsidian_read` returns "Note not found", retry with the other parameter (`path` vs `file`) or verify the path matches `<context_files>` exactly.',
    '',
    '**API vs CLI:** Most vault tools use the in-process Obsidian API. `obsidian_tasks` requires Obsidian CLI (`cliEnabled`). `obsidian_command` / `obsidian_eval` are CLI-only when enabled.',
    '**Priority:** `obsidian_edit` before `obsidian_write` for existing notes. Read with `obsidian_read` when you need exact `old_string` text. `obsidian_write` `overwrite` is last resort (new file or full rewrite only).',
    '**Exact match:** `old_string` must be copied verbatim from `obsidian_read`—Chinese notes often use curly quotes `“` `”` (U+201C/U+201D), not ASCII `"`. Retyping causes `old_string not found`; the tool error may call this out.',
    '**Search:** `obsidian_search` is substring scan + simplified `tag:` / `path:` / `*` folder listing — not Obsidian in-app search syntax.',
    '**Listing:** Prefer `obsidian_list` over `obsidian_search query=*` when you need non-Markdown files or folders.',
    '**Paths:** Vault tools use vault-relative `path=` unless documented otherwise; external directories use absolute paths.',
    '**Compact UI:** Vault tool cards show paths and match counts in the tool header. Do not repeat the same file list in the next message—add interpretation or the next action only.',
  );

  return lines.join('\n');
}

function describeObsidianTool(name: string): string {
  switch (name) {
    case TOOL_OBSIDIAN_READ:
      return 'Read note body (vault API); use path= from <context_files> when available';
    case TOOL_OBSIDIAN_EDIT:
      return '**Preferred** for partial edits: copy old_string verbatim from obsidian_read (curly “ ” vs straight " matters); replace_all if needed';
    case TOOL_OBSIDIAN_WRITE:
      return 'append/prepend, create, or full overwrite only—do not use overwrite for small edits (use obsidian_edit)';
    case TOOL_OBSIDIAN_SEARCH:
      return 'Substring search or list .md files in a folder (query=* or path:folder); not Obsidian search syntax';
    case TOOL_OBSIDIAN_NOTE_INFO:
      return 'Note metadata: size, dates, tags, outgoing link paths, frontmatter (vault API)';
    case TOOL_OBSIDIAN_LINKS:
      return 'Outgoing links or backlinks for one note (MetadataCache; JSON)';
    case TOOL_OBSIDIAN_PROPERTIES:
      return 'List/read/set/remove frontmatter properties (CLI only; needs cliEnabled)';
    case TOOL_OBSIDIAN_TASKS:
      return 'List or toggle markdown tasks (CLI only; needs cliEnabled)';
    case TOOL_OBSIDIAN_DELETE:
      return 'Move a vault file or folder to trash via Obsidian FileManager (requires approval; path= preferred)';
    case TOOL_OBSIDIAN_MOVE:
      return 'Rename or move a vault file/folder and update links according to Obsidian settings (requires approval)';
    case TOOL_OBSIDIAN_LIST:
      return 'List direct children of a vault folder, including files, folders, and attachments';
    case TOOL_OBSIDIAN_MKDIR:
      return 'Create a vault folder (requires approval)';
    case TOOL_OBSIDIAN_OPEN:
      return 'Open a vault file in the Obsidian workspace';
    case TOOL_OBSIDIAN_ATTACHMENT:
      return 'Get attachment metadata/resource URL or ask Obsidian for an available attachment path';
    default:
      return 'Vault operation';
  }
}

export function defaultObsidianToolList(): readonly string[] {
  return OBSIDIAN_AGENT_TOOLS;
}
