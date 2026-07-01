# `src/pi/ui/` — Pi-specific settings and chat UI config

Pi-owned UI configuration: model selector metadata, thinking levels, provider logos, and Pi settings tab sections.

## Rules

- Feature settings may use these Pi-owned modules directly through explicit dependencies.
- Keep provider/model metadata in one place and reuse it for selectors and settings validation.
- Do not persist credentials directly from UI components; use auth/secret-storage helpers.
