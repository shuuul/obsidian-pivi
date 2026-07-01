# `src/features/inline-edit/` — Inline edit feature

Obsidian/CodeMirror inline-edit UI that sends selected editor context through a Pi auxiliary edit service.

## Rules

- Prefer direct Pi auxiliary service wiring.
- Keep CodeMirror decorations, modal UI, and Obsidian editor integration in this feature.
- Preserve selected-text context and insertion normalization before applying edits.
