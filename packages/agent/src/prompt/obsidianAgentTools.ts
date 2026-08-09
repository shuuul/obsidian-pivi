import {
  TOOL_OBSIDIAN_BASE,
  TOOL_OBSIDIAN_BASH,
  TOOL_OBSIDIAN_COMMAND,
  TOOL_OBSIDIAN_DAILY,
  TOOL_OBSIDIAN_EVAL,
  TOOL_OBSIDIAN_HISTORY,
  TOOL_OBSIDIAN_LIST_EXTERNAL,
  TOOL_OBSIDIAN_MARKDOWN_STRUCTURE,
  TOOL_OBSIDIAN_NOTE_INFO,
  TOOL_OBSIDIAN_READ,
  TOOL_OBSIDIAN_READ_EXTERNAL,
  TOOL_OBSIDIAN_SEARCH,
  TOOL_OBSIDIAN_TASKS,
} from '../tools';
import { TOOL_SKILL, TOOL_SPAWN_AGENT, type ToolSpec } from '../tools';
import {
  buildMcpInventoryLines,
  type McpInventoryServer,
} from './mcpInventory';

export interface RegisteredToolSummary {
  obsidianTools: readonly string[];
  /** Actual registered specs. Their factories own detailed prompt usage. */
  toolSpecs?: readonly Pick<ToolSpec, 'name' | 'description' | 'parameters' | 'promptUsage'>[];
  obsidianCliAvailable: boolean;
  /** Effective Bash allowlist entries when `obsidian_bash` is registered for this turn. */
  bashAllowlist?: readonly string[];
  includeMcp: boolean;
  /** Cached inventory of settings-enabled MCP servers/tools for prompt injection. */
  mcpInventory?: readonly McpInventoryServer[];
  includeSkill: boolean;
  includeSubagent: boolean;
  maxConcurrentSubagents?: number;
  includeWebSearch: boolean;
}

export function buildRegisteredToolsSection(summary: RegisteredToolSummary): string {
  const registeredObsidianTools = new Set(summary.obsidianTools);
  const lines: string[] = [
    '## Available Tools',
    '',
    'Use only the tools listed below. Do not invent tool names, unregistered capabilities, or shell commands.',
    'If the request cannot be completed with the registered tools available for this turn, stop and explain what is missing.',
    ...(registeredObsidianTools.has(TOOL_OBSIDIAN_BASH) ? ['For Bash, prefer pre-approved allowlist commands; when the user explicitly asks you to run a specific shell command that is not allowlisted, you may call `obsidian_bash` and Pivi will ask the user to approve it in the sidebar.'] : []),
  ];
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
  const registeredSpecs = new Map(summary.toolSpecs?.map((spec) => [spec.name, spec]));
  for (const name of summary.obsidianTools) {
    const spec = registeredSpecs.get(name);
    if (!spec) continue;
    const parameters = spec.promptUsage?.parameters ?? describeSchemaParameters(spec.parameters);
    lines.push(`- \`${name}\` — ${spec.promptUsage?.summary ?? spec.description}${parameters ? ` Parameters: ${parameters}` : ''}`);
  }

  if (registeredObsidianTools.has(TOOL_OBSIDIAN_BASH)) {
    lines.push('', ...buildBashAllowlistGuidance(summary.bashAllowlist ?? []));
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
      `- \`${TOOL_SPAWN_AGENT}\` — Spawn a focused sub-agent for a subtask. Required parameters: \`label\` is the short stable sub-agent/card name; \`message\` is the complete task instructions; \`run_in_background\` selects async (\`true\`) or deliberately blocking (\`false\`) execution and must always be passed. Put task instructions in \`message\`, never in a \`description\` field. Example: \`{ "label": "scan-links", "message": "Search the assigned notes for broken links and report them.", "run_in_background": true }\`. Use \`run_in_background: true\` for independent async work.`,
      `- At most ${maxConcurrentSubagents} background sub-agents may run at once across this Pivi plugin, shared across all tabs. When two or more independent tasks are ready, emit up to ${maxConcurrentSubagents} \`spawn_agent\` calls together in the same assistant response, each with \`run_in_background: true\`; the runtime starts that batch concurrently. Do not wait for one result before emitting the next independent spawn. Excess calls wait in FIFO order and their tool result reports the capacity overflow.`,
      `- Sub-agents are an active execution strategy, not a last resort. If the user asks for, allows, or says you can/may use sub-agents, treat that permission as an instruction to use them whenever the work can be split safely. For a large folder or attached-file list, create ${maxConcurrentSubagents} balanced non-overlapping batches (or fewer only when fewer useful batches exist) and emit all of those \`spawn_agent\` calls together before inspecting delegated files yourself. Do not spawn only one worker and wait when multiple independent batches are available.`,
      '- Do not spawn a sub-agent just to check, poll, wait for, or summarize other sub-agents. Background sub-agents stream their progress and final results back into their existing cells automatically; wait for those updates and synthesize only from actual reports.',
      '- Automatically use multiple sub-agents when the same nontrivial task applies to multiple distinct context groups (for example several files, folders, notes, or source batches). Use no more than the configured maximum above; prefer one stable sub-agent per balanced group so each worker reads its own batch while the main agent coordinates and synthesizes.',
      '- When a very long file must be read end-to-end, prefer assigning that file to a sub-agent as its own isolated context batch with `run_in_background: true`, so the worker can keep reading, searching, and using tools in the background while streaming progress/results back without importing the whole file into the main session. Only full-read it in the main session when delegation is unavailable, explicitly disallowed, or exact full text must be present in the main context.',
      '- When delegating attached context or vault files, assign a stable, non-overlapping context batch to each sub-agent and use clear labels so the resulting cards remain easy to audit. Do not have the main agent pre-read, summarize, or mix delegated files unless the sub-agent reports back first; this prevents context cross-contamination and keeps delegated context out of the main session.',
      '- Do not split one context batch across multiple sub-agents, and do not send unrelated context batches to the same sub-agent. Each spawn_agent call gets an isolated worker; labels are for coordination, not a safe memory boundary.',
      '- For multi-file vault changes, partition the exact concrete paths from `<context_files>` into non-overlapping batches; never delegate a glob or folder prefix as though it proved complete coverage. Each worker must report concrete modified, unchanged, and failed paths. Reconcile those reports against the original path list, ensure every path appears exactly once, and assign any omissions before claiming completion.',
      '- Before changing structural Markdown markers such as YAML `---`, code fences, or table separators across multiple files, perform a read-only sample and distinguish structural syntax from the intended matches. If the same marker has both structural and target meanings, ask the user to clarify before mutating files.',
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
    ...(hasRead || hasReadExternal ? buildReadMaxCharsGuidance({ hasRead, hasReadExternal }) : []),
    ...buildMarkdownReadGuidance({ hasRead, hasMarkdownStructure, hasSubagent: summary.includeSubagent }),
    '- Do **not** use a leading `/` or the vault absolute path for vault files.',
    ...(hasRead ? [
      '- Use `file:` (wikilink name) only when you have a note title and no path in `<context_files>`.',
      '- If `obsidian_read` returns "Note not found", retry with the other parameter (`path` vs `file`) or verify the path matches `<context_files>` exactly.',
    ] : []),
    ...(hasExternalRead ? [
      '',
      buildExternalReadGuidance({ hasRead, hasReadExternal, hasListExternal }),
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

  const availableNames = new Set([
    ...summary.obsidianTools,
    ...(summary.includeMcp ? ['mcp'] : []),
    ...(summary.includeSkill ? [TOOL_SKILL] : []),
    ...(summary.includeSubagent ? [TOOL_SPAWN_AGENT] : []),
  ]);
  return lines.filter((line) => {
    const mentioned = line.match(/\b(?:obsidian_[a-z0-9_]+|pivi_[a-z0-9_]+|spawn_agent)\b/g) ?? [];
    return mentioned.every((name) => availableNames.has(name));
  }).join('\n');
}

function buildReadMaxCharsGuidance(params: {
  hasRead: boolean;
  hasReadExternal: boolean;
}): string[] {
  const readTools = [
    ...(params.hasRead ? ['`obsidian_read`'] : []),
    ...(params.hasReadExternal ? ['`obsidian_read_external`'] : []),
  ].join(' and ');
  return [
    `- Each of ${readTools} clamps \`maxChars\` to at least 1000 characters and applies a runtime default from remaining room before the output reserve, capped at 50000 characters. The 1000-character floor may cross the auto-compaction threshold so a read can still advance to the next compaction boundary instead of failing at \`maxChars=0\`. You may override this by passing \`maxChars\` explicitly, but values below 1000 are raised to the floor.`,
    '- Explicit line ranges automatically return the largest complete-line page that fits `maxChars`. When `truncated` is true, continue from the returned `nextStartLine` instead of retrying overlapping ranges or raising the budget.',
    '- Before overriding the default, estimate how much context budget remains for this turn and how much contiguous text the task truly needs. Prefer `mode: "stats"`, paged line ranges, or sub-agent delegation when headroom is tight; raise `maxChars` deliberately only when a single line or larger body truly requires it and the remaining budget can absorb it.',
  ];
}

function buildExternalReadGuidance(params: {
  hasRead: boolean;
  hasReadExternal: boolean;
  hasListExternal: boolean;
}): string {
  const clauses: string[] = [];
  if (params.hasReadExternal) {
    clauses.push('use `obsidian_read_external` with an absolute path under an allowed external directory (`path: "/Users/me/Workspace/file.ts"`). It supports `mode: "stats"` and line ranges');
  }
  if (params.hasListExternal) {
    clauses.push('use `obsidian_list_external` to list an allowed external folder');
  }
  const vaultReadWarning = params.hasRead
    ? ', and do not use `obsidian_read` for absolute paths'
    : '';
  return `**External files:** ${clauses.join('; ')}. Do not use vault-relative paths for external files${vaultReadWarning}.`;
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
    notes.push(`${shellTools.map((name) => `\`${name}\``).join(' / ')} runs single-line commands through the user login shell; see the Bash allowlist above for pre-approved commands. Bash is the lowest-priority tool and is never a vault file tool: do not use it to read, search, list, or modify vault files. Use Obsidian-specific tools instead, and use sub-agents for multi-file vault work.`);
  }
  return notes.join(' ');
}

function buildBashAllowlistGuidance(allowlist: readonly string[]): string[] {
  return [
    '**Bash allowlist (this turn):** These commands are pre-approved for `obsidian_bash`:',
    ...allowlist.map((entry) => `- ${formatBashAllowlistEntry(entry)}`),
    `Commands not on this list are not pre-approved. Do not run them on your own initiative.`,
    `When the user explicitly asks you to run a specific shell command that is not on this list, you may call \`obsidian_bash\` with that command; Pivi shows a sidebar prompt (Deny / once / session / always) before executing.`,
    `Commands run through the user login shell, so pipes, redirects, and other shell syntax are allowed.`,
    `After the user denies a command or Bash validation rejects it, do not call \`obsidian_bash\` again during the same turn with a different command.`,
    `Missing Bash capability never justifies using shell commands for vault files.`,
  ];
}

function formatBashAllowlistEntry(entry: string): string {
  if (!/[`\r\n]/.test(entry)) {
    return `\`${entry}\``;
  }
  return JSON.stringify(entry).replaceAll('`', '\\`');
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
      '- For Markdown files, call `obsidian_read` with `mode: "stats"` first when the file may be large. If it reports a large file, prefer `obsidian_markdown_structure` and then `obsidian_read` with `startLine` / `endLine` for only the needed section. If the whole file is truly needed, call `obsidian_read` again with an explicit `maxChars` at least to the reported `Characters` value; do this deliberately because the full file enters context.',
      '- **Prefer** `obsidian_read` with `path: "<exact path from context_files>"`; for large notes, prefer `mode: "stats"` or a line range before reading the full body, unless you intentionally override `maxChars` to read the entire file.',
    ];
  }
  return [
    '- For Markdown files, use `obsidian_read` with `path: "<exact path from context_files>"`. For large notes, prefer `mode: "stats"` or a line range before reading the full body; no structure tool is registered for this turn.',
  ];
}

function describeSchemaParameters(schema: Record<string, unknown>): string {
  const properties = schema.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return '';
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return Object.keys(properties)
    .map((name) => `\`${name}${required.has(name) ? '' : '?'}\``)
    .join(', ');
}
