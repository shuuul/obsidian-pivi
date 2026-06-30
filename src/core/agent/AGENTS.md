# `src/core/agent/` — Agent ports (hexagonal core)

Agent boundary contracts and runtime/workspace facades. Features import from here; `src/pi/` implements the contracts at bootstrap through core ports and `AgentHostContext`.

## Key files

- `types.ts` — `AgentRegistration`, settings persistence, workspace service contracts
- `chatUiTypes.ts` — model selector, reasoning, permission/mode selector, and chat icon contracts
- `AgentServices.ts` — Chat-facing facade (`bootstrap`, runtime, UI config, settings persistence, auxiliary services)
- `AgentWorkspace.ts` — Workspace services (commands, MCP, settings tab renderer)
- `AgentSettingsCoordinator.ts` — Model/reasoning/permission projection into settings
- `AgentEnvironment.ts` — shared vs active-agent environment variable scopes (`EnvironmentScope`: `shared` / `agent`; legacy `pi` normalizes to `agent`)
- `commands/` — Slash command catalog types and hidden-command helpers

## Patterns

- Zero imports from `src/pi/`, `src/features/`, `src/main`, Obsidian SDK, MCP SDK, or Pi SDK packages
- Bootstrap: `main.ts` calls `bootstrapPiAgent()` from `src/pi/bootstrap.ts`
