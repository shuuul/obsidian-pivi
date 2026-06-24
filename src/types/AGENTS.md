# `src/types/` — Local ambient module declarations

Project-local `.d.ts` files for packages without bundled TypeScript declarations.

## Rules

- Keep declarations minimal and accurate to the consumed API surface.
- Prefer upstream/package types when they become available.
- Do not place domain model types here; use `src/core/types/` instead.
