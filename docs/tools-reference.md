# Pivi tools reference

Pivi registers the following tools with the Pi agent. Tools can be enabled or disabled from **Settings → Pivi → Tools**. Disabled tools are omitted from the agent's available tool list and system prompt on subsequent turns.

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
| `obsidian_read_external` | Read files outside the vault under explicitly allowed external directories | No |

> `obsidian_read_external` is **off by default** until external access is enabled. Requires `allowExternalRead` plus at least one allowed external directory from Obsidian tools settings.

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

These tools are disabled by default and must be intentionally enabled in settings.

## Image generation

| Tool | Purpose | Mutates | Default |
|------|---------|---------|---------|
| `obsidian_generate_image` | Generate an image with Codex, save it as an Obsidian attachment, and optionally insert the embed into a note | Yes | On only when `openai-codex` credentials exist |

Registered only after the `openai-codex` provider has credentials. If Codex is not connected, the tool is omitted and its Tools tab toggle is disabled.

## Web tools

| Tool | Purpose | Mutates |
|------|---------|---------|
| `WebSearch` | Search the web using Brave, Tavily, or Exa API keys, with Exa public fallback | No |
| `WebFetch` | Fetch readable content from a web URL using Tavily Extract, Exa Contents, or direct HTTP fetch | No |

## Extensions

| Tool | Purpose | Mutates |
|------|---------|---------|
| `mcp` | Invoke vault-local MCP servers from `.pivi/mcp.json` | Varies |
| `skill` | Load vault-local skill instructions from `.pivi/skills/` | No |
| `spawn_agent` | Spawn a focused subagent for a delegated task | Varies |

## Reading large notes

For large Markdown notes, the agent first calls `obsidian_read` with `mode=stats` to inspect line and character counts. If the file is large, `obsidian_markdown_structure` returns heading structure and section sizes so the agent can read only the needed section with `obsidian_read` `startLine` / `endLine`, instead of loading the whole note into context.

## Recoverability

Mutating tools are designed with safety in mind. Pivi does not add coding-agent plan mode or per-edit permission prompts. `obsidian_delete` intentionally moves items to trash instead of permanently deleting them, following the user's Obsidian trash settings. File changes are recoverable using the `obsidian_history` tool and Obsidian's file-history snapshots.
