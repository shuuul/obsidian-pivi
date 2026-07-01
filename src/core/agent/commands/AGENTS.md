# `src/core/agent/commands/` — Slash command catalog contracts

Slash command metadata and visibility helpers consumed by features and Pi workspace services.

## Rules

- Keep command entries serializable and UI-friendly; execution belongs outside this directory.
- Hidden command handling should normalize user settings before comparison.
- Do not import feature UI classes or low-level Pi SDK packages.
