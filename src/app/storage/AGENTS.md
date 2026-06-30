# `src/app/storage/` — Shared app storage service

Owns the plugin-level storage facade used by `main.ts`: tab manager state, settings access, and vault file adapter wiring.

## Rules

- Keep the storage shape compatible with `SharedAppStorage` from `src/core/bootstrap/storage.ts`.
- Use `PIVI_STORAGE_PATH` / `PIVI_SETTINGS_PATH` constants instead of string literals.
- Do not store rebuildable runtime objects; persist durable session/tab binding and user settings only.
