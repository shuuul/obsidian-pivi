# Tool system

## Purpose

Expose vault MCP servers and built-in behaviors to the Pi agent safely inside Obsidian.

## Responsibilities

- Vault MCP registry: `.pivi/mcp.json` via `McpStorage` / `McpServerManager`; static bearer tokens and OAuth client secrets are stored in Obsidian SecretStorage.
- Connection pool: stdio, HTTP, SSE; OAuth via `McpOAuthService`.
- **Proxy tool** `mcp`: status, list servers, describe, call.
- **Obsidian-native tools** (implemented) — Vault/FileManager/MetadataCache/Workspace API first, with CLI only for task/optional power surfaces; see [obsidian-tools-spec.md](../specs/obsidian-tools-spec.md).
- Built-in slash commands include chat/session/context/MCP actions such as `clear`, `add-dir`, `resume`, `fork`, `mcp-auth`, plus `/skill:<name>` entries from the vault skill catalog.

## Non-responsibilities

- Hosting MCP servers (user-provided).
- Global MCP discovery from other apps.

## Interfaces

| Port / type | Role |
|-------------|------|
| `AppMcpStorage` | Load/save server list |
| `AppMcpOAuth` | authenticate / logout / status |
| `createPiMcpProxyTool` | Agent-facing tool surface |
| `supportsMcpOAuth` | Whether server supports OAuth flow |
| Subagent (Agent/Task) | `src/pi/tools/createSubagentTool.ts` | Spawns parallel subagents for complex tasks |
| Skill tool | `src/pi/tools/createSkillTool.ts` | Loads vault skills as callable tools |
| TodoWrite | `src/core/tools/todo.ts` | Writes task checklists for the model |

## Built-in Obsidian tools

| Tool | Primary API | Mutates | Notes |
|------|-------------|---------|-------|
| `obsidian_read` | `app.vault.read` | No | Read by vault-relative `path` or wikilink-style `file`. |
| `obsidian_edit` | `app.vault.process` | Yes | Exact substring replacement; requires unique `old_string` unless `replace_all`. |
| `obsidian_write` | `app.vault.create` / `process` | Yes | Create, append, prepend, or deliberate overwrite. |
| `obsidian_search` | `app.vault.getMarkdownFiles` + `cachedRead` | No | Plain substring, simplified `tag:` / `path:` / markdown listing. |
| `obsidian_note_info` | `metadataCache.getFileCache` | No | Stat, tags, outgoing links, frontmatter. |
| `obsidian_links` | `metadataCache.resolvedLinks` | No | Outgoing links and backlinks. |
| `obsidian_properties` | `metadataCache` / `fileManager.processFrontMatter` | Yes for set/remove | Native frontmatter operations; no CLI dependency. |
| `obsidian_tasks` | Obsidian CLI | Yes for toggle/status | CLI-only because public API has no task index/mutation helper. |
| `obsidian_delete` | `fileManager.trashFile` | Yes | Moves file/folder to trash; no permanent delete tool. |
| `obsidian_move` | `fileManager.renameFile` | Yes | Rename/move file/folder and update links according to user settings. |
| `obsidian_list` | `vault.getRoot` / `TFolder.children` | No | Direct folder children, including folders and attachments. |
| `obsidian_mkdir` | `vault.createFolder` | Yes | Create folder. |
| `obsidian_open` | `workspace.getLeaf().openFile` | No | UI-affecting: opens a vault file. |
| `obsidian_attachment` | `vault.getResourcePath` / `fileManager.getAvailablePathForAttachment` | No | Attachment metadata/resource URL or available attachment destination. |
| `obsidian_command` | Obsidian CLI | Yes | Optional, disabled by default. |
| `obsidian_eval` | Obsidian CLI | Yes | Optional, disabled by default. |

Mutating tools are routed through `ApprovalManager` with path-aware patterns. The default destructive operation is trash, not permanent delete.

## Dependencies

- `@modelcontextprotocol/sdk` (pi adaptor)
- Vault adapter for config + oauth dirs

## Design

Inspired by [pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter) proxy pattern, not a full package embed. Context-saving servers require `@mention` (or toolbar enable) before tools activate. OAuth uses localhost callback `19876`, vault-stored tokens, and keychain-backed static client secrets.

```mermaid
flowchart LR
  UI["Chat input / toolbar"] -- "@server or enabled server" --> Manager["McpServerManager<br/>src/core/mcp"]
  Manager -- "active server list" --> Runtime["PiChatRuntime"]
  Runtime -- "single AgentTool" --> Proxy["mcp proxy tool<br/>src/pi/mcp"]
  Proxy -- "calls" --> Pool["MCP connection pool"]
  Pool -- "stdio/http/sse" --> Server["User MCP server"]
```

## Alternatives considered

| Option | Why not |
|--------|---------|
| Register every MCP tool as Pi tool | Tool explosion, schema churn |
| `~/.config/mcp` | Wrong trust boundary for Obsidian vault plugin |
| Full pi-mcp-adapter bundle | Heavy; Obsidian-specific paths and UI |

## Failure modes

| Failure | Mitigation |
|---------|------------|
| OAuth required | `/mcp-auth <server>` |
| stdio command missing | Settings test modal |
| Token expired | Settings auth badge + re-auth |

## Open questions

- Direct MCP tool registration mode.

## Related

- [agent-runtime.md](./agent-runtime.md)
- [../specs/mcp-integration-spec.md](../specs/mcp-integration-spec.md)
- [../specs/obsidian-tools-spec.md](../specs/obsidian-tools-spec.md)

## Related specs

- [mcp-integration-spec.md](../specs/mcp-integration-spec.md)
- [obsidian-tools-spec.md](../specs/obsidian-tools-spec.md)
- [context-layers-spec.md](../specs/context-layers-spec.md)
