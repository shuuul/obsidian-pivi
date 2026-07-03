# @pivi/obsidian-tools

## Purpose

Concrete Obsidian-native tool specifications and execution helpers for note search/read/write, file operations, links, properties, tasks, commands, eval, and approval checks.

## Allowed dependencies

- Obsidian public API for in-process tool behavior.
- `@pivi/pivi-agent-core/foundation`, `@pivi/pivi-agent-core/tools`, and `@pivi/obsidian-host` contracts/adapters.
- Node or CLI access only where the Obsidian public API cannot satisfy a tool capability.

## Forbidden dependencies

- Raw Pi SDK packages (external Pi SDK packages).
- Obsidian UI package imports.
- Pi runtime construction or Agent lifecycle imports.

## Public API

- `createObsidianToolSpecs`, Obsidian tool settings/types, frontmatter helpers, and vault edit matching helpers.
- Exported through `@pivi/obsidian-tools`.
