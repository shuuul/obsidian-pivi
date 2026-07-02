# @pivi/core

## Purpose

`@pivi/core` is Pivi's dependency-free pure data model layer. It owns serializable contracts shared by runtime, UI, persistence, and tests.

## Allowed dependencies

- TypeScript built-ins and other runtime-free type-only helpers.
- Pivi-owned pure data contracts only when they do not introduce platform/runtime dependencies.

## Forbidden dependencies

- `obsidian`, `electron`, `fs`, `path`, or `node:*` filesystem/path imports.
- Raw Pi SDK packages (external Pi SDK packages).
- UI, runtime, MCP, or Obsidian host/tool implementation packages.

## Public API

- Chat models such as `ChatMessage` and `StreamChunk`.
- Settings models and settings type guards.
- Diff models for write/edit display.
- Tool display/state models.
- Agent and plugin metadata models.
- Exported through `@pivi/core` and `@pivi/core/*` package subpaths.
