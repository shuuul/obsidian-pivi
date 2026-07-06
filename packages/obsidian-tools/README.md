# @pivi/obsidian-tools

## Purpose

Concrete Obsidian-native tool specifications and execution helpers for note search/read/write, safe large-Markdown inspection, file operations, links, properties, tasks, commands, eval, image generation, and history recovery.

## Allowed dependencies

- Obsidian public API for in-process tool behavior.
- `@pivi/pivi-agent-core/foundation`, `@pivi/pivi-agent-core/tools`, and `@pivi/obsidian-host` contracts/adapters.
- Node or CLI access only where the Obsidian public API cannot satisfy a tool capability.

## Forbidden dependencies

- Raw Pi SDK packages (external Pi SDK packages).
- Obsidian UI package imports.
- Pi runtime construction or Agent lifecycle imports.

## Public API

- `createObsidianTools`, Obsidian tool settings/types, frontmatter helpers, and vault edit matching helpers.
- `obsidian_read` supports stats-only and line-range reads; `obsidian_markdown_structure` exposes heading line numbers and character counts so large notes can be inspected before selective reads.
- Exported through `@pivi/obsidian-tools`.

## See also

For detailed package boundaries and development guidance, see [AGENTS.md](AGENTS.md) in this directory.
