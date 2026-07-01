# `src/features/shared/mention/` — Mention parsing, cache, dropdown, and badges

Shared mention infrastructure for files, folders, inline context, external context, and MCP mention display.

## Rules

- Keep parsing/display data provider-agnostic; prompt serialization belongs in core/runtime.
- Cache vault mention data with explicit invalidation hooks for vault changes.
- Badge rendering must be accessible and use scoped classes.
