# `src/pi/tools/obsidian/` — Native Obsidian tool implementations

Concrete tool handlers for note CRUD, search, links, properties, tasks, commands, eval, and approval pattern resolution.

## Rules

- Use `ObsidianVaultApi` dependencies instead of shelling out when Plugin API can satisfy the task.
- Validate paths and approval patterns before mutating vault contents.
- Keep returned tool text/metadata stable enough for chat renderers and subagent parsing.
