# `src/app/storage/` — Shared app storage service

Owns the plugin-level storage facade used by `main.ts`: tab manager state, settings access, and concrete Obsidian vault file adapter wiring.

## Rules

- Keep the storage shape compatible with `SharedAppStorage` from `src/pi/bootstrap/storage.ts` and the `FileStore` port from `src/pi/storage/FileStore.ts`.
- Use `PIVI_STORAGE_PATH` / `PIVI_SETTINGS_PATH` constants instead of string literals.
- Do not store rebuildable runtime objects; persist durable session/tab binding and user settings only.
