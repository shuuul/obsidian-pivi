# @pivi/session package guide

## Purpose

`@pivi/session` owns host-neutral session persistence and conversation tree helpers. It maps Pi JSONL session entries to Pivi chat messages, wraps Pi session-manager storage, manages open session projections, and provides path/history utilities.

## Public entrypoints

- `src/index.ts` re-exports the public session surface.
- `src/types.ts` defines `SessionStore`, `FileStore`, session refs/summaries, leaf summaries, and Pivi custom entry constants.
- `src/SessionTreeStore.ts` wraps Pi `SessionManager` with create/open/snapshot/fork/in-memory factories, branch/leaf operations, append helpers, live-by-key caching, and flushing.
- `src/PiSessionStore.ts` implements `SessionStore` over `SessionTreeStore` and a `FileStore` adapter.
- `src/OpenSessionManager.ts` manages in-memory open-session state for UI projections.
- `src/MessageMapper.ts` converts Pi session entries into Pivi `ChatMessage[]` and extracts message UI/session metadata.
- `src/sessionPaths.ts` owns `.pivi/sessions` path encoding and vault-relative/absolute conversions.
- `src/agentMessageHistory.ts` compares/restores agent messages and sanitizes orphaned tool results.
- `src/subagentJsonl.ts` extracts final results from subagent JSONL output.
- `src/userQuery.ts` strips XML context tags from user prompts to recover the human query.

## Boundaries

- Keep this package host-neutral. No Obsidian API, DOM, Electron, or UI imports.
- File operations go through the `FileStore` contract or narrowly scoped Node path/fs utilities already owned by this package.
- Pi session-manager integration belongs here; UI and runtime consumers should use `SessionStore`, `OpenSessionManager`, and mapping helpers.
- Preserve JSONL/session metadata compatibility intentionally. Do not silently drop unknown entries unless the mapper contract requires it.
- Keep error handling explicit for missing files, malformed sessions, and failed persistence.

## Package map

- `package.json` exports the barrel and source subpaths.
- There is no package-local build step; source is consumed by the app build.
- The package-local `typecheck` script is a placeholder. Verify session changes with root typecheck and targeted session/runtime tests.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
