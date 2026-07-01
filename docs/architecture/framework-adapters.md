# Pi integration boundaries

## Purpose

Keep Pi-only integration simple while containing low-level SDK churn. Pivi does not maintain a multi-runtime adapter framework; Pi is the product runtime.

## Principle

> Pi product services are first-class Pivi modules; low-level SDK packages stay behind those modules.

## Pivi concepts

| Concept | Location | Notes |
|---------|----------|-------|
| `PiChatRuntime` / `ChatRuntime` contract | `src/pi/runtime/PiChatRuntime.ts`, `src/core/runtime/ChatRuntime.ts` | Turn lifecycle, stream, MCP reload |
| `ChatTurnRequest` / `PreparedChatTurn` | `src/core/runtime/types.ts` | Prompt + mentions |
| `ManagedMcpServer` | `src/core/types/mcp.ts` | Vault MCP config model |
| `PiWorkspaceServices` | `src/pi/app/PiWorkspaceServices.ts` | Concrete MCP/OAuth/skills/slash/settings service object created by `main.ts` |
| Turn prompt builder | `src/core/runtime/buildTurnPrompt.ts` | Pure user-turn prompt text + MCP mention finalize contract |
| Pi prompt fragments | `src/pi/prompt/` | Main system prompt text, inline edit, title generation, and tool guidance |
| Auxiliary services | `src/pi/services.ts`, `src/pi/runtime/PiAuxQueryRunner.ts` | Inline edit and title generation execution |
| Session store | `src/pi/session/` | JSONL session persistence |
| Context layer loading | `src/pi/runtime/loadContextLayers.ts` | Loads AGENTS.md chain, SYSTEM.md, and skills into prompt |
| Approval manager | `src/pi/security/ApprovalManager.ts`, `SessionApprovalRules.ts` | Pattern extraction/matching; per-session allow-always rules on `PiChatRuntime` (not persisted) |

## Pi integration responsibilities

| Area | Path | Owns |
|------|------|------|
| **Pi agent** | `src/pi/runtime/PiChatRuntime.ts` | Pi `Agent`, tools, streaming |
| **Pi system prompt** | `src/pi/runtime/buildPiSystemPrompt.ts` | Base settings + context layers → `Agent.state.systemPrompt` |
| **Pi MCP** | `src/pi/mcp/*` | `McpServerManager` → connections, proxy tool |
| **MCP OAuth** | `src/pi/mcp/oauth/*` | vault tokens + callback server |
| **Provider OAuth** | `src/pi/auth/*` | Provider connection UI → Obsidian secret storage / provider token services |
| **Pi auxiliary** | `src/pi/runtime/PiAuxQueryRunner.ts` | One-off Pi agents for aux tasks |
| **Obsidian UI** | `src/features/*` | User events → Pi product services / pure helpers |

## Boundary rules

- Do not import `@earendil-works/pi-ai`, `@earendil-works/pi-agent-core`, or `@earendil-works/pi-coding-agent` from feature/shared UI. Use Pivi-owned `src/pi/**` product modules instead.
- Keep raw MCP SDK usage in `src/pi/mcp/**`.
- Share provider credentials outside Pi auth modules. Provider API keys/OAuth live behind `src/pi/auth/*` and `pi-ai` credential abstractions; MCP OAuth lives behind `src/pi/mcp/oauth/*` and vault-local `.pivi/mcp-oauth/` storage.
- Read global MCP config paths.

## Simplification strategy

Prefer direct Pi product services over new generic ports. `PiWorkspaceServices` is a concrete composition object, not a base interface. If a small interface helps tests or lifecycle ownership, keep it local and behavior-named instead of adding broad registration buckets.

## Dependencies

- [system-architecture.md](./system-architecture.md)
- [agent-runtime.md](./agent-runtime.md)

## Related

- [system-architecture.md](./system-architecture.md)
- [agent-runtime.md](./agent-runtime.md)
