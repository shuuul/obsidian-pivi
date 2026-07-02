# @pivi/core package guide

## Purpose

`@pivi/core` is the dependency-free contract layer for Pivi. It owns shared TypeScript types and constants used across the app shell, UI, runtime, tools, sessions, and settings.

## Public entrypoints

- `src/index.ts` re-exports the package surface.
- `src/agent.ts` defines agent metadata/frontmatter contracts.
- `src/chat.ts` defines chat/session state, stream chunks, usage, attachments, and `VIEW_TYPE_PIVI`.
- `src/chatUi.ts` defines provider-driven chat UI configuration contracts.
- `src/diff.ts` defines structured diff display models.
- `src/plugins.ts` defines plugin metadata contracts.
- `src/settings.ts` defines `PiviSettings`, runtime settings, Obsidian tool settings, approvals, env snippets, slash commands, hidden-command normalization helpers, and type guards.
- `src/settingsDefaults.ts` defines product-level settings defaults shared by app, runtime, storage, UI, and tests.
- `src/tools.ts` defines tool-call, subagent, ask-user, plan-mode, and async status contracts.

## Boundaries

- Keep this package pure TypeScript data/contracts. No Obsidian API, DOM, Electron, Node filesystem, Pi SDK, MCP SDK, runtime services, or UI imports.
- Do not add runtime state or side effects here. Constants, defaults, and type guards are acceptable when they support the contracts.
- Prefer compact exported types over broad bags. If a field is package-specific, define it in the owning package and promote it here only when multiple packages need the contract.
- Avoid compatibility aliases. Update all importers when a contract changes.

## Package map

- `package.json` exports the barrel and each contract module as subpaths.
- There is no package-local build step; the repo build consumes TS source through workspace path mappings.
- The package-local `typecheck` script is a placeholder. Verify contract changes with the root typecheck and targeted tests for affected consumers.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
