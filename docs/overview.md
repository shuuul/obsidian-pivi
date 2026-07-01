# Pivi — project overview

## What this is

**Pivi** (`pivi`) is an Obsidian community plugin that embeds the **Pi agent** (`@earendil-works/pi-agent-core`) as its in-vault coding assistant: sidebar chat, inline edit, tool use, and vault-local MCP servers.

## Target users

- Obsidian users who want a **Pi-class agent** inside the vault, not a separate desktop app.
- Power users who configure **vault-local MCP** (`.pivi/mcp.json`) and model providers via plugin settings.

## Core scenarios

1. **Sidebar chat** — multi-tab sessions, streaming, file/image context, slash commands.
2. **Inline edit** — selection-aware rewrites using auxiliary Pi queries.
3. **MCP tools** — remote and stdio servers; `@server` mentions; OAuth via `/mcp-auth`.
4. **Session lifecycle** — resume/fork JSONL-backed Pi sessions.

## System boundary

| Inside Pivi | Outside |
|---------------|---------|
| Obsidian plugin UI, vault file I/O | Obsidian core (editor, vault API) |
| Pi-owned runtime/workspace/settings modules | Low-level Pi SDK internals outside Pivi product modules |
| `src/core/` pure domain helpers, prompts, and shared DTOs | Runtime selection / multi-SDK abstraction |
| Vault `.pivi/` config (MCP, OAuth tokens) | Global `~/.config/mcp`, host IDE MCP configs |
| In-process Pi `Agent` per chat runtime | Pi Coding Agent TUI / CLI |

## Current direction

- **Runtime:** Pi only; Pivi does not maintain a multi-SDK runtime abstraction.
- **Architecture:** explicit Pi-owned services; `main.ts` creates workspace/settings services and chat tabs construct Pi runtimes directly.
- **Sessions:** pi-compatible JSONL session trees are the durable source of truth.
- **Context:** explicit context selection, AGENTS/SYSTEM layers, vault skills, and custom slash templates.
- **Tools:** Obsidian-native tools prefer API access; CLI-only `command` / `eval` remain gated power tools.
- **MCP:** vault-local configuration only.
- **Auth:** provider API keys / explicitly supported OAuth in settings.

## Primary dependencies

| Dependency | Role |
|------------|------|
| Obsidian API | Plugin host, vault, workspace |
| `@earendil-works/pi-agent-core` | Agent loop, tools, streaming |
| `@earendil-works/pi-ai` | Model providers |
| `@modelcontextprotocol/sdk` | MCP client transports, OAuth |
| esbuild | Bundle `main.js` for Obsidian |

## Architecture (high level)

Pi-only product layout:

- **`main.ts` / `PiviPlugin`** — composition root; creates plugin settings/storage, Pi workspace services, views, and commands.
- **`src/pi/`** — Pi product modules: `PiChatRuntime`, MCP bridge/OAuth, provider auth, settings UI, tools, sessions, skills.
- **`src/features/`** — Obsidian UI and controllers; may use Pi-owned product services directly when that is simpler.
- **`src/core/`** — reusable pure helpers, prompt builders, DTOs, MCP/security/session domain logic that remains useful outside a single UI component.

See [architecture/system-architecture.md](./architecture/system-architecture.md) and the operational Mermaid diagrams in [`../src/AGENTS.md`](../src/AGENTS.md).

## Core modules

| Module | Doc |
|--------|-----|
| Agent runtime | [architecture/agent-runtime.md](./architecture/agent-runtime.md) |
| Context & turns | [architecture/context-management.md](./architecture/context-management.md) |
| Tools & MCP | [architecture/tool-system.md](./architecture/tool-system.md) |
| Pi integration boundaries | [architecture/framework-adapters.md](./architecture/framework-adapters.md) |
| UI integration | [architecture/ui-integration.md](./architecture/ui-integration.md) |
| Prompts | [architecture/prompt-system.md](./architecture/prompt-system.md) |

## Non-goals

- Replacing Obsidian’s editor or sync.
- Running as a standalone CLI agent (use Pi Coding Agent for that).
- Reading **global** MCP configs (`~/.config/mcp`, Cursor/VS Code MCP) — vault-local only.
- Maintaining multiple agent runtimes or SDK compatibility layers in one build.
- Generic provider OAuth flows beyond explicitly supported integrations.
- Automatic destructive context compaction; prefer non-destructive forks and explicit context selection.

## Related

- Developer commands: [../AGENTS.md](../AGENTS.md)
- Glossary: [glossary.md](./glossary.md)
- Releases: [GitHub Releases](https://github.com/shuuul/obsidian-pivi/releases)
