# `src/features/chat/state/` — Chat tab state model

Mutable in-memory state and type definitions for a rendered chat tab. Rebuildable state lives here; durable identity remains session file + leaf id.

## Rules

- Keep state transitions explicit and serializable where they cross tab persistence boundaries.
- Do not persist `openSessionId` as durable identity; use session file and leaf id.
- Avoid importing renderers/controllers into state types.
