# `src/app/session/` — Open session orchestration

Owns app-level open-session CRUD and summary persistence for `main.ts`.

## Rules

- Keep runtime persistence behind the `SessionStore` port from `src/core/session/types.ts`.
- Do not import Pi SDK types or feature controllers here; UI side effects such as resetting tabs after deletion stay in `main.ts` / features.
- Preserve the `OpenSessionState` shape from `src/core/types` while session ownership migrates toward Pi-owned services.
