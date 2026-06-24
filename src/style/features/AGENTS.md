# `src/style/features/` — Feature-specific CSS

Styles for user-facing feature surfaces such as inline edit, diffs, plan approval, ask-user cards, file/image context, image modals, resume sessions, and slash commands.

## Rules

- Keep feature selectors under `.obsius2-*` and import files through `../index.css`.
- Prefer semantic Obsidian variables (`--text-*`, `--background-*`, `--color-*`) over fixed colors.
- Diff/approval states should remain legible in light and dark themes.
- Modal/overlay controls must preserve visible close and keyboard-focus affordances.
