# Context management

## Purpose

Assemble what the model sees each turn: user text, attachments, file context, external dirs, MCP mention expansion.

## Responsibilities

- `buildTurnPrompt` — structured turn body (incl. context files).
- `finalizeTurnPrompt` — MCP `@server` → `@server MCP` for API prompt.
- File/image/external context managers in features (collection) → serialized in turn request.
- Planned inline context chips serialize explicit editor selection snapshots into `<inline_contexts>`; see [inline-context-input-panel-spec.md](../specs/inline-context-input-panel-spec.md).

## Non-responsibilities

- Long-horizon memory / RAG (not implemented).
- Automatic context pruning policy (future spec).

## Interfaces

| API | Role |
|-----|------|
| `ChatTurnRequest` | Raw UI input + attachments |
| `PreparedChatTurn` | `apiPrompt`, `displayPrompt`, `mcpMentions` |
| `mergeQueuedChatTurns` | Queue composition |

Future inline context should be represented as explicit turn data, not by mutating user-visible input text. The prompt builder owns serialization so display, history, and API prompts stay separable.

## Dependencies

- `McpServerManager.transformMentions / extractMentions` for `@mention` handling
- Settings for default context behavior

## Design

UI keeps user-visible `@server`; model prompt adds ` MCP` so providers recognize MCP servers consistently (Claudian parity). Enabled toolbar servers merge into `mcpMentions` even without `@` in text.

## Alternatives considered

| Option | Why not |
|--------|---------|
| Transform in UI only | Easy to miss code paths; centralize at runtime boundary |
| Duplicate mention list in XML only | Toolbar enablement must affect tools |

## Failure modes

| Failure | Mitigation |
|---------|------------|
| Missing mention transform | Model may not invoke MCP proxy; covered by spec + tests |

## Open questions

- `buildPromptWithHistoryContext` for compaction/recovery (exported in utils but unused in features today).

## Related ADRs

- [ADR-0005](../adr/0005-mcp-mention-transform.md)

## Related specs

- [mcp-integration-spec.md](../specs/mcp-integration-spec.md)
- [inline-context-input-panel-spec.md](../specs/inline-context-input-panel-spec.md)
