# `src/shared/modals/` — Reusable Obsidian modals

Confirm, create-command, and fork-target modal helpers used by multiple features.

## Rules

- Keep modals promise/callback friendly and free of global state.
- Use Obsidian modal lifecycle cleanup and accessible labels.
- Feature-specific persistence decisions belong to callers.
