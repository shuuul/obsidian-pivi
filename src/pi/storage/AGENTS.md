# `src/pi/storage/` — Pi storage helpers

Pi-specific vault storage wrappers, currently MCP storage.

## Rules

- Keep storage paths vault-local and aligned with core path constants where applicable.
- Surface persistence errors to callers; do not silently discard MCP config changes.
