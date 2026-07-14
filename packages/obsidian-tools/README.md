# @pivi/obsidian-tools

## Purpose

Concrete Obsidian-native tool specifications and execution helpers for note search/read/write, safe large-Markdown inspection, file operations, links, properties, tasks, guarded external filesystem reads, gated Bash, commands, eval, image generation, and history recovery.

## Allowed dependencies

- Obsidian public API for in-process tool behavior.
- `@pivi/pivi-agent-core/foundation`, `@pivi/pivi-agent-core/ports`, `@pivi/pivi-agent-core/tools`, and `@pivi/obsidian-host` contracts/adapters.
- External filesystem, process, and CLI access only through `@pivi/obsidian-host` adapters where the Obsidian public API cannot satisfy a capability.

## Forbidden dependencies

- Raw Pi SDK packages (external Pi SDK packages).
- `@pivi/pivi-react` imports.
- Pi runtime construction or Agent lifecycle imports.

## Public API

- `createObsidianTools`, Obsidian tool settings/types, frontmatter helpers, and vault edit matching helpers.
- `obsidian_read` supports stats-only and line-range reads; `obsidian_markdown_structure` exposes heading line numbers and character counts so large notes can be inspected before selective reads.
- `obsidian_read_external` / `obsidian_list_external` register only when external filesystem access is enabled and at least one allowed root is available.
- `obsidian_history`, `obsidian_tasks`, and `obsidian_daily` register only when the official Obsidian CLI is available; `obsidian_base` uses the CLI only for its query action.
- `obsidian_command` / `obsidian_eval` additionally require their settings gates and CLI availability. Image generation requires an injected generator.
- `obsidian_bash` registers only when the Bash tool toggle is enabled, runs allowlisted one-line commands, and rejects shell control syntax before invoking the injected process runner.
- Exported through `@pivi/obsidian-tools`.

## See also

For detailed package boundaries and development guidance, see [AGENTS.md](AGENTS.md) in this directory.
