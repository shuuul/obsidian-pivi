# `src/app/settings/` — Plugin settings persistence

Loads, normalizes, and writes Obsius settings from the shared vault storage path. This layer bridges stored JSON to core settings types and registered agent defaults.

## Rules

- Use `DEFAULT_OBSIUS_SETTINGS` and `DEFAULT_AGENT_SETTINGS` as the source of defaults.
- Normalize hidden slash commands and active model fields during load/merge.
- Keep Pi-specific details behind agent registration helpers; do not import adaptor internals.
