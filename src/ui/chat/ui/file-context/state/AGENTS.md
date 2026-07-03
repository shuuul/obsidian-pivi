# `src/ui/chat/ui/file-context/state/` — File context UI state

*This file extends the root [AGENTS.md](../../../../../../AGENTS.md). Follow root guidance first, then these local rules.*

Tracks composer file-context selections and exposes state operations for the chat input UI.

## Rules

- Keep this state UI-facing and free of prompt serialization decisions.
- Normalize duplicate file entries before rendering chips.
