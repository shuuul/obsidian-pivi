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

```
┌─────────────────────────────────────────────────────────┐
│  Obsidian (Plugin host)                                  │
│  main.ts — bootstrap, views, commands                    │
└───────────────────────────┬─────────────────────────────┘
                            │
┌───────────────────────────▼─────────────────────────────┐
│  src/features/  — UI, controllers, rendering               │
│  (ObsiusView, InputController, settings, inline-edit)      │
└───────────────────────────┬─────────────────────────────┘
                            │ ports only
┌───────────────────────────▼─────────────────────────────┐
│  src/core/  — types, prompts, ChatRuntime, MCP manager     │
│  (no pi-ai / pi-agent-core imports)                        │
└───────────────────────────┬─────────────────────────────┘
                            │ implemented by
┌───────────────────────────▼─────────────────────────────┐
│  src/pi/  — PiChatRuntime, MCP bridge, OAuth, aux queries │
└───────────────────────────────────────────────────────────┘
```

## Key registries

| Registry | Role |
|----------|------|
| `AgentServices` | Active agent adaptor (`piAgentAdaptor`). |
| `AgentWorkspace` | Workspace services: MCP storage, OAuth, settings renderer. |
| `ChatRuntime` | Port implemented by `PiChatRuntime`. |

## Vault artifacts

| Path | Owner |
|------|--------|
| `.obsius/mcp.json` | MCP server registry + `_obsius2` metadata |
| `.obsius/mcp-oauth/` | OAuth tokens per server (hashed dirs) |

## Dependencies

- Obsidian plugin API
- Pi agent stack (adaptor only)
- MCP SDK (adaptor only)

## Design

Bootstrap (`main.ts`) installs Pi registration and initializes workspace services before views open. Each chat tab obtains a `ChatRuntime` from the adaptor factory; features never construct Pi `Agent` directly.

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

## Related ADRs

- [ADR-0002](../adr/0002-hexagonal-ports-and-adapters.md)
- [ADR-0003](../adr/0003-pi-as-sole-agent-runtime.md)
- [ADR-0004](../adr/0004-vault-local-mcp-config.md)
