# Framework adapters

## Purpose

Keep **Obsius core abstractions** independent of Pi, MCP SDK, and Obsidian so framework swaps touch only adaptor code.

## Principle

> Frameworks are implementation backends, not the source of domain concepts.

## Internal concepts (core)

| Concept | Location | Notes |
|---------|----------|-------|
| `ChatRuntime` | `src/core/runtime/ChatRuntime.ts` | Turn lifecycle, stream, MCP reload |
| `ChatTurnRequest` / `PreparedChatTurn` | `src/core/runtime/types.ts` | Prompt + mentions |
| `ManagedMcpServer` | `src/core/types/mcp.ts` | Vault MCP config model |
| `AppMcpOAuth` | `src/core/agent/types.ts` | OAuth port |
| Prompt builders | `src/core/prompt/`, `buildTurnPrompt.ts` | Provider-agnostic text |
| Auxiliary services | `src/core/auxiliary/` | Refine, inline-edit, title |

## Adapter responsibilities

| Adapter | Path | Maps |
|---------|------|------|
| **Pi agent** | `src/pi/runtime/PiChatRuntime.ts` | `ChatRuntime` → Pi `Agent`, tools, streaming |
| **Pi system prompt** | `src/pi/runtime/buildPiSystemPrompt.ts` | Settings → `Agent.state.systemPrompt` |
| **Pi MCP** | `src/pi/mcp/*` | `McpServerManager` → connections, proxy tool |
| **Pi OAuth** | `src/pi/mcp/oauth/*` | `AppMcpOAuth` → vault tokens + callback server |
| **Pi auxiliary** | `src/pi/runtime/PiAuxQueryRunner.ts` | One-off Pi agents for aux tasks |
| **Obsidian UI** | `src/features/*` | User events → port calls |

## Adapter must not

- Leak Pi types into `src/core/` or `src/features/`.
- Read global MCP config paths (see ADR-0004).

## Migration strategy

1. Define or extend a **core port** with tests in `tests/unit/core/`.
2. Implement in `src/pi/` (or a future `src/<runtime>/`).
3. Register in `AgentServices` / `pi/registration.ts`.
4. Add ADR if the decision constrains future runtimes.

Replacing Pi means a new adaptor package implementing `ChatRuntime`, workspace services, and capabilities — not rewriting `features/chat/`.

## Dependencies

- [ADR-0002](../adr/0002-hexagonal-ports-and-adapters.md)
- [ADR-0003](../adr/0003-pi-as-sole-agent-runtime.md)

## Open questions

- Formal plugin API for community adaptors (out of scope today).

## Related ADRs

- [ADR-0002](../adr/0002-hexagonal-ports-and-adapters.md)
- [ADR-0003](../adr/0003-pi-as-sole-agent-runtime.md)
