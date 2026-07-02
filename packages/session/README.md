# @pivi/session

## Purpose

Session persistence and JSONL conversation tree helpers. It preserves compatibility with the Pi JSONL session format while exposing Pivi-owned session storage contracts.

## Allowed dependencies

- `@pivi/core` contracts.
- Node `fs`/`path` for JSONL session file location and persistence helpers.
- Narrow Pi session compatibility imports from `@earendil-works/pi-coding-agent/dist/core/session-manager.js` and related Pi message types.

## Forbidden dependencies

- `obsidian` and `electron` runtime imports.
- Obsidian UI, Obsidian tools, or app composition imports.
- New raw Pi SDK usage outside session compatibility types/adapters.

## Public API

- `PiSessionStore`, `SessionTreeStore`, `MessageMapper`, session path helpers, and session/message history types.
- Exported through `@pivi/session` and `@pivi/session/*` package subpaths.
