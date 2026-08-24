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

- Production composition imports Pi capabilities only through stable responsibility-scoped `@pivi/engine-pi/application/{auth,models,oauth,oauth-flows,runtime,session}` surfaces, avoiding both implementation deep imports and one eager all-engine barrel.
- Focused engine compatibility tests may use declared leaf exports to exercise implementation modules without widening the production composition boundary.
- Pi JSONL session compatibility under `@pivi/engine-pi/session/*`.
- Obsidian-safe Pi SDK shims under `@pivi/engine-pi/shims/*`.
- Tool-registry and subagent/skill adapters under dedicated leaf exports such as `buildPiToolRegistryCore`, `createSkillTool`, and `createSubagentTool`.

## See also

For detailed package boundaries and development guidance, see [AGENTS.md](AGENTS.md) in this directory.
