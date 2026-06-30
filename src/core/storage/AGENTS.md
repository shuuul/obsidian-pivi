# `src/core/storage/` — File adapter abstractions

Framework-neutral file storage ports used by app storage and Pi vault-local services. Concrete Obsidian/home filesystem implementations live in `src/app/storage/`.

## Rules

- Define interfaces only; do not import Obsidian, Node filesystem, Pi, MCP SDKs, or UI code here.
- Prefer callers passing validated paths; do not hide domain-specific path decisions here.
- Surface IO errors to callers rather than swallowing persistence failures silently.
