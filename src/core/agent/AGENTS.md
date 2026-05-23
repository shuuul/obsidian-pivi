# `src/core/agent/` — Agent ports (hexagonal core)

Pi-only agent boundary: contract types and static registries. Features import from here; `src/pi/` implements the contracts at bootstrap.

## Key files

- `types.ts` — `ProviderRegistration`, `ProviderChatUIConfig`, workspace service contracts
- `ProviderRegistry.ts` — Chat-facing facade (`install`, runtime, UI config, auxiliary services)
- `ProviderWorkspaceRegistry.ts` — Workspace services (commands, MCP, settings tab renderer)
- `ProviderSettingsCoordinator.ts` — Model/reasoning/permission projection into settings
- `providerEnvironment.ts` — Shared vs `provider:pi` environment variable scopes
- `commands/` — Slash command catalog types and hidden-command helpers

## Patterns

- Zero imports from `src/pi/` or `src/features/`
- Bootstrap: `main.ts` calls `ProviderRegistry.install` and `ProviderWorkspaceRegistry.install`
