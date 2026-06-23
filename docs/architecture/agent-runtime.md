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
| `ChatRuntime` | Tab services, `InputController` via `PiAgentServices.createChatRuntime()` (wired via tabRuntime.ts) |
| `RuntimeCapabilities` | Built-in commands, toolbar visibility |
| `prepareTurn()` | Input pipeline before `agent.prompt()` |
| `syncThinkingLevel(level?)` | Hot-update reasoning effort without restart |
| `buildSessionUpdates()` | Build session metadata for persistence after each turn |
| `testConnectivity()` | Health check for provider connectivity |

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

## Related

- [system-architecture.md](./system-architecture.md)
- [tool-system.md](./tool-system.md)
