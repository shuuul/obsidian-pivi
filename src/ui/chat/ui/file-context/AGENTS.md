# `src/ui/chat/ui/file-context/` — Composer file context chips

*This file extends the root [AGENTS.md](../../../../../AGENTS.md). Follow root guidance first, then these local rules.*

State and view helpers for the automatically attached current-note chip. `FileContextManager` also owns inline file/folder mentions and MCP mention tracking outside these two leaf modules.

## Rules

- UI state belongs in `state/`; DOM chip rendering belongs in `view/`.
- This layer collects and normalizes context paths only. `ComposerSubmission` builds the `ChatTurnRequest`; core/runtime prompt helpers perform final serialization.
- Preserve the current-note chip's accessible open/remove controls and cleanup callbacks when adding interactions.
