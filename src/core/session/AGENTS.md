# `src/core/session/` — Transitional session contracts

Session store interfaces and durable session terminology shared across UI and Pi session modules during migration.

## Rules

- Use canonical session terms: session file, leaf, tab binding, open session state.
- Keep Pi SDK message/session types out of core; map them in `src/pi/session/`.
