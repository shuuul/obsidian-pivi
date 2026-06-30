# Framework adapters

## Purpose

Keep **Pivi core abstractions** independent of Pi, MCP SDK, and Obsidian so framework swaps touch only adaptor code.

## Principle

> Frameworks are implementation backends, not the source of domain concepts.

## Internal concepts (core)

| Concept | Location | Notes |
|---------|----------|-------|
| `ChatRuntime` | `src/core/runtime/ChatRuntime.ts` | Turn lifecycle, stream, MCP reload |
| `ChatTurnRequest` / `PreparedChatTurn` | `src/core/runtime/types.ts` | Prompt + mentions |
| `ManagedMcpServer` | `src/core/types/mcp.ts` | Vault MCP config model |
| `AppMcpOAuth` | `src/core/agent/types.ts` | OAuth port |
| Prompt builders | `src/core/prompt/`, `src/core/runtime/buildTurnPrompt.ts` | Provider-agnostic text |
| Auxiliary services | `src/core/auxiliary/` | Refine, inline-edit, title |
| Session store | `src/core/session/types.ts` | Port interface for JSONL session persistence |
| Obsidian agent tools prompt | `src/core/prompt/obsidianAgentTools.ts` | Generates the "Available Tools" section of system prompt |
| Context layer loading | `src/pi/context/loadContextLayers.ts` | Loads AGENTS.md chain, SYSTEM.md, and skills into prompt |
| Approval manager | `src/core/security/ApprovalManager.ts`, `SessionApprovalRules.ts` | Pattern extraction/matching; per-session allow-always rules on `PiChatRuntime` (not persisted) |

## Adapter responsibilities

| Adapter | Path | Maps |
|---------|------|------|
| **Pi agent** | `src/pi/runtime/PiChatRuntime.ts` | `ChatRuntime` → Pi `Agent`, tools, streaming |
| **Pi system prompt** | `src/pi/runtime/buildPiSystemPrompt.ts` | Base settings + context layers → `Agent.state.systemPrompt` |
| **Pi MCP** | `src/pi/mcp/*` | `McpServerManager` → connections, proxy tool |
| **MCP OAuth** | `src/pi/mcp/oauth/*` | `AppMcpOAuth` → vault tokens + callback server |
| **Provider OAuth** | `src/pi/auth/*` | Provider connection UI → Obsidian secret storage / provider token services |
| **Pi auxiliary** | `src/pi/runtime/PiAuxQueryRunner.ts` | One-off Pi agents for aux tasks |
| **Obsidian UI** | `src/features/*` | User events → port calls |

## Adapter must not

- Leak Pi types into `src/core/` or `src/features/`.
- Import `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, or `@earendil-works/pi-coding-agent` from `src/core/`, `src/app/`, `src/features/`, or `src/shared/`. ESLint enforces this boundary; `src/pi/**` and tests are the allowed zones for direct Pi package imports.
- Share provider credentials outside the Pi adapter. Provider API keys/OAuth live behind `src/pi/auth/*` and `pi-ai` credential abstractions; MCP OAuth lives behind `src/pi/mcp/oauth/*` and vault-local `.pivi/mcp-oauth/` storage.
- Read global MCP config paths.

## Migration strategy

1. Define or extend a **core port** with tests in `tests/unit/core/`.
2. Implement in `src/pi/` (or a future `src/<runtime>/`).
3. Register in `pi/bootstrap.ts` via `AgentRegistration`.
4. Update architecture/spec docs if the decision constrains future work.

Pivi is **Pi-only**. Replacing Pi would mean rewriting `src/pi/` and bootstrap — not `features/chat/`.

## Dependencies

- [system-architecture.md](./system-architecture.md)
- [agent-runtime.md](./agent-runtime.md)

## Open questions

- Formal plugin API for community adaptors (out of scope today).

## Related

- [system-architecture.md](./system-architecture.md)
- [agent-runtime.md](./agent-runtime.md)
