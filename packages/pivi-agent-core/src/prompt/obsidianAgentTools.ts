import {
  OBSIDIAN_AGENT_TOOLS,
  TOOL_OBSIDIAN_ATTACHMENT,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_OPEN,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '@pivi/pivi-agent-core/tools';
import { TOOL_SKILL, TOOL_SUBAGENT } from '@pivi/pivi-agent-core/tools';

export interface RegisteredToolSummary {
  obsidianTools: readonly string[];
  includeMcp: boolean;
  includeSkill: boolean;
  includeSubagent: boolean;
  includeWebSearch: boolean;
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
    '**Image generation:** Use `obsidian_generate_image` only for explicit image requests and only when it appears in the tool list below. It is enabled only when the user has the `openai-codex` provider connected (ChatGPT Plus/Pro Codex) in provider settings. Generated images are saved as Obsidian attachments and can be inserted into notes as embeds.',
    '**History recovery:** Use `obsidian_history` before giving up on a deleted, overwritten, or accidentally changed vault note. Use `action: "files"` when the path is unknown or the file may have been deleted and needs discovery through Obsidian’s history index. Use `action: "list"` first when the path is known, then pick a version number from the output. Use `action: "read"` to inspect candidate content before restoring when practical. Use `action: "restore"` to restore the chosen version in place. To restore content to a different path, use `read` first, then `obsidian_write`. History restore depends on Obsidian’s stored history; if no version exists, surface the CLI error instead of claiming recovery.',
  );
  for (const name of summary.obsidianTools) {
    lines.push(`- \`${name}\` — ${describeObsidianTool(name)}`);
  }

  if (summary.allowCommand) {
    lines.push(`- \`${TOOL_OBSIDIAN_COMMAND}\` — Execute an Obsidian palette command by id`);
  }
  if (summary.allowEval) {
    lines.push(`- \`${TOOL_OBSIDIAN_EVAL}\` — Run JavaScript in Obsidian; use sparingly`);
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

  if (summary.includeWebSearch) {
    lines.push(
      '',
      '### Web',
      '',
      '**`WebSearch`** — Search the web for up-to-date information beyond your training cutoff. Use it for recent events, current versions, library docs, or anything time-sensitive. Parameters: `query`, optional `recency` (`day`|`week`|`month`|`year`), optional `limit`, optional `provider` (`auto`|`brave`|`tavily`|`exa`). Results include titles, URLs, and optional snippets.',
      '**`WebFetch`** — Fetch readable content from a specific HTTP(S) URL. Parameters: `url`, optional `query`, optional `maxChars`, optional `provider` (`auto`|`tavily`|`exa`). Use Tavily or Exa when configured, with direct HTTP fallback.',
      '- Use `WebSearch` when you need discovery, current facts, or sources.',
      '- Use `WebFetch` when you already have a URL and need page content.',
      '- Cite URLs when relying on web results or fetched content.',
    );
  }

  lines.push(
    '',
    '### Reading attached paths',
    '',
    'When `<context_files>` is present, each entry is a vault-relative path (e.g. `notes/foo.md`).',
    '',
    '- The list is **exhaustive for this turn**: for `@folder/` mentions it already includes every file under that folder. Counting or listing folder contents does not require extra search tools—use the paths given.',
    '- For Markdown files, call `obsidian_read` with `mode: "stats"` first when the file may be large. If it reports a large file, prefer `obsidian_markdown_structure` and then `obsidian_read` with `startLine` / `endLine` for only the needed section. If the whole file is truly needed, call `obsidian_read` again with `maxChars` set at least to the reported `Characters` value; do this deliberately because the full file enters context.',
    '- **Prefer** `obsidian_read` with `path: "<exact path from context_files>"`; for large notes, prefer `mode: "stats"` or a line range before reading the full body, unless you intentionally raise `maxChars` to read the entire file.',
    '- Do **not** use a leading `/` or the vault absolute path for vault files.',
    '- Use `file:` (wikilink name) only when you have a note title and no path in `<context_files>`.',
    '- If `obsidian_read` returns "Note not found", retry with the other parameter (`path` vs `file`) or verify the path matches `<context_files>` exactly.',
    '',
    '**API vs CLI:** Most vault tools use the in-process Obsidian API. `obsidian_tasks` and `obsidian_history` require Obsidian CLI (`cliEnabled`). `obsidian_command` / `obsidian_eval` are CLI-only when enabled.',
    '**Priority:** `obsidian_edit` before `obsidian_write` for existing notes. Read with `obsidian_read` when you need exact `old_string` text. `obsidian_write` `overwrite` is last resort (new file or full rewrite only).',
    '**Exact match:** `old_string` must be copied verbatim from `obsidian_read`—Chinese notes often use curly quotes `“` `”` (U+201C/U+201D), not ASCII `"`. Retyping causes `old_string not found`; the tool error may call this out.',
    '**Search:** `obsidian_search` is case-insensitive substring scan + simplified `tag:` / `path:` / `*` folder listing — not Obsidian in-app search syntax. Do not repeat the same search with different casing.',
    '**Listing:** Prefer `obsidian_list` over `obsidian_search query=*` when you need non-Markdown files or folders.',
    '**Paths:** Vault tools use vault-relative `path=` unless documented otherwise; external directories use absolute paths.',
    '**Compact UI:** Vault tool cards show paths and match counts in the tool header. Do not repeat the same file list in the next message—add interpretation or the next action only.',
  );

  return lines.join('\n');
}

function describeObsidianTool(name: string): string {
  switch (name) {
    case TOOL_OBSIDIAN_READ:
      return 'Read note body safely (vault API): use mode=stats for large files, then startLine/endLine ranges for selected content';
    case TOOL_OBSIDIAN_MARKDOWN_STRUCTURE:
      return 'Extract Markdown heading structure with line numbers and character counts so large notes can be read section-by-section';
    case TOOL_OBSIDIAN_EDIT:
      return '**Preferred** for partial edits: copy old_string verbatim from obsidian_read (curly “ ” vs straight " matters); replace_all if needed';
    case TOOL_OBSIDIAN_WRITE:
      return 'append/prepend, create, or full overwrite only—do not use overwrite for small edits (use obsidian_edit)';
    case TOOL_OBSIDIAN_SEARCH:
      return 'Case-insensitive substring search or list .md files in a folder (query=* or path:folder); not Obsidian search syntax; do not repeat with different casing';
    case TOOL_OBSIDIAN_NOTE_INFO:
      return 'Note metadata: size, dates, tags, outgoing link paths, frontmatter (vault API)';
    case TOOL_OBSIDIAN_LINKS:
      return 'Outgoing links or backlinks for one note (MetadataCache; JSON)';
    case TOOL_OBSIDIAN_PROPERTIES:
      return 'List/read/set/remove frontmatter properties (CLI only; needs cliEnabled)';
    case TOOL_OBSIDIAN_TASKS:
      return 'List or toggle markdown tasks (CLI only; needs cliEnabled)';
    case TOOL_OBSIDIAN_HISTORY:
      return 'List/read/restore Obsidian file history versions through the Obsidian CLI; can restore deleted files when history exists';
    case TOOL_OBSIDIAN_DELETE:
      return 'Move a vault file or folder to trash via Obsidian FileManager; path= preferred';
    case TOOL_OBSIDIAN_MOVE:
      return 'Rename or move a vault file/folder and update links according to Obsidian settings';
    case TOOL_OBSIDIAN_LIST:
      return 'List direct children of a vault folder, including files, folders, and attachments';
    case TOOL_OBSIDIAN_MKDIR:
      return 'Create a vault folder';
    case TOOL_OBSIDIAN_OPEN:
      return 'Open a vault file in the Obsidian workspace';
    case TOOL_OBSIDIAN_ATTACHMENT:
      return 'Get attachment metadata/resource URL or ask Obsidian for an available attachment path';
    case TOOL_OBSIDIAN_GENERATE_IMAGE:
      return 'Generate an image via openai-codex, save it as a vault attachment, and optionally insert the ![[image]] embed into a note (requires provider configuration)';
    default:
      return 'Vault operation';
  }
}

export function defaultObsidianToolList(): readonly string[] {
  return OBSIDIAN_AGENT_TOOLS;
}
