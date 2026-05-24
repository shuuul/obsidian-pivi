# Turn prompt spec

## Problem

Each chat message must carry structured context (files, images, external dirs) and MCP-aware text without leaking implementation into the UI.

## Goals

- Build turn body in core (`buildTurnPrompt`).
- Separate **display** vs **API** prompt when MCP mentions exist (`finalizeTurnPrompt`).
- Keep core free of Pi imports.

## Non-goals

- Full Claudian XML parity for every edge case.
- Automatic history compaction (future).

## Data model

- `ChatTurnRequest` — raw input, attachments, enabled MCP servers, context files.
- `PreparedChatTurn` — `apiPrompt`, `displayPrompt`, `mcpMentions`, metadata.

## Flow

```
InputController
  → ChatTurnRequest
  → ChatRuntime.prepareTurn()
       → buildTurnPrompt()
       → finalizeTurnPrompt()  // MCP suffix, mention merge
  → PiChatRuntime sets bridge active mentions
  → agent.prompt(apiPrompt)
```

## Evaluation

- `tests/unit/core/` for prompt builders and mention transform.
- Manual: send `@server` message; confirm model receives ` MCP` suffix in network/debug if needed.

## Related

- [architecture/context-management.md](../architecture/context-management.md)
- [ADR-0005](../adr/0005-mcp-mention-transform.md)
