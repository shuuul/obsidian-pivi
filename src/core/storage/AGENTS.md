# `src/core/storage/` — File adapter abstractions

Vault/home file adapter helpers used by app storage and Pi vault-local services.

## Rules

- Keep adapters small and explicit about path roots (vault vs home).
- Prefer callers passing validated paths; do not hide domain-specific path decisions here.
- Surface IO errors to callers rather than swallowing persistence failures silently.
