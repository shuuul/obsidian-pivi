# @pivi/pivi-agent-core package guide

*This file extends the root [AGENTS.md](../../AGENTS.md). Follow root guidance first, then these package-specific rules.*

## Purpose

`@pivi/pivi-agent-core` is the host-neutral aggregate package for reusable Pivi agent capabilities. It gives software hosts one intentional import surface for contracts, tools, sessions, MCP, skills, and generic runtime seams while concrete host adapters remain outside the package. Broad package surfaces are exported as namespaces to avoid flattening conflicting contract names.

## Public entrypoints

- `src/index.ts` re-exports the package surface for agent consumers using `auth`, `engine`, `context`, `foundation`, `prompt`, `plugins`, `ports`, `runtime`, `tools`, `session`, `mcp`, `skills`, and `workspace` namespaces.
- `src/auth/` owns host-neutral provider credential helpers: stable Pi credential secret IDs, provider environment variable names, supported Pi provider/model-key validation, auth failure hint text, disabled-provider checks, structural API-key/OAuth credential extraction, credential JSON parsing/serialization, provider readiness derivation, and provider-auth gating over the canonical `ModelAuthHost` port. Concrete Obsidian keychain adapters stay in host/app composition; pi-ai model/auth host implementations and provider OAuth flows live under `src/engine/pi/`.
- `src/foundation/` owns shared contracts/defaults that previously lived in the deleted `@pivi/core` package plus pure settings/display helpers: active-model reconciliation, title-generation model reconciliation, Pi agent settings materialization/update/normalization, environment text parsing/formatting, shared/agent environment-scope routing, Pi model-key shape validation and settings view types, provider/model display metadata, chat UI active-state projection over injected `ChatUIConfig`, and settings snapshot/reconciliation orchestration over injected chat UI configuration.
- `src/tools/` owns generic tool protocol, diff, todo, task, and display helpers that previously lived in the deleted `@pivi/tools` package.
- `src/context/` owns host-neutral prompt context formatting, vault context layer loading, XML context stripping, inline context tokens, browser/canvas/editor context value models, and date/duration helpers. Host SDK helpers such as `getEditorView()` stay outside this package.
- `src/prompt/` owns host-neutral system prompt, Pi system-prompt settings/key wrappers, turn prompt, inline-edit prompt, title-generation prompt, registered-tool summary text, `ContextProvider`, and `PromptContributor` contracts.
- `src/runtime/` owns host-neutral runtime contracts and helpers: `AgentCoreHost`, `AgentCoreRuntime` session/engine coordination, chat turn preparation, chat turn types, `PiChatService`, queued-turn merging, stream chunk queueing, open-session state projection, ready-state notification, connectivity probing over `HttpClient`, auxiliary query service contracts/implementations, and Pi/MCP text-content extraction. Pi tool-registry helpers live under `src/engine/pi/` and are exported from the Pi engine subpath, not through `runtime`.
- `src/engine/` owns the generic `AgentEngine` contract; `src/engine/pi/` owns Pi SDK adapter helpers, the canonical `PiRuntimeHost` seam, the concrete shared pi-ai model registry/provider setup, Pi provider credential/OAuth services over canonical ports, Codex image-generation client helpers over injected fetch/token providers, Pi image-content mapping, Pi model registry cache/key-resolution primitives, Pi model/auth resolution helpers, Pi model option projection, Pi chat UI configuration and settings coordinator facade, Pi chat runtime construction, Pi auxiliary query runner orchestration and host factory, Pi background-subagent job lifecycle, Pi context-compaction policy helpers, Pi thinking-level helpers, Pi JSONL compatibility implementations, visible-message entry lookup, and Pi tool-registry core/host composition that are host-neutral. Obsidian product composition still provides concrete SecretStorage and legacy auth file stores.
- `src/plugins/index.ts` owns the declarative plugin/resource registry skeleton: manifest parsing, registry records, lockfile/trust metadata, resource loader contracts, and contribution models.
- `src/ports/index.ts` owns canonical host capability contracts: workspace file stores, home file stores, async secret stores, temporary sync secret-store compatibility, auth credential services, OAuth flow host callbacks, HTTP, process, external opener, logger, clock, and runtime UI callbacks.
- `src/workspace/` owns host-neutral workspace identity (`WorkspaceContext`) and client kind terminology used by runtime host construction.
- `src/session/` owns host-neutral session contracts, open-session manager, pure path helpers, user-query metadata, message UI overlay patches, and subagent JSONL parsing. Pi JSONL compatibility implementations live under `src/engine/pi/session/`; session path helpers compute pi-compatible paths only, and filesystem directory creation stays with `SessionManager` or concrete store adapters.
- `src/skills/` owns skill markdown/frontmatter parsing, loaded skill body content, slash command catalog contracts, vault skill loading, default bundle orchestration, skill service helpers, change notifications, and default-bundle remote/process helpers that consume injected ports, command environments, and platform context instead of global network or process APIs. Filesystem ownership remains only in vault-local skill loading/sync paths until a later storage-port slice.
- `src/mcp/` owns MCP config parsing/storage, server management, OAuth/auth stores, callback server, proxy tool specs, connection pool, tester, and transport helpers. MCP SDK transports receive an injected fetch-compatible `McpTransportFetch`; stdio/bearer environment lookup receives injected `McpProcessEnv` from the product host; OAuth callback port configuration is injected by the product host; concrete Node/Electron fetch implementations stay in host packages.

## Boundaries

- Do not import concrete host SDKs, platform UI APIs, or concrete host adapter/tool packages.
- Do not import product app/UI modules through `@/*`, `src/*`, or relative paths outside `packages/`.
- Keep concrete host wiring in app/adapter packages. This package should expose capabilities and ports, not decide how a host stores files, secrets, context, or tools.
- Prefer explicit subpath exports when a source package contains both core and host-specific helpers.

## Package map

- `package.json` exports the barrel plus the `auth`, `auth/*`, `engine`, `engine/*`, `engine/pi`, `engine/pi/*`, `context`, `context/*`, `foundation`, `foundation/*`, `mcp`, `mcp/*`, `mcp/oauth/*`, `plugins`, `ports`, `prompt`, `prompt/*`, `runtime`, `runtime/*`, `session`, `session/*`, `skills`, `skills/*`, `skills/commands/*`, `skills/vault/*`, `tools`, and `tools/*` subpaths.
- `foundation/` and `tools/` own the moved source from the deleted `@pivi/core` and `@pivi/tools` packages. Product, package, and test imports should use the pivi-agent-core subpaths.
- `auth/`, `context/`, `prompt/`, `runtime/`, `engine/`, and `engine/pi/` own moved host-neutral source. Pi runtime keeps wrappers plus concrete Pi SDK orchestration, Obsidian, provider OAuth/model, and host context collection code.
- `session/` owns host-neutral session contracts, path helpers, open-session manager, and subagent JSONL parsing. Pi SDK-backed JSONL compatibility shims re-export implementations from `engine/pi/session`.
- `skills/` owns the moved skills source. Do not add new imports from the deleted `@pivi/skills` package.
- `mcp/` owns the moved MCP source. Do not add new imports from the deleted `@pivi/mcp` package.
- `plugins/` is declarative only: it may describe resources and contributions, but host confirmation, downloads, git/npm commands, local path resolution, UI, and third-party code execution stay in adapters.
- `ports/` supplies canonical host contracts for future MCP/skills/runtime port injection.
- There is no package-local build step; source is consumed by the root build.
- The package-local `typecheck` script is a placeholder. Verify boundary changes with root typecheck, lint, architecture checks, and focused tests for the moved seam.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
