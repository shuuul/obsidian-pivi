# Context management

## Purpose

Assemble what the model sees each turn: user text, attachments, file context, external dirs, MCP mention expansion.

## Responsibilities

- `buildTurnPrompt` — structured turn body (incl. context files).
- `finalizeTurnPrompt` — MCP `@server` → `@server MCP` for API prompt.
- File/image/external context managers in features (collection) → serialized in turn request.
- Inline context composer tokens serialize explicit editor selection snapshots into `<inline_contexts>`; see [inline-context-input-panel-spec.md](../specs/inline-context-input-panel-spec.md).

## Non-responsibilities

- Long-horizon memory / RAG (not implemented).
- Automatic context pruning/compaction policy; current direction favors non-destructive forks and explicit context selection.

## Interfaces

| API | Role |
|-----|------|
| `ChatTurnRequest` | Raw UI input + attachments |
| `PreparedChatTurn` | `apiPrompt`, `displayPrompt`, `mcpMentions` |
| `mergeQueuedChatTurns` | Queue composition |

Inline context is entered as user-visible composer tokens (`@[pivi-inline-context:...]`), extracted before submission into `ChatTurnRequest.inlineContexts`, and serialized by the prompt builder. The visible token and the API prompt payload remain separable so history/display text does not become the machine-only context block.

## Dependencies

- `McpServerManager.transformMentions / extractMentions` for `@mention` handling
- Settings for default context behavior

## Design

UI keeps user-visible `@server`; model prompt adds ` MCP` so Pi/MCP tooling recognizes MCP servers consistently. Enabled toolbar servers merge into `mcpMentions` even without `@` in text. Inline context follows the same display/API split: UI collects/removes tokens, while prompt helpers serialize selected text into prompt-only context.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Transform in UI only | Easy to miss code paths; centralize at runtime boundary |
| Duplicate mention list in XML only | Toolbar enablement must affect tools |

## Failure modes

| Failure | Mitigation |
|---------|------------|
| Missing mention transform | Model may not invoke MCP proxy; covered by spec + tests |

## Resolved non-goals

- Automatic compaction/recovery prompt rewriting is not part of the current product direction. If large-history handling returns, specify it as a new non-destructive session-tree behavior rather than reviving ad hoc prompt mutation.

## Related

- [prompt-system.md](./prompt-system.md)
- [../specs/turn-prompt-spec.md](../specs/turn-prompt-spec.md)

## Related specs

- [mcp-integration-spec.md](../specs/mcp-integration-spec.md)
- [inline-context-input-panel-spec.md](../specs/inline-context-input-panel-spec.md)
