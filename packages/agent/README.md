# @pivi/agent

## Purpose

`@pivi/agent` holds Pivi's agent logic that imports neither Obsidian nor the Pi SDK, consumed through subpath exports (there is no root entrypoint). It owns runtime/application contracts such as `ChatPorts`, tool protocol helpers, session storage, MCP services, and skill metadata without importing concrete host adapter or UI code. App composition owns concrete wiring, `@pivi/pivi-react` owns React presentation, and `src/ui` owns remaining product orchestration and imperative adapters. Consumers import by subpath, so similarly named contracts from different directories do not collide.

## Allowed dependencies

- `auth/` for host-neutral provider credential IDs, provider environment variable names, disabled-provider checks, and structural API-key/OAuth credential extraction.
- `settings/` for shared settings contracts and defaults, including Obsidian tool gates such as external filesystem access and the Bash toggle/allowlist.
- `tools/` for the generic tool protocol and display models, including the `pivi_sessions` ToolSpec factory over an injected recovery port.
- `session/` for host-neutral session contracts, the session recovery port, open-session state, paths, and metadata; Pi JSONL persistence and compatibility implementations live under `@pivi/engine-pi/session/`.
- `mcp/` for workspace-local MCP management and proxy tools; this package directly declares the standalone `@earendil-works/pi-mcp` client used by those runtime transports and OAuth flows.
- `context/` and `prompt/` for host-neutral XML context formatting, runtime skill filtering, and registered-tool prompt assembly.
- `skills/` for skill and slash-command metadata helpers; runtime loaders exclude disabled vault skills while inventory loaders include them for settings and install prompts. A missing or locked skill entry is skipped, and a locked skills directory keeps the last successful inventory so a concurrent copy cannot blank the surface. Remote/default skill orchestration receives `HttpClient` and `ProcessRunner` ports from the host, and first-run confirmation is rendered through an injected host prompt callback rather than rendering confirmation DOM in this package.
- `runtime/` for host-neutral chat/runtime contracts, application-facing `ChatPorts`, auxiliary query services, and queued-turn helpers. Concrete Pi SDK adapters live in `@pivi/engine-pi`.
- Canonical host-capability contracts under `@pivi/agent/ports`.

## Forbidden dependencies

- Concrete host SDKs, platform UI APIs, or concrete adapter packages (`@pivi/obsidian-host`, `@pivi/obsidian-tools`, `obsidian`, `electron`).
- `@pivi/engine-pi` and raw `@earendil-works/*` Pi SDK imports.
- Product app/UI imports such as `@/*`, `src/*`, `src/app/*`, or `src/ui/*`.


## Public API

- Provider credential helpers under `@pivi/agent/auth/*` leaf subpaths.
- Canonical host capability contracts under `@pivi/agent/ports`.
- Settings contracts/defaults under `@pivi/agent/settings` and runtime contracts/helpers under `@pivi/agent/runtime`.
- Configuration publication/value-source helpers under `@pivi/agent/config/*` and logging under `@pivi/agent/logging/pluginLogger`.
- Namespaced tool protocol, the host-neutral `createSessionsTool` factory, and canonical presentation/summary helpers under `@pivi/agent/tools`.
- Session contracts, recovery port, paths, metadata, and linear open-session management under `@pivi/agent/session`; application ports open complete sessions by `sessionFile`, while concrete Pi JSONL tree compatibility stays under `@pivi/engine-pi/session/*`.
- Skill helpers, slash-command catalog contracts, and built-in slash-command IDs under `@pivi/agent/skills/*` leaf subpaths.
- MCP config, OAuth, server management, and proxy tools under `@pivi/agent/mcp`. Automatic prefetch warms enabled Streamable HTTP servers. Stdio MCP is not supported.
- Prompt context formatting, host-neutral mention parsing, and prompt builders under `@pivi/agent/context`, `@pivi/agent/context/mentions`, and `@pivi/agent/prompt`. MCP prompt inventory reflects settings-enabled servers and cached tool names.
- Runtime/application contracts, including `ChatPorts`, `PiChatService`, and `AuxQueryRunner`, under `@pivi/agent/runtime`.

Directory barrels are listed explicitly in `package.json`; every other source file is reachable through the `./*` wildcard export. Concrete Pi SDK adapters and JSONL compatibility live in `@pivi/engine-pi`, not this package.

## See also

For detailed package boundaries and development guidance, see [AGENTS.md](AGENTS.md) in this directory.
