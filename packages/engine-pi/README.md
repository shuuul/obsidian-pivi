# @pivi/engine-pi

## Purpose

`@pivi/engine-pi` is Pivi's Pi SDK adapter package. It constructs in-process Pi agents, adapts Pivi tools and sessions to Pi types, configures providers/authentication, and exposes host-neutral implementations of `PiChatService` and `AuxQueryRunner`. This is the only application source package where raw `@earendil-works/*` imports are allowed.

## Allowed dependencies

- `@pivi/agent` host-neutral contracts, ports, runtime seams, and tool protocol types.
- Exact-pinned `@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, and `@earendil-works/pi-coding-agent` packages.
- Injected host capabilities typed by `@pivi/agent/ports` (HTTP, process, secrets, files, openers).

## Forbidden dependencies

- Concrete Obsidian host/tool packages (`@pivi/obsidian-host`, `@pivi/obsidian-tools`).
- React presentation (`@pivi/pivi-react`, `react`, `react-dom`).
- Product app/UI imports such as `@/*`, `src/*`, `src/app/*`, or `src/ui/*`.
- Direct `obsidian` or `electron` imports.

## Public API

- Pi chat runtime, settings coordinator, model registry/auth helpers, and auxiliary query runner under `@pivi/engine-pi` leaf exports.
- Pi JSONL session compatibility under `@pivi/engine-pi/session/*`.
- Obsidian-safe Pi SDK shims under `@pivi/engine-pi/shims/*`.
- Tool-registry and subagent/skill adapters under dedicated leaf exports such as `buildPiToolRegistryCore`, `createSkillTool`, and `createSubagentTool`.

## See also

For detailed package boundaries and development guidance, see [AGENTS.md](AGENTS.md) in this directory.
