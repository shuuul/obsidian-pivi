# `src/ui/chat/ui/file-context/view/` — File context chip DOM

*This file extends the root [AGENTS.md](../../../../../../AGENTS.md). Follow root guidance first, then these local rules.*

Renders the automatically attached current-note chip and its open/remove interactions. Inline mentioned files and folders are rendered through the separate context-badge path.

## Rules

- Use scoped `.pivi-*` classes and accessible labels.
- Keep callbacks injected from UI managers; do not mutate runtime/session state directly.
