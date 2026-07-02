# @pivi/pi-runtime package guide

## Purpose

`@pivi/pi-runtime` is Pivi's primary Pi SDK boundary. It constructs Pi agents, adapts Pivi tools to Pi tools, streams Pi events into Pivi chunks, manages model/auth/settings coordination, builds prompts/context layers, runs auxiliary inline-edit/title queries, and integrates MCP/session/skill services.

## Public entrypoints

- `src/index.ts` re-exports intentional public runtime symbols. Do not export internal-only helpers casually.
- `src/PiChatRuntime.ts` is the core chat runtime: agent lifecycle, query/cancel/rewind, session sync, MCP bridge integration, stream queueing, prompt hot-update, and thinking-level sync.
- `src/PiChatService.ts` defines the UI-facing chat service contract.
- `src/PiAgentEventAdapter.ts` maps Pi `AgentEvent` values to Pivi `StreamChunk` values.
- `src/PiToolAdapter.ts` converts Pivi `ToolSpec` into Pi agent tools.
- `src/PiChatUIConfig.ts` exposes model/reasoning/permission-mode UI configuration from Pi model metadata.
- `src/PiSettingsCoordinator.ts` normalizes and reconciles settings/model state.
- `src/PiAuxQueryRunner.ts`, `src/QueryBackedInlineEditService.ts`, and `src/QueryBackedTitleGenerationService.ts` run auxiliary Pi queries.
- `src/buildPiSystemPrompt.ts`, `src/buildTurnPrompt.ts`, `src/loadContextLayers.ts`, and `src/context/` own system prompt, turn prompt, XML context, current note/editor/browser/canvas/date, and context-file handling.
- `src/auth/` owns Obsidian secret-storage credential access and provider OAuth services.
- `src/settings/` owns Pi-specific agent settings/environment resolution and migration helpers. App composition may inject these helpers into host persistence codecs; host packages must not import them directly.
- `src/tools/` owns tool registry construction, gated approvals, skill tool, and subagent tool creation.
- `src/host/` and `src/agent/` define runtime host/environment boundaries.

## Boundaries

- Low-level `@earendil-works/pi-*` imports belong here or in intentionally adjacent runtime/tooling packages, not in UI/app feature code.
- Do not import `src/ui` or app composition-root modules. Communicate through core contracts, host contracts, and service interfaces.
- Keep Obsidian vault/UI side effects behind host/tool/service contracts. Runtime should orchestrate, not render UI.
- Preserve streaming order, cancellation semantics, and explicit error chunks. Do not swallow agent, MCP, auth, or session failures.
- Prompt XML tags and context-layer semantics are runtime contracts; update tests and generic docs when they change.

## Package map

- `package.json` exports the barrel and source subpaths.
- There is no package-local build step; source is consumed by the app build.
- The package-local `typecheck` script is a placeholder. Verify runtime changes with root typecheck and targeted runtime/session/MCP tests.

## Documentation

Keep durable package rationale in this file. If behavior moves or package boundaries change, update this guide instead of adding separate architecture/spec/note docs.
