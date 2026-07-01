# Turn prompt spec

## Problem

Each chat message must carry structured context (files, images, external dirs) and MCP-aware text without leaking implementation into the UI.

## Goals

- Build turn body in a pure prompt helper (`buildTurnPrompt`).
- Separate **display** vs **API** prompt when MCP mentions exist (`finalizeTurnPrompt`).
- Keep prompt assembly testable and free of low-level Pi SDK imports.

## Non-goals

- Full parity with legacy upstream XML conventions for every edge case.
- Automatic history compaction (future).

## Data model

- `ChatTurnRequest` — raw input, attachments, enabled MCP servers, context files.
- `PreparedChatTurn` — `apiPrompt`, `displayPrompt`, `mcpMentions`, metadata.
- Explicit editor selections use `inlineContexts` on `ChatTurnRequest`; see [inline-context-input-panel-spec.md](./inline-context-input-panel-spec.md).

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

### Future harness

Add a small deterministic regression harness for prompt assembly and MCP mention behavior before the prompt surface grows further. It should cover:

- display prompt vs API prompt separation;
- MCP slash/mention transforms and toolbar-enabled server merging;
- attached file/folder/external context metadata;
- high-risk prompt sections whose wording affects tool choice.

## Related

- [architecture/context-management.md](../architecture/context-management.md)
- [inline-context-input-panel-spec.md](./inline-context-input-panel-spec.md)
- [mcp-integration-spec.md](./mcp-integration-spec.md)
