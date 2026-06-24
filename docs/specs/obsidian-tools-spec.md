# Obsidian-native agent tools

## Problem

Obsius runs `pi-agent-core` with MCP as the only registered tools. The system prompt still describes Claudian-era tools (`Read`, `Bash`, …) that are not wired. Users expect vault operations (read/write/search/links/tasks) aligned with Obsidian semantics, not generic filesystem/bash tools from `pi-coding-agent`.

## Goals

- Register a **minimal, vault-safe** tool surface on the Pi `Agent` alongside the existing `mcp` proxy tool.
- Use the in-process Obsidian `App` API wherever public APIs exist; reserve the official **Obsidian CLI** (`obsidian … format=json`) for task operations and optional power commands.
- Integrate **ApprovalManager** for mutating operations and for optional `eval` / `command` tools.
- Align tool names and renderer mapping so UI and `mainAgent` guidance match reality.

## Non-goals

- Re-embedding `pi-coding-agent` or its default `read`/`write`/`bash` tools.
- Replacing MCP; vault MCP remains via `mcp` proxy.
- Headless Obsidian / Headless Sync (separate product surface).
- Full 1:1 coverage of all Obsidian CLI commands.

## Prerequisites

- Plugin minimum remains Obsidian **1.11.4** (`manifest.json`). CLI-backed tools require an Obsidian version/build where the command line interface is available and enabled (Settings → General → Command line interface).
- For CLI-backed tools: Obsidian app **running** (IPC); document failure when CLI is unavailable.
- `obsidian` on PATH (installer registers it).

## User experience

- Agent can read and write notes using vault-relative / wikilink resolution rules already described in `mainAgent`.
- Destructive or broad actions (delete, move, `eval`, palette `command`) require approval or are disabled by default.
- Settings → Tools (or Pi agent section): toggles for CLI transport, optional tools (`command`, `eval`), and CLI timeout.
- Tool errors are actionable (“Obsidian not running”, “enable CLI in Settings”, “path outside vault”).

## API / interfaces

### Port (core)

| Port | Responsibility |
|------|----------------|
| `ObsidianToolHost` | Execute read/write/search/…; returns structured JSON + text for model |
| `ObsidianCliTransport` | Spawn `obsidian` with `vault=`, `format=json`, timeout, parse stdout/stderr |

Implementations live under `src/pi/tools/` (adaptor). `PiChatRuntime.ensureReady()` merges:

```text
tools = [...obsidianTools, ...mcpBridge.getAgentTools()]
```

### Agent tools

| Tool | Backend | Mutates | Default |
|------|---------|---------|---------|
| `obsidian_read` | Vault API (`app.vault.read`) | No | On |
| `obsidian_edit` | Vault API (`app.vault.process` substring replace) | Yes | On |
| `obsidian_write` | Vault API create/modify/append/prepend | Yes | On |
| `obsidian_search` | Vault API scan (`searchNotes`) | No | On |
| `obsidian_note_info` | Vault API (`metadataCache` + stat) | No | On |
| `obsidian_links` | Vault API (`metadataCache`) | No | On |
| `obsidian_properties` | Vault API (`metadataCache` + `fileManager.processFrontMatter`) | Yes (set/remove) | On |
| `obsidian_tasks` | CLI `tasks` / `task` only | Yes (toggle/status) | On |
| `obsidian_delete` | FileManager (`trashFile`) | Yes | On |
| `obsidian_move` | FileManager (`renameFile`) | Yes | On |
| `obsidian_list` | Vault API (`TFolder.children`) | No | On |
| `obsidian_mkdir` | Vault API (`createFolder`) | Yes | On |
| `obsidian_open` | Workspace API (`openFile`) | No | On |
| `obsidian_attachment` | Vault/FileManager (`getResourcePath`, `getAvailablePathForAttachment`) | No | On |
| `obsidian_command` | CLI `command id=` | Yes | **Off**; allowlist in settings |
| `obsidian_eval` | CLI `eval code=` | Yes | **Off**; explicit opt-in + approval |

Naming is Obsius-specific (not pi-coding-agent `read`/`write`) to avoid implying POSIX/bash semantics.

### Hybrid rules

| Operation | Primary | Fallback / notes |
|-----------|---------|------------------|
| Read note by path or wikilink name | `app.vault` adapter | — |
| Create / overwrite / append / prepend | `app.vault` adapter (`process` for mutations) | — |
| Substring replace (`old_string` / `new_string`) | `app.vault.process` via `obsidian_edit` | Unique match unless `replace_all` |
| Search (substring / folder list) | `ObsidianVaultApi.searchNotes` | — |
| Note info, links, backlinks | `metadataCache` + vault | — |
| Properties | MetadataCache + `fileManager.processFrontMatter` | Native frontmatter operations |
| Tasks | CLI JSON | Requires `cliEnabled` |
| Delete | `fileManager.trashFile` | Trash only; no permanent delete tool |
| Move/rename | `fileManager.renameFile` | Lets Obsidian update links per user settings |
| List folders | `TFolder.children` | Includes folders and attachments |
| Create folder | `vault.createFolder` | Approval-gated |
| Open file | `workspace.getLeaf().openFile` | UI side effect only |
| Attachment info/path | `vault.getResourcePath`, `fileManager.getAvailablePathForAttachment` | No binary payload transfer |
| Plugin reload / dev errors | CLI dev commands | Settings “developer mode” only |

All paths must be validated under vault root (reuse `ApprovalManager` path rules).

## Data model

- Tool JSON schemas: Zod or TypeBox inline in each tool file (e.g. src/pi/tools/obsidian/readNote.ts) (adaptor-only).
- Settings keys under `agentSettings.tools`:

```typescript
interface ObsidianToolsSettings {
  cliEnabled: boolean;
  cliTimeoutMs: number;
  allowCommand: boolean;
  commandAllowlist: string[]; // command IDs
  allowEval: boolean;
}
```

## Algorithm / flow

### Tool execution

1. Resolve `vault` from active Obsius workspace (vault path / name for CLI `vault=`).
2. Validate paths and tool enable flags.
3. If mutating → check `SessionApprovalRules` on the active `PiChatRuntime` (in-memory, keyed by `toolName` + canonical path/action pattern via `ApprovalManager.matchesRulePattern`). If no rule matches, prompt the user (`Allow once` / `Always allow` / `Deny`). **`Always allow`** adds a session rule only; rules are cleared on new chat, rewind, runtime cleanup, or when the bound `sessionFile` changes — not written to plugin settings or session JSON.
4. Execute API or CLI branch; normalize errors to model-readable text + optional `details` JSON.
5. Return `AgentToolResult` (text + optional attachments).

### CLI spawn

```text
obsidian vault="<name>" <subcommand> ... format=json
```

- Timeout default 30s (configurable).
- Non-zero exit → structured error; do not retry alternate URL forms (global workflow rule).

## Evaluation

- Unit: mock CLI stdout; mock `App` vault adapter; approval gating.
- Integration (manual): `npm run build` → `obsidian reload` → agent turn “search for X and append to Y” with approval UI.
- Regression: `obsidian dev:errors` shows no errors after plugin load.


## Related

- Architecture: [tool-system.md](../architecture/tool-system.md)
- Spec: [context-layers-spec.md](./context-layers-spec.md) (`skill` tool, sessions)
- Spec: [mcp-integration-spec.md](./mcp-integration-spec.md)

## Agent tool surface (full Pi chat)

Beyond Obsidian tools, the runtime also registers:

| Tool | Spec |
|------|------|
| `mcp` | [mcp-integration-spec.md](./mcp-integration-spec.md) |
| `skill` | [context-layers-spec.md](./context-layers-spec.md) |
| Subagent tools | [context-layers-spec.md](./context-layers-spec.md) (Phase 4) |
