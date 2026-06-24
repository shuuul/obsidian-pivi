# `src/features/inline-edit/ui/` — Inline edit modal UI

CodeMirror-backed modal for slash-command inline edits, mention selection, preview, and apply/cancel flows.

## Rules

- Preserve IME-safe text input and keyboard navigation.
- Clean up CodeMirror decorations, event listeners, and external context scanners on close.
- Keep provider/runtime calls behind the injected core inline-edit service.
