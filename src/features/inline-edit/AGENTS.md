# `src/features/inline-edit/` — Inline edit feature

Obsidian/CodeMirror inline-edit UI that sends selected editor context through the core inline-edit service.

## Rules

- Use `AgentServices` for inline-edit service access; never import `src/pi/**`.
- Keep CodeMirror decorations, modal UI, and Obsidian editor integration in this feature.
- Preserve selected-text context and insertion normalization before applying edits.
