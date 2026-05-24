# Obsidian-native agent tools

## Problem

Obsius runs `pi-agent-core` with MCP as the only registered tools. The system prompt still describes Claudian-era tools (`Read`, `Bash`, …) that are not wired. Users expect vault operations (read/write/search/links/tasks) aligned with Obsidian semantics, not generic filesystem/bash tools from `pi-coding-agent`.

## Goals

- Register a **minimal, vault-safe** tool surface on the Pi `Agent` alongside the existing `mcp` proxy tool.
- Use a **hybrid** implementation: in-process Obsidian `App` API where low-latency and path-safe; official **Obsidian CLI** (`obsidian … format=json`) for discovery, search, tasks, properties, links, and optional power commands.
- Integrate **ApprovalManager** for mutating operations and for optional `eval` / `command` tools.
- Align tool names and renderer mapping so UI and `mainAgent` guidance match reality.

## Non-goals

- Re-embedding `pi-coding-agent` or its default `read`/`write`/`bash` tools.
- Replacing MCP; vault MCP remains via `mcp` proxy (ADR-0006).
- Headless Obsidian / Headless Sync (separate product surface).
- Full 1:1 coverage of all ~115 CLI commands in v1.

## Prerequisites

- Obsidian **1.12+** with CLI enabled (Settings → General → Command line interface).
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

### Agent tools (v1)

| Tool | Backend | Mutates | Default |
|------|---------|---------|---------|
| `obsidian_read` | Vault API (`app.vault.read`) | No | On |
| `obsidian_write` | Vault API create/modify | Yes | On |
| `obsidian_search` | Vault API scan (`searchNotes`); CLI fallback on API error | No | On |
| `obsidian_note_info` | Vault API (`metadataCache` + stat); CLI fallback on API error | No | On |
| `obsidian_links` | Vault API (`metadataCache`); CLI fallback on API error | No | On |
| `obsidian_properties` | CLI `properties` / `property:*` only | Yes (set/remove) | On |
| `obsidian_tasks` | CLI `tasks` / `task` only | Yes (toggle/status) | On |
| `obsidian_command` | CLI `command id=` | Yes | **Off**; allowlist in settings |
| `obsidian_eval` | CLI `eval code=` | Yes | **Off**; explicit opt-in + approval |

Naming is Obsius-specific (not pi-coding-agent `read`/`write`) to avoid implying POSIX/bash semantics.

### Hybrid rules

| Operation | Primary | Fallback / notes |
|-----------|---------|------------------|
| Read note by path or wikilink name | `app.vault` adapter | — |
| Create / overwrite / append / prepend | `app.vault` adapter | — |
| Search (substring / folder list) | `ObsidianVaultApi.searchNotes` | CLI `search` on API error if `cliEnabled` |
| Note info, links, backlinks | `metadataCache` + vault | CLI on API error if `cliEnabled` |
| Properties, tasks | CLI JSON | Requires `cliEnabled` |
| Plugin reload / dev errors | CLI dev commands | Settings “developer mode” only |

All paths must be validated under vault root (reuse `ApprovalManager` path rules).

## Data model

- Tool JSON schemas: Zod or TypeBox in `src/pi/tools/schemas/` (adaptor-only).
- Settings keys under `agentSettings.tools` (names TBD in settings migration):

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
3. If mutating → `ApprovalManager.requestApproval(toolName, args)`.
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

## Open questions

- Single aggregated `obsidian` tool vs multiple tools (recommend multiple for clearer schemas; aggregate only if context pressure demands).
- Whether `obsidian_write` should expose template insertion via CLI in v1 or v2.

## Related

- ADR: [0009](../adr/0009-obsidian-native-tools.md)
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
