# `src/features/chat/ui/file-context/` — Composer file context chips

State and view helpers for files attached to the chat composer.

## Rules

- UI state belongs in `state/`; DOM chip rendering belongs in `view/`.
- Prompt serialization happens later at the core/runtime boundary.
- Preserve accessible chip controls and cleanup callbacks when adding interactions.
