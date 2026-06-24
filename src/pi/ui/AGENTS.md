# `src/pi/ui/` — Pi-specific settings and chat UI config

Adaptor-owned UI configuration: model selector metadata, thinking levels, provider logos, and Pi settings tab sections rendered through core workspace ports.

## Rules

- Feature settings should call this through `AgentWorkspace`, not direct imports from `features/`.
- Keep provider/model metadata in one place and reuse it for selectors and settings validation.
- Do not persist credentials directly from UI components; use auth/secret-storage helpers.
