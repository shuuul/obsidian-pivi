# @pivi/pi-runtime

## Purpose

Primary Pi SDK boundary for Pivi. It owns Pi Agent construction, model/provider settings, Pi-specific settings normalization/migration helpers, auth helpers, streaming adaptation, turn prompt construction, inline/title auxiliary queries, and Obsidian tool adaptation into Pi Agent tools.

## Allowed dependencies

- Raw Pi SDK packages (`@earendil-works/pi-agent-core`, `@earendil-works/pi-ai`, and narrow `pi-coding-agent` compatibility shims).
- `@pivi/core`, `@pivi/session`, `@pivi/mcp`, `@pivi/skills`, `@pivi/obsidian-host`, `@pivi/obsidian-tools`, and `@pivi/tools`.
- Obsidian host APIs only for renderer request/keychain compatibility and runtime service inputs.
- Node `fs`/`path` for environment and compatibility shim loading.

## Forbidden dependencies

- `src/ui` imports.
- App composition-root imports.
- Concrete chat/sidebar UI modules.

## Public API

- `PiChatRuntime`, `PiChatService`, event adapter, tool adapter, settings coordinator/defaults, auth services, model helpers, prompt builders, turn prompt helpers, and auxiliary query services.
- Exported through `@pivi/pi-runtime` and `@pivi/pi-runtime/*`.
