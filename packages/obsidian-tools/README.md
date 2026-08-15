# @pivi/obsidian-tools

## Purpose

Concrete Obsidian-native tool specifications and execution helpers for note search/read/write, safe large-Markdown inspection, file operations, links, properties, tasks, guarded external filesystem reads, gated Bash, commands, eval, image generation, and Obsidian file-history recovery. Host-neutral Pivi session recovery tooling is owned by `@pivi/agent`.

## Allowed dependencies

- Obsidian public API for in-process tool behavior.
- `@pivi/agent/foundation`, `@pivi/agent/ports`, `@pivi/agent/tools`, and `@pivi/obsidian-host` contracts/adapters.
- External filesystem, process, and CLI access only through `@pivi/obsidian-host` adapters where the Obsidian public API cannot satisfy a capability.

## Forbidden dependencies

- Raw Pi SDK packages (external Pi SDK packages).
- `@pivi/pivi-react` imports.
- Pi runtime construction or Agent lifecycle imports.

## Public API

- `createObsidianTools` and Obsidian tool settings/types.
- `pivi_sessions` is intentionally not exported or composed here; app composition adds the `@pivi/agent`-owned factory to the shared base provider.
- `obsidian_read` supports stats-only and line-range reads; `obsidian_markdown_structure` exposes heading line numbers and character counts so large notes can be inspected before selective reads.
- `obsidian_read_external` / `obsidian_list_external` register only when external filesystem access is enabled and at least one allowed root is available.
- `obsidian_history`, `obsidian_tasks`, and `obsidian_daily` register only when the official Obsidian CLI is available; `obsidian_base` uses the CLI only for its query action.
- `obsidian_base` resolves a requested Base directly for view inspection, while its list action remains an explicit vault inventory operation. `obsidian_graph` enumerates files only for orphan/deadend analysis; unresolved-only analysis uses cached link metadata.
- `obsidian_command` / `obsidian_eval` additionally require their settings gates and CLI availability. Image generation requires an injected generator.
- `obsidian_bash` registers only when the Bash tool toggle is enabled. New grants are tagged `exact:` complete commands or `prefix:` shell-safe argv prefixes; prefix authority never extends across control operators, substitutions, pipelines, redirects, expansion, or extra commands. Prefix matching uses a shell-specific safe argv parser for POSIX shells and Windows `cmd.exe`. Legacy untagged entries retain prefix behavior only for those known shells and do not authorize commands on unsupported or unknown shell dialects. Execution uses the resolved login shell (`$SHELL -lc`, fish `-c`, or `cmd.exe /d /s /c`) and the injected bounded process runner.
- Exported through `@pivi/obsidian-tools`.

## See also

For detailed package boundaries and development guidance, see [AGENTS.md](AGENTS.md) in this directory.
