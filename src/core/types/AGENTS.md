# `src/core/types/` — Dependency-free domain types

Shared type definitions for chat, settings, tools, MCP, diffs, agents, and plugin metadata. This directory should stay dependency-free: no imports from Obsidian, Pi, features, or utilities unless they are type-only and unavoidable.

## Type map

```mermaid
flowchart TD
  Index["index.ts<br/>barrel"] --> Chat["chat.ts<br/>messages/streams/openSessions"]
  Index --> Settings["settings.ts<br/>plugin + agent settings"]
  Index --> Mcp["mcp.ts<br/>server configs/metadata"]
  Index --> Tools["tools.ts<br/>tool calls/subagents/ask-user"]
  Index --> Diff["diff.ts<br/>write/edit diff data"]
  Index --> Agent["agent.ts<br/>agent/task metadata"]
  Index --> Plugins["plugins.ts<br/>plugin integration types"]
```

## Rules

- Prefer `export interface` / `export type` and discriminated unions for runtime-state shapes.
- Keep settings extensible only where needed for adaptor-specific fields.
- Do not encode Pi SDK types here; define provider-neutral shapes and map in `src/pi/`.
