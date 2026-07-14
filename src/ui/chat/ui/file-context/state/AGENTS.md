# `src/ui/chat/ui/file-context/state/` — File context UI state

*This file extends the root [AGENTS.md](../../../../../../AGENTS.md). Follow root guidance first, then these local rules.*

Tracks session-aware current-note sending, attached files, and mentioned MCP servers for the chat input UI.

## Rules

- Keep this state UI-facing and free of prompt serialization decisions.
- Use sets to deduplicate attachments and MCP mentions. Reset session-start/current-note flags when a new or loaded session changes the context boundary.
