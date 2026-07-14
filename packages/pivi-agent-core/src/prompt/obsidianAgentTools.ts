import {
  OBSIDIAN_AGENT_TOOLS,
  TOOL_OBSIDIAN_ATTACHMENT,
  TOOL_OBSIDIAN_BASE,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_DAILY,
  TOOL_OBSIDIAN_DELETE,
  TOOL_OBSIDIAN_EDIT,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_GENERATE_IMAGE,
  TOOL_OBSIDIAN_GRAPH,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LINKS,
  TOOL_OBSIDIAN_LIST,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
  TOOL_OBSIDIAN_MKDIR,
  TOOL_OBSIDIAN_MOVE,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_OPEN,
  TOOL_OBSIDIAN_PROPERTIES,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TAGS,
  TOOL_OBSIDIAN_TASKS,
  TOOL_OBSIDIAN_WRITE,
} from '../tools';
import { TOOL_SKILL, TOOL_SPAWN_AGENT } from '../tools';
import {
  buildMcpInventoryLines,
  type McpInventoryServer,
} from './mcpInventory';

export interface RegisteredToolSummary {
  obsidianTools: readonly string[];
  obsidianCliAvailable: boolean;
  includeMcp: boolean;
  /** Cached inventory of settings-enabled MCP servers/tools for prompt injection. */
  mcpInventory?: readonly McpInventoryServer[];
  includeSkill: boolean;
  includeSubagent: boolean;
  maxConcurrentSubagents?: number;
  includeWebSearch: boolean;
}

export function buildRegisteredToolsSection(summary: RegisteredToolSummary): string {
  const lines: string[] = ['## Available Tools', '', 'Use only the tools listed below. Do not invent tool names.'];
  const registeredObsidianTools = new Set(summary.obsidianTools);
  const obsidianCliAvailable = summary.obsidianCliAvailable;
  const hasRead = registeredObsidianTools.has(TOOL_OBSIDIAN_READ);
  const hasReadExternal = registeredObsidianTools.has(TOOL_OBSIDIAN_READ_EXTERNAL);
  const hasListExternal = registeredObsidianTools.has(TOOL_OBSIDIAN_LIST_EXTERNAL);
  const hasExternalRead = hasReadExternal || hasListExternal;
  const hasMarkdownStructure = registeredObsidianTools.has(TOOL_OBSIDIAN_MARKDOWN_STRUCTURE);
  const hasSearch = registeredObsidianTools.has(TOOL_OBSIDIAN_SEARCH);
  const hasNoteInfo = registeredObsidianTools.has(TOOL_OBSIDIAN_NOTE_INFO);
  const hasHistory = registeredObsidianTools.has(TOOL_OBSIDIAN_HISTORY);

  lines.push(
    '',
    '### Obsidian vault',
    '',
    '**Mutating notes:** Prefer **`obsidian_edit`** for any partial change to an existing file. Use **`obsidian_write`** only for `append`/`prepend`, new files (`create`), or a deliberate full-body `overwrite`. Never use `overwrite` when `obsidian_edit` or `append`/`prepend` can do the job.',
    '**Vault paths:** Use `obsidian_list` for folders/files/attachments, `obsidian_mkdir` for folders, `obsidian_move` for renames/moves, and `obsidian_delete` to move items to trash.',
    '**Image generation:** Use `obsidian_generate_image` only for explicit image requests and only when it appears in the tool list below. It is enabled only when the user has the `openai-codex` provider connected (ChatGPT Plus/Pro Codex) in provider settings. Generated images are saved as Obsidian attachments and can be inserted into notes as standard Markdown `![](...)` embeds.',
  );
  if (hasHistory && obsidianCliAvailable) {
    lines.push('**History recovery:** Use `obsidian_history` before giving up on a deleted, overwritten, or accidentally changed vault note. Use `action: "files"` when the path is unknown or the file may have been deleted and needs discovery through Obsidian’s history index. Use `action: "list"` first when the path is known, then pick a version number from the output. Use `action: "read"` to inspect candidate content before restoring when practical. Use `action: "restore"` to restore the chosen version in place. To restore content to a different path, use `read` first, then `obsidian_write`. History restore depends on Obsidian’s stored history; if no version exists, surface the CLI error instead of claiming recovery.');
  }
  const promptContext = { obsidianCliAvailable };
  for (const name of summary.obsidianTools) {
    const parameters = describeObsidianToolParameters(name, promptContext);
    lines.push(`- \`${name}\` — ${describeObsidianTool(name, promptContext)}${parameters ? ` Parameters: ${parameters}` : ''}`);
  }

  if (summary.includeMcp) {
    lines.push(
      '',
      '### MCP',
      '- `mcp` — Vault MCP servers (.pivi/mcp.json). All settings-enabled servers are available; use search/list before calling tools.',
    );
    const inventory = buildMcpInventoryLines(summary.mcpInventory ?? []);
    if (inventory.length > 0) {
      lines.push(...inventory);
    }
  }

  if (summary.includeSkill) {
    lines.push('', '### Skills', `- \`${TOOL_SKILL}\` — Load a vault skill by name from .pivi/skills/`);
  }

  if (summary.includeSubagent) {
    const maxConcurrentSubagents = summary.maxConcurrentSubagents ?? 3;
    lines.push(
      '',
      '### Subagents',
      `- \`${TOOL_SPAWN_AGENT}\` — Spawn a focused sub-agent for a subtask. Required parameters: \`label\` is the short stable sub-agent/card name; \`message\` is the complete task instructions. Put task instructions in \`message\`, never in a \`description\` field. Example: \`{ "label": "scan-links", "message": "Search the assigned notes for broken links and report them.", "run_in_background": true }\`. Use \`run_in_background: true\` for independent async work.`,
      `- At most ${maxConcurrentSubagents} background sub-agents may run at once across this Pivi plugin, shared across all tabs. When two or more independent tasks are ready, emit up to ${maxConcurrentSubagents} \`spawn_agent\` calls together in the same assistant response, each with \`run_in_background: true\`; the runtime starts that batch concurrently. Do not wait for one result before emitting the next independent spawn. Excess calls wait in FIFO order and their tool result reports the capacity overflow.`,
      `- Sub-agents are an active execution strategy, not a last resort. If the user asks for, allows, or says you can/may use sub-agents, treat that permission as an instruction to use them whenever the work can be split safely. For a large folder or attached-file list, create ${maxConcurrentSubagents} balanced non-overlapping batches (or fewer only when fewer useful batches exist) and emit all of those \`spawn_agent\` calls together before inspecting delegated files yourself. Do not spawn only one worker and wait when multiple independent batches are available.`,
      '- Do not spawn a sub-agent just to check, poll, wait for, or summarize other sub-agents. Background sub-agents stream their progress and final results back into their existing cells automatically; wait for those updates and synthesize only from actual reports.',
      '- Automatically use multiple sub-agents when the same nontrivial task applies to multiple distinct context groups (for example several files, folders, notes, or source batches). Use no more than the configured maximum above; prefer one stable sub-agent per balanced group so each worker reads its own batch while the main agent coordinates and synthesizes.',
      '- When a very long file must be read end-to-end, prefer assigning that file to a sub-agent as its own isolated context batch with `run_in_background: true`, so the worker can keep reading, searching, and using tools in the background while streaming progress/results back without importing the whole file into the main session. Only full-read it in the main session when delegation is unavailable, explicitly disallowed, or exact full text must be present in the main context.',
      '- When delegating attached context or vault files, assign a stable, non-overlapping context batch to each sub-agent and use clear labels so the resulting cards remain easy to audit. Do not have the main agent pre-read, summarize, or mix delegated files unless the sub-agent reports back first; this prevents context cross-contamination and keeps delegated context out of the main session.',
      '- Do not split one context batch across multiple sub-agents, and do not send unrelated context batches to the same sub-agent. Each spawn_agent call gets an isolated worker; labels are for coordination, not a safe memory boundary.',
    );
  }

  if (summary.includeWebSearch) {
    lines.push(
      '',
      '### Web',
      '',
      '**`WebSearch`** — Search the web for up-to-date information beyond your training cutoff. Use it for recent events, current versions, library docs, or anything time-sensitive. Parameters: `query`, optional `recency` (`day`|`week`|`month`|`year`), optional `limit`. Enabled providers run in the user-configured priority order with automatic fallback.',
      '**`WebFetch`** — Fetch readable content from a specific HTTP(S) URL. Parameters: `url`, optional `query`, optional `maxChars`. Enabled fetch providers run in the user-configured priority order, with direct HTTP fallback.',
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
    ...(summary.includeSubagent ? [
      buildSubagentDelegationGuidance({ hasRead, hasMarkdownStructure, hasSearch, hasNoteInfo }),
      '- **Automatic delegation for complex multi-context tasks:** When multiple attached context groups need the same substantive analysis, comparison, extraction, or transformation, prefer spawning sub-agents automatically instead of reading every group in the main session. Use direct main-agent reads only for simple lookups, tiny context, or when the task clearly needs one shared reading pass.',
    ] : []),
    '- The list is **exhaustive for this turn**: for `@folder/` mentions it already includes every file under that folder. Counting or listing folder contents does not require extra search tools—use the paths given.',
    ...buildMarkdownReadGuidance({ hasRead, hasMarkdownStructure, hasSubagent: summary.includeSubagent }),
    '- Do **not** use a leading `/` or the vault absolute path for vault files.',
    ...(hasRead ? [
      '- Use `file:` (wikilink name) only when you have a note title and no path in `<context_files>`.',
      '- If `obsidian_read` returns "Note not found", retry with the other parameter (`path` vs `file`) or verify the path matches `<context_files>` exactly.',
    ] : []),
    ...(hasExternalRead ? [
      '',
      buildExternalReadGuidance({ hasReadExternal, hasListExternal }),
    ] : []),
    '',
    buildApiVsCliGuidance(registeredObsidianTools, obsidianCliAvailable),
    buildEditPriorityGuidance(hasRead),
    buildExactMatchGuidance(hasRead),
    '**Search:** `obsidian_search` is case-insensitive substring scan + simplified `tag:` / `path:` / `*` folder listing — not Obsidian in-app search syntax. Do not repeat the same search with different casing.',
    hasListExternal
      ? '**Listing:** Prefer `obsidian_list` for vault folders and `obsidian_list_external` for external folders; avoid `obsidian_search query=*` for simple listing.'
      : '**Listing:** Prefer `obsidian_list` over `obsidian_search query=*` when you need non-Markdown files or folders.',
    '**Paths:** Vault tools use vault-relative `path=` unless documented otherwise' + (hasExternalRead ? '; registered external tools use absolute paths under allowed external directories.' : '.'),
    '**Compact UI:** Vault tool cards show paths and match counts in the tool header. Do not repeat the same file list in the next message—add interpretation or the next action only.',
  );

  return lines.join('\n');
}

function buildExternalReadGuidance(params: { hasReadExternal: boolean; hasListExternal: boolean }): string {
  const clauses: string[] = [];
  if (params.hasReadExternal) {
    clauses.push('use `obsidian_read_external` with an absolute path under an allowed external directory (`path: "/Users/me/Workspace/file.ts"`). It supports `mode: "stats"` and line ranges just like `obsidian_read`');
  }
  if (params.hasListExternal) {
    clauses.push('use `obsidian_list_external` to list an allowed external folder');
  }
  return `**External files:** ${clauses.join('; ')}. Do not use vault-relative paths for external files, and do not use \`obsidian_read\` for absolute paths.`;
}

function buildApiVsCliGuidance(registeredObsidianTools: Set<string>, obsidianCliAvailable: boolean): string {
  const cliRequiredTools = [
    TOOL_OBSIDIAN_TASKS,
    TOOL_OBSIDIAN_HISTORY,
    TOOL_OBSIDIAN_DAILY,
  ].filter((name) => registeredObsidianTools.has(name));
  const cliOnlyTools = [
    TOOL_OBSIDIAN_COMMAND,
    TOOL_OBSIDIAN_EVAL,
  ].filter((name) => registeredObsidianTools.has(name));
  const shellTools = [
    TOOL_OBSIDIAN_BASH,
  ].filter((name) => registeredObsidianTools.has(name));

  const notes = ['**API vs CLI:** Most vault tools use the in-process Obsidian API.'];
  if (!obsidianCliAvailable) {
    notes.push('Obsidian CLI is not available for this turn (disabled in Pivi settings or not enabled in Obsidian). Do not use CLI-only tools or CLI-only actions; use API-backed actions when listed. If the user’s request cannot be completed without a CLI-only tool/action (for example history restore, daily-note commands, command/eval, tasks, or base query), stop and ask the user to enable Pivi’s Obsidian CLI setting and Obsidian Settings → General → Command line interface, then retry.');
  }
  if (cliRequiredTools.length > 0 && obsidianCliAvailable) {
    notes.push(`${cliRequiredTools.map((name) => `\`${name}\``).join(' / ')} require Obsidian CLI (\`cliEnabled\`).`);
  }
  if (cliOnlyTools.length > 0 && obsidianCliAvailable) {
    notes.push(`${cliOnlyTools.map((name) => `\`${name}\``).join(' / ')} are CLI-only.`);
  }
  if (registeredObsidianTools.has(TOOL_OBSIDIAN_BASE)) {
    notes.push(obsidianCliAvailable
      ? `\`${TOOL_OBSIDIAN_BASE}\` lists base files/views through the vault API; only its query action requires Obsidian CLI.`
      : `\`${TOOL_OBSIDIAN_BASE}\` can list base files/views through the vault API; its query action is unavailable without Obsidian CLI.`);
  }
  if (shellTools.length > 0) {
    notes.push(`${shellTools.map((name) => `\`${name}\``).join(' / ')} runs one allowlisted single-line shell command, but Bash is the lowest-priority tool: when an Obsidian-specific tool can do the job, use that tool instead of Bash.`);
  }
  return notes.join(' ');
}

function buildEditPriorityGuidance(hasRead: boolean): string {
  const readClause = hasRead ? ' Read with `obsidian_read` when you need exact `old_string` text.' : '';
  return `**Priority:** \`obsidian_edit\` before \`obsidian_write\` for existing notes.${readClause} \`obsidian_write\` \`overwrite\` is last resort (new file or full rewrite only).`;
}

function buildExactMatchGuidance(hasRead: boolean): string {
  const source = hasRead ? ' from `obsidian_read`' : ' from available note context';
  return `**Exact match:** \`old_string\` must be copied verbatim${source}—Chinese notes often use curly quotes \`“\` \`”\` (U+201C/U+201D), not ASCII \`"\`. Retyping causes \`old_string not found\`; the tool error may call this out.`;
}

function buildSubagentDelegationGuidance(params: {
  hasRead: boolean;
  hasMarkdownStructure: boolean;
  hasSearch: boolean;
  hasNoteInfo: boolean;
}): string {
  const directReadTools = [
    ...(params.hasRead ? ['`obsidian_read`'] : []),
    ...(params.hasMarkdownStructure ? ['`obsidian_markdown_structure`'] : []),
    ...(params.hasSearch ? ['`obsidian_search`'] : []),
    ...(params.hasNoteInfo ? ['`obsidian_note_info`'] : []),
  ];
  const blockedActions = directReadTools.length > 0
    ? directReadTools.join(', ')
    : 'direct vault-reading tools';
  const statsClause = params.hasRead ? ' or `mode: "stats"`' : '';
  return `- **Sub-agent delegation overrides direct inspection:** If the user asks for or permits subagents/sub-agents/spawn_agent for attached paths or a folder, the main agent must not call ${blockedActions}${statsClause} on files it intends to delegate before the sub-agent reports back. Permission such as "you can/may use subagents" counts. Spawn the balanced concurrent batch first, up to the configured maximum, then synthesize from actual reports.`;
}

function buildMarkdownReadGuidance(params: {
  hasRead: boolean;
  hasMarkdownStructure: boolean;
  hasSubagent: boolean;
}): string[] {
  if (!params.hasRead) {
    const fallback = params.hasSubagent
      ? ' or delegate when appropriate'
      : '';
    return [`- No direct note-read tool is registered for this turn; rely on attached context content${fallback} instead of inventing a read tool.`];
  }
  if (params.hasMarkdownStructure) {
    const subagentFullReadGuidance = params.hasSubagent
      ? ['- If stats/structure show a large file and the task truly requires reading the whole file, prefer `spawn_agent` with `run_in_background: true` and that single file as the delegated context batch. Let the worker continue interacting with vault/tools in the background and stream progress/results back instead of importing the full body into the main session; use main-session full read only as an explicit fallback.']
      : [];
    return [
      ...subagentFullReadGuidance,
      '- For Markdown files, call `obsidian_read` with `mode: "stats"` first when the file may be large. If it reports a large file, prefer `obsidian_markdown_structure` and then `obsidian_read` with `startLine` / `endLine` for only the needed section. If the whole file is truly needed, call `obsidian_read` again with `maxChars` set at least to the reported `Characters` value; do this deliberately because the full file enters context.',
      '- **Prefer** `obsidian_read` with `path: "<exact path from context_files>"`; for large notes, prefer `mode: "stats"` or a line range before reading the full body, unless you intentionally raise `maxChars` to read the entire file.',
    ];
  }
  return [
    '- For Markdown files, use `obsidian_read` with `path: "<exact path from context_files>"`. For large notes, prefer `mode: "stats"` or a line range before reading the full body; `obsidian_markdown_structure` is not registered for this turn, so do not call it.',
  ];
}

interface ObsidianToolPromptContext {
  obsidianCliAvailable: boolean;
}

function describeObsidianTool(name: string, context: ObsidianToolPromptContext): string {
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
      return context.obsidianCliAvailable
        ? 'Case-insensitive substring search or list .md files in a folder (query=* or path:folder) through the vault API, with CLI fallback on API errors; not Obsidian search syntax; do not repeat with different casing'
        : 'Case-insensitive substring search or list .md files in a folder (query=* or path:folder) through the vault API only; no CLI fallback is available; not Obsidian search syntax; do not repeat with different casing';
    case TOOL_OBSIDIAN_NOTE_INFO:
      return context.obsidianCliAvailable
        ? 'Note metadata: size, dates, tags, outgoing link paths, frontmatter, aliases, and counts through the vault API, with CLI fallback on API errors'
        : 'Note metadata: size, dates, tags, outgoing link paths, frontmatter, aliases, and counts through the vault API only; no CLI fallback is available';
    case TOOL_OBSIDIAN_LINKS:
      return context.obsidianCliAvailable
        ? 'Outgoing links or backlinks for one note (MetadataCache; JSON), with CLI fallback on API errors'
        : 'Outgoing links or backlinks for one note (MetadataCache; JSON) through the vault API only; no CLI fallback or alternate CLI formats are available';
    case TOOL_OBSIDIAN_PROPERTIES:
      return 'List/read/set/remove frontmatter properties (vault API)';
    case TOOL_OBSIDIAN_TASKS:
      return context.obsidianCliAvailable
        ? 'List or toggle markdown tasks (CLI only; needs cliEnabled)'
        : 'CLI-only task operations are unavailable because Obsidian CLI is not available for this turn; do not call this tool';
    case TOOL_OBSIDIAN_HISTORY:
      return context.obsidianCliAvailable
        ? 'List/read/restore Obsidian file history versions through the Obsidian CLI; can restore deleted files when history exists'
        : 'CLI-only history recovery is unavailable because Obsidian CLI is not available for this turn; do not call this tool';
    case TOOL_OBSIDIAN_DELETE:
      return 'Move a vault file or folder to trash via Obsidian FileManager; path= preferred';
    case TOOL_OBSIDIAN_MOVE:
      return 'Rename or move a vault file/folder and update links according to Obsidian settings';
    case TOOL_OBSIDIAN_LIST:
      return 'List direct children of a vault folder, including files, folders, and attachments';
    case TOOL_OBSIDIAN_READ_EXTERNAL:
      return 'Read external files by absolute path for research; use mode=stats for large files, then startLine/endLine ranges for selected content';
    case TOOL_OBSIDIAN_LIST_EXTERNAL:
      return 'List direct children of an external folder by absolute path';
    case TOOL_OBSIDIAN_MKDIR:
      return 'Create a vault folder';
    case TOOL_OBSIDIAN_OPEN:
      return 'Open a vault file in the Obsidian workspace';
    case TOOL_OBSIDIAN_ATTACHMENT:
      return 'Get attachment metadata/resource URL or ask Obsidian for an available attachment path';
    case TOOL_OBSIDIAN_GENERATE_IMAGE:
      return 'Generate an image via openai-codex, save it as a vault attachment, and optionally insert a standard Markdown ![](assets/image.png) embed into a note (requires provider configuration)';
    case TOOL_OBSIDIAN_DAILY:
      return context.obsidianCliAvailable
        ? 'Read, append, prepend, or resolve the current daily note through the Obsidian CLI'
        : 'CLI-only daily-note operations are unavailable because Obsidian CLI is not available for this turn; do not call this tool';
    case TOOL_OBSIDIAN_GRAPH:
      return 'Analyze vault graph data through MetadataCache: orphans, deadends, and unresolved wikilinks';
    case TOOL_OBSIDIAN_TAGS:
      return 'List vault tags with counts or inspect notes for a specific tag through MetadataCache';
    case TOOL_OBSIDIAN_BASE:
      return context.obsidianCliAvailable
        ? 'List .base files, inspect configured views through the vault API, or query a base view through the Obsidian CLI'
        : 'List .base files and inspect configured views through the vault API; query is unavailable without Obsidian CLI';
    case TOOL_OBSIDIAN_BASH:
      return 'Lowest priority: run one Bash-tool-toggle-enabled, user-allowlisted single-line shell command only when no Obsidian-specific tool can do the job; shell control syntax such as pipes, redirects, command substitution, semicolons, and &&/|| is rejected';
    case TOOL_OBSIDIAN_COMMAND:
      return context.obsidianCliAvailable
        ? 'Execute an Obsidian palette command by id through the Obsidian CLI'
        : 'CLI-only Obsidian command execution is unavailable because Obsidian CLI is not available for this turn; do not call this tool';
    case TOOL_OBSIDIAN_EVAL:
      return context.obsidianCliAvailable
        ? 'Run JavaScript in Obsidian through the Obsidian CLI; use sparingly'
        : 'CLI-only Obsidian JavaScript eval is unavailable because Obsidian CLI is not available for this turn; do not call this tool';
    default:
      return 'Vault operation';
  }
}

function describeObsidianToolParameters(name: string, context: ObsidianToolPromptContext): string {
  switch (name) {
    case TOOL_OBSIDIAN_READ:
      return '`file?` wikilink title, `path?` vault-relative note path, `mode?` content|stats, `startLine?`/`endLine?` 1-based inclusive range, `maxChars?` content character cap.';
    case TOOL_OBSIDIAN_MARKDOWN_STRUCTURE:
      return '`file?` wikilink title, `path?` vault-relative Markdown path, `maxHeadings?` heading cap.';
    case TOOL_OBSIDIAN_EDIT:
      return '`old_string` exact required text, `new_string` required replacement, `file?` wikilink title or `path?` vault-relative path, `replace_all?` true to replace every occurrence.';
    case TOOL_OBSIDIAN_WRITE:
      return '`content` required, `mode` required create|overwrite|append|prepend, `file?` wikilink title or `path?` vault-relative path, `overwrite?` permits replacing an existing file when mode=create.';
    case TOOL_OBSIDIAN_SEARCH:
      return context.obsidianCliAvailable
        ? '`query` required plain substring/tag:name/path:folder/*, `path?` folder prefix, `limit?`, `context?` include nearby lines, `format?` json|text; API first, CLI fallback preserves json/text when API fails.'
        : '`query` required plain substring/tag:name/path:folder/*, `path?` folder prefix, `limit?`, `context?` include nearby lines, `format?` json|text; API-only for this turn, so report API errors instead of retrying with CLI syntax.';
    case TOOL_OBSIDIAN_NOTE_INFO:
      return context.obsidianCliAvailable
        ? '`file?` wikilink title, `path?` vault-relative path, `action?` recent (ignores file/path), `limit?` recent-file cap; API first with CLI fallback for direct file/path metadata.'
        : '`file?` wikilink title, `path?` vault-relative path, `action?` recent (ignores file/path), `limit?` recent-file cap; API-only for this turn, with no CLI fallback.';
    case TOOL_OBSIDIAN_LINKS:
      return context.obsidianCliAvailable
        ? '`file?` wikilink title or `path?` vault-relative path, `direction?` outgoing|backlinks, `format?` json|tsv|csv for CLI fallback only; API results are JSON.'
        : '`file?` wikilink title or `path?` vault-relative path, `direction?` outgoing|backlinks, `format?` ignored because API-only results are JSON; do not request tsv/csv without CLI.';
    case TOOL_OBSIDIAN_PROPERTIES:
      return '`action` required list|read|set|remove, `name?` property name (required for read/set/remove), `value?` string value required for set, `file?` or `path?` target note.';
    case TOOL_OBSIDIAN_TASKS:
      return '`action` required list|toggle|done|todo, `file?`, `path?`, `line?`, `ref?` path:line, `daily?`, `todo?` filter, `done?` filter.';
    case TOOL_OBSIDIAN_HISTORY:
      return '`action` required files|list|read|restore, `path?` required except action=files, `version?` required for read/restore.';
    case TOOL_OBSIDIAN_DELETE:
      return '`file?` wikilink title for files, or `path?` vault-relative file/folder path; use path for folders.';
    case TOOL_OBSIDIAN_MOVE:
      return '`path` required existing vault-relative file/folder path, `newPath` required destination path.';
    case TOOL_OBSIDIAN_LIST:
      return '`path?` vault-relative folder path; empty or omitted means vault root.';
    case TOOL_OBSIDIAN_READ_EXTERNAL:
      return '`path` required absolute filesystem file path, `mode?` content|stats, `startLine?`/`endLine?` 1-based inclusive range, `maxChars?` content character cap.';
    case TOOL_OBSIDIAN_LIST_EXTERNAL:
      return '`path` required absolute filesystem folder path.';
    case TOOL_OBSIDIAN_MKDIR:
      return '`path` required vault-relative folder path to create.';
    case TOOL_OBSIDIAN_OPEN:
      return '`path` required vault-relative file path, `target?` current|tab|split|window.';
    case TOOL_OBSIDIAN_ATTACHMENT:
      return '`path?` existing vault-relative attachment path, or `filename?` desired attachment filename plus optional `sourcePath?` source note for placement rules.';
    case TOOL_OBSIDIAN_GENERATE_IMAGE:
      return '`prompt` required, `model?`, `outputFormat?` png|jpeg|webp, `filename?`, `sourcePath?`, `insertInto?`, `insertMode?` none|append|prepend|replace_string, `old_string?` required for replace_string.';
    case TOOL_OBSIDIAN_DAILY:
      return '`action` required read|append|prepend|path, `content?` required for append/prepend, `inline?` true to avoid newline separator.';
    case TOOL_OBSIDIAN_GRAPH:
      return '`actions?` comma-separated string or string array of orphans|deadends|unresolved (default orphans), `limit?` positive result cap, `includeNonMarkdown?` include attachments in orphans/deadends.';
    case TOOL_OBSIDIAN_TAGS:
      return '`action` required list|info, `name?` tag name required for info, `sort?` name|count for list, `verbose?` include matching files for info.';
    case TOOL_OBSIDIAN_BASE:
      return context.obsidianCliAvailable
        ? '`action` required list|views|query, `file?` base name or `path?` .base vault path required for views/query, `view?` query view name, `format?` json|csv|tsv|md|paths for query.'
        : '`action` required list|views (do not use query without CLI), `file?` base name or `path?` .base vault path required for views; `view?` and `format?` are query-only and unavailable without CLI.';
    case TOOL_OBSIDIAN_BASH:
      return '`command` required allowlisted single-line shell command, `cwd?` optional working directory.';
    case TOOL_OBSIDIAN_COMMAND:
      return '`id` required Obsidian command id.';
    case TOOL_OBSIDIAN_EVAL:
      return '`code` required JavaScript to run in Obsidian.';
    default:
      return '';
  }
}

export function defaultObsidianToolList(): readonly string[] {
  return OBSIDIAN_AGENT_TOOLS;
}
