# `src/core/session/` — Provider-neutral session contracts

Session store interfaces and durable session terminology shared across UI and adaptors.

## Rules

- Use canonical session terms: session file, leaf, tab binding, open session state.
- Keep Pi SDK message/session types out of core; map them in `src/pi/session/`.
