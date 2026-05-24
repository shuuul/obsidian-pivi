# Agent runtime

## Purpose

Run the agent loop inside Obsidian: prepare turns, stream events to UI, sync system prompt, register tools.

## Responsibilities

- `PiChatRuntime` implements `ChatRuntime`.
- `PiAgentEventAdapter` maps Pi events → `StreamChunk` / UI messages.
- `ensureReady` / `syncSystemPrompt` manage Pi `Agent` lifecycle without unnecessary session wipes.
- Register MCP proxy tool when servers exist.

## Non-responsibilities

- Rendering (features/chat).
- MCP config editing (settings + `McpStorage`).
- Slash command content expansion (catalog in core; UI in features).

## Interfaces

| Symbol | Consumers |
|--------|-----------|
| `ChatRuntime` | Tab services, `InputController` via `getAgentService` |
| `RuntimeCapabilities` | Built-in commands, toolbar visibility |
| `prepareTurn()` | Input pipeline before `agent.prompt()` |

## Dependencies

- `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai` (pi package only)
- `PiMcpBridge`, `buildPiSystemPrompt`, `finalizeTurnPrompt`

## Design

One `Agent` instance per runtime; tools rebuilt on MCP reload. Active MCP mentions set on bridge before each turn. System prompt updated on settings blur via `syncSystemPrompt()` instead of `ensureReady({ force: true })` to preserve session.

## Alternatives considered

| Option | Why not |
|--------|---------|
| New Agent per message | Loses session state |
| Force rebuild on every settings change | Poor UX for long chats |

## Failure modes

| Failure | Mitigation |
|---------|------------|
| Model misconfigured | Notice from pi-ai; settings point to Providers tab |
| MCP connection auth required | User runs `/mcp-auth`; proxy returns actionable error |

## Open questions

- Native session export/import across vaults.

## Related ADRs

- [ADR-0003](../adr/0003-pi-as-sole-agent-runtime.md)
- [ADR-0006](../adr/0006-mcp-proxy-tool.md)
