# @pivi/pivi-agent-core

## Purpose

`@pivi/pivi-agent-core` is the host-neutral aggregate entrypoint for Pivi's reusable agent foundation. It collects contracts, tool protocol helpers, session storage, MCP services, skill metadata, and the first generic Pi runtime seams without importing concrete host adapter or UI code. Package surfaces are exported as namespaces so similarly named contracts from different layers do not collide.

## Allowed dependencies

- `auth/` for host-neutral provider credential IDs, provider environment variable names, disabled-provider checks, and structural API-key/OAuth credential extraction.
- `foundation/` for shared contracts and defaults.
- `tools/` for the generic tool protocol and display models.
- `session/` for host-neutral JSONL session persistence.
- `mcp/` for workspace-local MCP management and proxy tools.
- `context/` and `prompt/` for host-neutral XML context formatting and prompt assembly.
- `skills/` for skill and slash-command metadata helpers; remote/default skill orchestration receives `HttpClient` and `ProcessRunner` ports from the host.
- `runtime/`, `engine/`, and `engine/pi/` for host-neutral chat/runtime contracts, auxiliary query services, queued-turn helpers, the generic AgentEngine seam, and Pi SDK adapter helpers.
- Internal canonical `ports` contracts under `@pivi/pivi-agent-core/ports`; old package-local file-store and secret-store types should re-export these during migration.

## Forbidden dependencies

- Concrete host SDKs, platform UI APIs, or concrete adapter packages.
- Product app/UI imports such as `@/*`, `src/*`, `src/app/*`, or `src/ui/*`.

## Public API

- Provider credential helpers under `@pivi/pivi-agent-core/auth`.
- Canonical host capability contracts under `@pivi/pivi-agent-core/ports`.
- Declarative plugin/resource registry contracts under `@pivi/pivi-agent-core/plugins`.
- Namespaced foundation contracts/defaults under `@pivi/pivi-agent-core/foundation`.
- Namespaced tool protocol/display helpers under `@pivi/pivi-agent-core/tools`.
- Session contracts and JSONL persistence under `@pivi/pivi-agent-core/session`.
- Skill and slash-command helpers under `@pivi/pivi-agent-core/skills`.
- MCP config, OAuth, server management, and proxy tools under `@pivi/pivi-agent-core/mcp`.
- Prompt context formatting and prompt builders under `@pivi/pivi-agent-core/context` and `@pivi/pivi-agent-core/prompt`.
- Generic runtime seams under `@pivi/pivi-agent-core/runtime`.
- Generic AgentEngine contracts under `@pivi/pivi-agent-core/engine`.
- Pi SDK adapter helpers and Pi JSONL compatibility implementations under `@pivi/pivi-agent-core/engine/pi`.
