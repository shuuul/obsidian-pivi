# `src/features/chat/ui/file-context/state/` — File context UI state

Tracks composer file-context selections and exposes state operations for the chat input UI.

## Rules

- Keep this state UI-facing and free of prompt serialization decisions.
- Normalize duplicate file entries before rendering chips.
