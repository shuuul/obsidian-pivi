# `src/core/agent/commands/` — Slash command catalog contracts

Provider-neutral command metadata and visibility helpers consumed by features and implemented/extended by the Pi adaptor.

## Rules

- Keep command entries serializable and UI-friendly; execution belongs outside this directory.
- Hidden command handling should normalize user settings before comparison.
- Do not import `src/pi/**` or feature UI classes.
