# `src/app/` — Obsidian app persistence and view access

Thin application-adapter helpers used by `main.ts`: plugin data storage, vault-backed settings storage, and lookup helpers for open Pivi views.

## Map

```mermaid
flowchart TD
  Main["main.ts"] -- "loads/saves" --> Storage["storage/SharedStorageService"]
  Storage -- "delegates settings" --> Settings["settings/PiviSettingsStorage"]
  Storage -- "vault file IO" --> CoreStorage["core/storage/VaultFileAdapter"]
  Main -- "finds views" --> ViewAccess["viewAccess.ts"]
```

## Rules

- Keep runtime-specific normalization behind `core/agent/AgentServices`; do not import `src/pi/**` here.
- Persist durable tab identity as session-oriented fields, not transient runtime state.
- User-visible storage failures should surface through Obsidian `Notice` only where callers expect UI feedback.
