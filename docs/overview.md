# Obsius — project overview

## What this is

**Obsius** (`obsius2`) is an Obsidian community plugin that embeds the **Pi agent** (`@earendil-works/pi-agent-core`) as its in-vault coding assistant: sidebar chat, inline edit, tool use, and vault-local MCP servers.

## Target users

- Obsidian users who want a **Pi-class agent** inside the vault, not a separate desktop app.
- Power users who configure **vault-local MCP** (`.obsius/mcp.json`) and model providers via plugin settings.

## Core scenarios

1. **Sidebar chat** — multi-tab sessions, streaming, file/image context, slash commands.
2. **Inline edit** — selection-aware rewrites using auxiliary Pi queries.
3. **MCP tools** — remote and stdio servers; `@server` mentions; OAuth via `/mcp-auth`.
4. **Session lifecycle** — resume/fork where the runtime supports native history.

## System boundary

| Inside Obsius | Outside |
|---------------|---------|
| Obsidian plugin UI, vault file I/O | Obsidian core (editor, vault API) |
| `src/core/` domain ports and prompts | Pi / pi-ai implementation details in `src/pi/` |
| Vault `.obsius/` config (MCP, OAuth tokens) | Global `~/.config/mcp`, host IDE MCP configs |
| In-process Pi `Agent` per chat runtime | Pi Coding Agent TUI / CLI |

## Primary dependencies

| Dependency | Role |
|------------|------|
| Obsidian API | Plugin host, vault, workspace |
| `@earendil-works/pi-agent-core` | Agent loop, tools, streaming |
| `@earendil-works/pi-ai` | Model providers |
| `@modelcontextprotocol/sdk` | MCP client transports, OAuth |
| esbuild | Bundle `main.js` for Obsidian |

## Architecture (high level)

Hexagonal layout:

- **`src/core/`** — ports, types, prompts, runtime interfaces (no external libs).
- **`src/features/`** — Obsidian UI and controllers; talk only to `core` ports.
- **`src/pi/`** — Pi adaptor: `PiChatRuntime`, MCP bridge, OAuth, settings wiring.
- **`main.ts`** — bootstrap: register adaptor, workspace services, views.

See [architecture/system-architecture.md](./architecture/system-architecture.md) and [diagrams/system-architecture.mmd](./diagrams/system-architecture.mmd).

## Core modules

| Module | Doc |
|--------|-----|
| Agent runtime | [architecture/agent-runtime.md](./architecture/agent-runtime.md) |
| Context & turns | [architecture/context-management.md](./architecture/context-management.md) |
| Tools & MCP | [architecture/tool-system.md](./architecture/tool-system.md) |
| Framework adapters | [architecture/framework-adapters.md](./architecture/framework-adapters.md) |
| UI integration | [architecture/ui-integration.md](./architecture/ui-integration.md) |
| Prompts | [architecture/prompt-system.md](./architecture/prompt-system.md) |

## Non-goals

- Replacing Obsidian’s editor or sync.
- Running as a standalone CLI agent (use Pi Coding Agent for that).
- Reading **global** MCP configs (`~/.config/mcp`, Cursor/VS Code MCP) — vault-local only.
- Supporting multiple agent runtimes in one build (Pi only today).

## Related

- Developer commands: [../AGENTS.md](../AGENTS.md)
- Glossary: [glossary.md](./glossary.md)
- Releases: [GitHub Releases](https://github.com/shuuul/obsius2/releases)
