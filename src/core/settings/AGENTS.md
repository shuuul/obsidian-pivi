# `src/core/settings/` — Settings normalization helpers

Core helpers for active model reconciliation and agent default settings.

## Rules

- Keep defaults centralized in `agentDefaults.ts`.
- Active model helpers should tolerate older stored settings while producing the current shape.
- Do not import feature UI or Pi implementation modules.
