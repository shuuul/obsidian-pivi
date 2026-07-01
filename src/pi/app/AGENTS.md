# `src/pi/app/` — Pi workspace service implementations

Pi-backed implementations for workspace-level services: settings tab sections, slash command catalog, MCP/OAuth, skills, and runtime-adjacent app services.

## Rules

- Implement Pi workspace services directly.
- Keep service construction centralized in `PiWorkspaceServices.ts`.
- Keep workspace-facing service contracts in `serviceContracts.ts`.
- Keep small provider/tester implementations in `workspaceServiceProviders.ts`; instantiate them from `PiWorkspaceServices.ts`.
- Slash command metadata should remain UI-friendly and stable across settings/chat consumers.
