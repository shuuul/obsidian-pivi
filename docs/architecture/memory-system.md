# Memory system

## Purpose

Long-horizon recall across sessions (distinct from turn context and session metadata).

## Responsibilities

*Not implemented as a dedicated subsystem.*

Today:

- **Session metadata** — JSONL under `.obsius/sessions/` (`PiSessionStore`), conversation list, resume/fork where supported.
- **Turn context** — files, images, external dirs per message ([context-management.md](./context-management.md)).

## Non-responsibilities

- Vector store / RAG over vault (future).
- Cross-vault memory sync.

## Open questions

- Whether vault notes under `.obsius/` should store agent memory artifacts.
- Relationship to Obsidian’s own search and backlinks.

## Related ADRs

- (none yet — add ADR when memory scope is chosen)
