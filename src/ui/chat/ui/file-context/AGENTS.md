# `src/ui/chat/ui/file-context/` — Composer file context chips

*This file extends the root [AGENTS.md](../../../../../AGENTS.md). Follow root guidance first, then these local rules.*

State and view helpers for files attached to the chat composer.

## Rules

- UI state belongs in `state/`; DOM chip rendering belongs in `view/`.
- Prompt serialization happens later at the core/runtime boundary.
- Preserve accessible chip controls and cleanup callbacks when adding interactions.
