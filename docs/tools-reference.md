# Pivi tools reference

Pivi registers the following tools with the Pi agent when their prerequisites are available. Obsidian tool rows can be enabled or disabled from **Settings → Pivi → Tools**; Web Search, MCP, Skills, and Subagents use their own settings sections. Disabled or unavailable tools are omitted from subsequent turns.

## Read & explore

| Tool | Purpose | Mutates |
|------|---------|---------|
| `obsidian_read` | Read note bodies safely by `path` / `file`; supports `mode=stats`, `startLine`, `endLine`, and `maxChars` | No |
| `obsidian_markdown_structure` | Extract Markdown headings with line numbers and character counts before range-reading large notes | No |
| `obsidian_search` | Substring search, simplified `tag:` search, or folder listing via `query=*` / `path:` | No |
| `obsidian_note_info` | Read metadata: size, dates, tags, outgoing links, and frontmatter | No |
| `obsidian_links` | Read outgoing links or backlinks for one note | No |
| `obsidian_list` | List direct children of a vault folder, including notes, folders, and attachments | No |
| `obsidian_attachment` | Get attachment metadata / resource URLs or resolve an available attachment path | No |

## Write & edit

| Tool | Purpose | Mutates |
|------|---------|---------|
| `obsidian_edit` | Replace exact `old_string` text in an existing note (preferred partial edit tool) | Yes |
| `obsidian_write` | Create notes, append / prepend content, or deliberately overwrite a full note | Yes |
| `obsidian_properties` | List, read, set, or remove YAML frontmatter properties | Yes |
| `obsidian_delete` | Move a vault file or folder to trash via Obsidian `FileManager.trashFile()` | Yes |
| `obsidian_move` | Rename or move a vault file / folder and update links according to Obsidian settings | Yes |
| `obsidian_mkdir` | Create a vault folder | Yes |

## History & tasks

| Tool | Purpose | Mutates |
|------|---------|---------|
| `obsidian_history` | List, read, and restore Obsidian file-history snapshots | Yes |
| `obsidian_tasks` | List or toggle Markdown task status | Yes |

`obsidian_history` and `obsidian_tasks` register only when Pivi's CLI integration is enabled and the official Obsidian CLI is available.

## Daily notes, graph, tags & Bases

| Tool | Purpose | Mutates | Prerequisite |
|------|---------|---------|--------------|
| `obsidian_daily` | Read, append to, or open the daily note | Varies | Official Obsidian CLI |
| `obsidian_graph` | Analyze orphaned notes, dead ends, and unresolved links | No | None |
| `obsidian_tags` | List tags or inspect notes for one tag | No | None |
| `obsidian_base` | List Bases and views, or query a Base | No | CLI only for `query` |

## Open & navigate

| Tool | Purpose | Mutates |
|------|---------|---------|
| `obsidian_open` | Open a vault file in the Obsidian workspace | No |

## External access (gated)

| Tool | Purpose | Mutates | Default |
|------|---------|---------|---------|
| `obsidian_read_external` | Read files outside the vault under explicitly allowed external directories | No | **Off** |
| `obsidian_list_external` | List external folders under explicitly allowed external directories | No | **Off** |
| `obsidian_bash` | Run one allowlisted one-line shell command; rejects shell control syntax | Yes | **Off** |
| `obsidian_command` | Execute an Obsidian palette command by id | Yes | **Off** |
| `obsidian_eval` | Run arbitrary JavaScript in the Obsidian context | Yes | **Off** |

External access is disabled by default and requires `allowExternalRead` plus at least one allowed root. Roots come from the vault-scoped device-local overlay or folders attached for the current turn; absolute paths are not written to synced `.pivi/settings.json` or session JSONL. `obsidian_command` and `obsidian_eval` additionally require the official Obsidian CLI. `obsidian_bash` does not require the CLI, but accepts only allowlisted one-line commands and rejects shell control syntax.

## Image generation

| Tool | Purpose | Mutates | Default |
|------|---------|---------|---------|
| `obsidian_generate_image` | Generate an image with Codex, save it as an Obsidian attachment, and optionally insert the embed into a note | Yes | On only when `openai-codex` credentials exist |

Registered only after the `openai-codex` provider has credentials. If Codex is not connected, the tool is omitted and its Tools tab toggle is disabled.

When the tool is available and enabled, the slash selector also offers `/generate-image`. Selecting it preserves that token in the composer and session history; turn preparation expands only the API prompt into an explicit `obsidian_generate_image` request. It is a tool mention, not an editable prompt command.

## Web tools

| Tool | Purpose | Mutates |
|------|---------|---------|
| `WebSearch` | Search the web using Brave, Tavily, or Exa API keys, with Exa public fallback | No |
| `WebFetch` | Fetch readable content from a web URL using Tavily Extract, Exa Contents, or direct HTTP fetch | No |

Web tools are configured under **Settings → Pivi → Web Search**. Their runtime availability depends on the selected providers and credentials.

## Extensions

| Tool | Purpose | Mutates |
|------|---------|---------|
| `mcp` | Invoke vault-local MCP servers from `.pivi/mcp.json` | Varies |
| `skill` | Load vault-local skill instructions from `.pivi/skills/` | No |
| `spawn_agent` | Spawn a focused subagent for a delegated task | Varies |

## Reading large notes

For large Markdown notes, the agent first calls `obsidian_read` with `mode=stats` to inspect line and character counts. If the file is large, `obsidian_markdown_structure` returns heading structure and section sizes so the agent can read only the needed section with `obsidian_read` `startLine` / `endLine`, instead of loading the whole note into context.

## Recoverability

Mutating tools are designed with safety in mind. Pivi does not add coding-agent plan mode or per-edit permission prompts. `obsidian_delete` follows the user's Obsidian trash settings. When the official CLI is available and Obsidian has a matching file-history snapshot, `obsidian_history` can list, read, or restore that snapshot; recovery is not guaranteed for changes without a retained snapshot.
