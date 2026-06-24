# `src/core/bootstrap/` — Bootstrap storage contracts

Small shared contracts and constants used by `main.ts` and app storage to agree on vault-local storage paths.

## Rules

- Keep this directory dependency-light and safe to import from app/core code.
- Update path constants here before touching scattered string literals elsewhere.
