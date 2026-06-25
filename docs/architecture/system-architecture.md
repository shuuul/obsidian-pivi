# System architecture

## Purpose

Describe how Obsius splits Obsidian UI, domain core, and Pi adaptor so multiple concerns (chat, MCP, settings) stay testable and swappable.

## Responsibilities

- Define layer boundaries and allowed dependency direction.
- Point to module-level docs for depth.

## Non-responsibilities

- Per-feature specs (see `docs/specs/`).
- Pi Coding Agent product documentation.

## Layers

```mermaid
flowchart TD
  Host["Obsidian plugin host<br/>src/main.ts"] -- "registers" --> Features["UI/controllers/rendering<br/>src/features/"]
  Host -- "bootstraps" --> Pi["Pi adaptor<br/>src/pi/"]
  Host -- "loads" --> App["Settings/storage<br/>src/app/"]
  Features -- "ports only" --> Core["Core contracts/domain<br/>src/core/"]
  Pi -- "implements ports" --> Core
  Pi -- "uses" --> Vault["Vault .obsius/*<br/>settings, MCP, sessions, skills"]
  Features -- "uses" --> Shared["Shared UI<br/>src/shared/"]
  Features -- "uses" --> Utils["Utilities<br/>src/utils/"]
```

### Source directories

| Directory | Description |
|-----------|-------------|
| src/shared/ | Reusable UI components: dropdowns, modals, mention system, badges |
| src/utils/ | Cross-cutting helpers: context resolution, inline editing, markdown, MCP, platform compatibility, etc. |
| src/i18n/ | Internationalization: bundled locale JSON and typed translation keys managed via ObsiusSettings |
| src/style/ | CSS modules organized by base, component, feature, settings, toolbar, and modal concerns |

## Key registries

| Registry | Role |
|----------|------|
| `AgentServices` | Active agent facade (bootstrapped via `bootstrapPiAgent()`). |
| `AgentWorkspace` | Workspace services: MCP storage, OAuth, settings renderer. |
| `ChatRuntime` | Port implemented by `PiChatRuntime`. |

## Vault artifacts

| Path | Owner |
|------|--------|
| `.obsius/mcp.json` | MCP server registry + `_obsius2` metadata |
| `.obsius/mcp-oauth/` | OAuth tokens per server (hashed dirs) |
| `.obsius/settings.json` | Application settings file |
| `.obsius/sessions/` | JSONL session trees, fork/rewind metadata, and message history |

## Not implemented as dedicated subsystems

Some product seams are intentionally documented as part of the system boundary instead of separate architecture modules:

| Seam | Current state |
|------|---------------|
| Long-horizon memory / RAG | Not implemented. Current durable recall is session JSONL plus explicit turn context. If vector memory is added later, specify ownership, vault artifacts, and privacy rules before implementation. |
| Workflow orchestration | Limited to Pi’s internal tool loop, chat queued turns, and `SubagentManager`-managed subagent runs. Obsius does not run an explicit graph/workflow engine. |

## Dependencies

- Obsidian plugin API
- Pi agent stack (adaptor only)
- MCP SDK (adaptor only)

## Design

Bootstrap (`main.ts`) calls `bootstrapPiAgent()` and initializes workspace services before views open. Each chat tab obtains a `ChatRuntime` from `AgentServices.createChatRuntime()` (`tabRuntime.ts`); features never construct Pi `Agent` directly.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Features call Pi SDK directly | Locks UI to Pi; blocks testing and future runtimes |
| Monolith plugin file | Unmaintainable at current size |

## Failure modes

| Failure | Mitigation |
|---------|------------|
| Adaptor not installed | Settings show “Pi provider not initialized” |
| Workspace services missing | MCP UI hidden; chat may lack MCP tools |

## Open questions

- Whether to expose a formal `RuntimePort` interface document for third-party adaptors.

## Related

- [agent-runtime.md](./agent-runtime.md)
- [context-management.md](./context-management.md)
- [tool-system.md](./tool-system.md)
