# `src/pi/agent/` — Shared agent-adjacent types and command helpers

This directory contains shared product helpers around Pi chat UI configuration, environment settings, and slash command catalogs. Do not add new runtime registration or global service patterns here; prefer direct Pi product modules or local feature dependencies.

## Key files

- `chatUiTypes.ts` — model selector, reasoning, permission/mode selector, and chat icon contracts
- `AgentEnvironment.ts` — shared vs active-agent environment variable scopes (`EnvironmentScope`: `shared` / `agent`; legacy `pi` normalizes to `agent`)
- `commands/` — Slash command catalog types and hidden-command helpers

Moved type homes:

- Workspace/app service contracts live in `src/pi/app/serviceContracts.ts`
- Tab persistence state lives in `src/pi/bootstrap/types.ts`
- Task/subagent interpretation contracts live in `src/pi/tools/taskTypes.ts`

## Patterns

- Zero imports from `src/pi/`, `src/features/`, `src/main`, Obsidian SDK, MCP SDK, or Pi SDK packages
- Add only shared types/helpers with a clear non-UI, non-SDK role
