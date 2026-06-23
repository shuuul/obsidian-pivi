# Memory system

## Purpose

Long-horizon recall across sessions (distinct from turn context and session metadata).

## Responsibilities

*Not implemented as a dedicated subsystem.*

Today:

- **Session metadata** — JSONL under `.obsius/sessions/` (`PiSessionStore`), conversation list, resume/fork where supported.
- **Turn context** — files, images, external dirs per message ([context-management.md](./context-management.md)).

## Session persistence

- `SessionStore` interface (`src/core/session/types.ts`) — port for JSONL-based session persistence.
- `SessionTreeStore` (`src/pi/session/SessionTreeStore.ts`) — tree model with fork/rewind semantics.
- `PiSessionStore` (`src/pi/session/PiSessionStore.ts`) — facade over SessionManager for read/write/fork/list.
- `MessageMapper` (`src/pi/session/MessageMapper.ts`) — maps between Pi agent messages and Obsius chat messages.

See [session-tree-spec.md](../specs/session-tree-spec.md) for details.

## Non-responsibilities

- Vector store / RAG over vault (future).
- Cross-vault memory sync.

## Open questions

- Whether vault notes under `.obsius/` should store agent memory artifacts.
- Relationship to Obsidian’s own search and backlinks.

## Related

- [context-management.md](./context-management.md)
- [../specs/session-tree-spec.md](../specs/session-tree-spec.md)
