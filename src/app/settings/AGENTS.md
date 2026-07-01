# `src/app/settings/` — Plugin settings persistence

Loads, normalizes, and writes Pivi settings from the shared vault storage path. This layer bridges stored JSON to settings types and Pi defaults.

## Rules

- Use `DEFAULT_PIVI_SETTINGS` and `DEFAULT_AGENT_SETTINGS` as the source of defaults.
- Normalize hidden slash commands and active model fields during load/merge.
- Prefer Pi settings helpers directly over agent registration helpers.
