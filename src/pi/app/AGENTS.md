# `src/pi/app/` — Pi workspace service implementations

Pi-backed implementations for workspace-level services: settings tab sections, slash command catalog, MCP/OAuth, skills, and runtime-adjacent app services.

## Rules

- Implement contracts from `src/core/agent/AgentWorkspace`; do not import feature UI.
- Keep service construction centralized in `PiWorkspaceServices.ts`.
- Slash command metadata should remain UI-friendly and stable across settings/chat consumers.
