# `src/features/settings/` — Obsidian settings feature

Plugin settings tab composition, keyboard navigation mapping, environment snippets, MCP settings, and Pi-specific settings sections.

## Rules

- Use Obsidian `PluginSettingTab`, `Setting`, and `Modal` APIs for settings UI.
- Use Pi workspace/settings services directly for provider, MCP, skills, and model-readiness UI.
- Persist through plugin/settings coordinators and provide rollback/user-readable errors for failed saves.
