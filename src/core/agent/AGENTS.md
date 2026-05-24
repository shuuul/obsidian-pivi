# `src/core/agent/` — Agent ports (hexagonal core)

Pi-only agent boundary: contract types and static registries. Features import from here; `src/pi/` implements the contracts at bootstrap.

## Key files

- `types.ts` — `PiAgentRegistration`, `ChatUIConfig`, workspace service contracts
- `PiAgentServices.ts` — Chat-facing facade (`bootstrap`, runtime, UI config, auxiliary services)
- `AgentWorkspace.ts` — Workspace services (commands, MCP, settings tab renderer)
- `AgentSettingsCoordinator.ts` — Model/reasoning/permission projection into settings
- `agentEnvironment.ts` — Shared vs `pi` environment variable scopes (`EnvironmentScope`)
- `commands/` — Slash command catalog types and hidden-command helpers

## Patterns

- Zero imports from `src/pi/` or `src/features/`
- Bootstrap: `main.ts` calls `bootstrapPiAgent()` from `src/pi/bootstrap.ts`
