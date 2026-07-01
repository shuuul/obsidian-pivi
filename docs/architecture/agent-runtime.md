# Agent runtime

## Purpose

Run the agent loop inside Obsidian: prepare turns, stream events to UI, sync system prompt, register tools.

## Responsibilities

- `PiChatRuntime` owns the in-process Pi `Agent` lifecycle.
- `PiAgentEventAdapter` maps Pi events → `StreamChunk` / UI messages.
- `ensureReady` / `syncSystemPrompt` manage Pi `Agent` lifecycle without unnecessary session wipes.
- Register MCP proxy tool when servers exist.

## Non-responsibilities

- Rendering (features/chat).
- MCP config editing (settings + `McpStorage`).
- Slash command content expansion (catalog in src/pi/app/; UI in features).

## Interfaces

| Symbol | Consumers |
|--------|-----------|
| `PiChatRuntime` / `ChatRuntime` contract | Tab services and controllers via the tab runtime factory. |
| `prepareTurn()` | Input pipeline before `agent.prompt()` |
| `syncThinkingLevel(level?)` | Hot-update reasoning effort without restart |
| `buildSessionUpdates()` | Build session metadata for persistence after each turn |
| `testConnectivity()` | Health check for provider connectivity |

## Dependencies

- `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai` (pi package only)
- `@earendil-works/pi-coding-agent` session/skill helpers stay behind Pivi-owned Pi modules: import them from `src/pi/**` and tests only, not directly from UI code.
- `PiMcpBridge`, `buildPiSystemPrompt`, `finalizeTurnPrompt`

## Credential ownership boundary

Provider credentials are owned by Pi auth modules and the `pi-ai` provider layer, not by UI state. Pivi stores provider API keys and OAuth tokens through `src/pi/auth/*` using Obsidian `secretStorage` and exposes provider connection state/settings through Pi product services. MCP OAuth is a separate vault-local concern under `src/pi/mcp/oauth/*` and `.pivi/mcp-oauth/`; it must not reuse provider credential stores or leak provider token types into MCP settings.

`src/pi/piAiModels.ts` is the allowed provider registration boundary for `pi-ai` provider factories. Runtime readiness checks call `piAiModels.getAuth(model)` through `src/pi/runtime/piModelEnv.ts`, and request streaming delegates to `piAiModels.streamSimple(...)` without passing a `pi-agent-core Agent.getApiKey` callback. This keeps credential precedence, OAuth refresh, and stored-credential-vs-env behavior inside the injected `CredentialStore` / `AuthContext` pair. Legacy Codex `.pivi/auth.json` credentials are migrated into SecretStorage before `getAuth()` runs, then pi-ai remains the request-time auth source of truth.

## Design

One `Agent` instance per runtime; tools rebuilt on MCP reload. Active MCP mentions set on bridge before each turn. System prompt updated on settings blur via `syncSystemPrompt()` instead of `ensureReady({ force: true })` to preserve session.

Pi emits multiple internal loop turns for a single human input when tools are involved. The runtime therefore treats `message_start(role=assistant)` / `message_start(role=user)` as visible message boundaries and does not expose `turn_start` as a new assistant bubble. JSONL persistence still records every assistant/toolResult message; the UI projection groups consecutive assistant segments until the next user message.

The current `ChatRuntime` interface remains as a chat-feature contract for streaming/session lifecycle. It should stay narrow: do not add generic runtime capability flags or no-op provider-compatibility methods.

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
